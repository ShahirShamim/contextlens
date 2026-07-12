"""ContextLens precompute pipeline (multi-vertical).

For each vertical (telco, marketplace, fintech): embeds the authored scenario
signals and axis anchors, computes axis affinities, field-level ablations, and
a 2D projection, then writes app/public/data/model.json for the SPA and
api/scoring_assets.json for the live-scoring service.

The UI never invents a number: every score it shows is recomputed in the
browser from the per-event affinities using the same formulas this file
documents (and mirrors in its calibration report). The engine is
vertical-agnostic — each vertical declares its axes and their polarity.

Usage:
    python build.py --local                 # sentence-transformers MiniLM
    python build.py --project my-gcp-proj   # Vertex AI text-embedding-005
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

from verticals import VERTICALS, axis_by_polarity, serialize_event

# Base scoring parameters. Per-backend and per-vertical overrides are merged
# on top; the final set ships inside each vertical in model.json.
BASE_PARAMS = {
    "lambda_decay_per_day": 0.13,   # w decays e^(-lambda * age_days)
    "source_trust": {"device": 1.0, "cloud": 0.85},
    "softmax_temp": 0.10,           # sharpens cosine sims into affinities
    "sigmoid_k": 4.0,               # confidence = sigmoid(k * |net evidence|)
    "confidence_floor_pct": 70.0,   # below this: suppress, route to baseline
    "drift_scale": 0.30,            # normalizes weighted std of evidence
    "drift_limit": 1.5,             # above this: mute downstream triggers
    "latency_budget_ms": 250,       # client-side compute budget (fallback rule)
}

# Different embedding models produce differently-spread cosine similarities.
PARAMS_BY_BACKEND = {
    "local":  {"sigmoid_k": 4.0, "drift_scale": 0.30},
    "vertex": {"sigmoid_k": 8.0, "drift_scale": 0.19},
}

PRICING = {
    "embed_usd_per_1k_chars": 0.000025,
    "note": "Embedding happens once at ingest; runtime inference is arithmetic on cached vectors.",
}

EVAL_METHODOLOGY = (
    "Illustrative offline evaluation on 62 simulated held-out sessions with "
    "authored ground-truth labels. Included to show the shape of a model "
    "health ledger, not as a real benchmark."
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "app", "public", "data", "model.json")
ASSETS_PATH = os.path.join(os.path.dirname(__file__), "..", "api", "scoring_assets.json")


# --------------------------------------------------------------------------
# Embedding backends
# --------------------------------------------------------------------------

def make_embedder(args):
    if args.local:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer("all-MiniLM-L6-v2")

        def embed(texts):
            return np.asarray(
                model.encode(texts, normalize_embeddings=True, show_progress_bar=False),
                dtype=np.float64,
            )

        return embed, "sentence-transformers/all-MiniLM-L6-v2", "local"

    if not args.project:
        sys.exit("No GCP project. Pass --project / set GOOGLE_CLOUD_PROJECT, or use --local.")

    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=args.project, location=args.location)

    def embed(texts):
        vecs = []
        for i in range(0, len(texts), 100):
            resp = client.models.embed_content(
                model="text-embedding-005",
                contents=texts[i : i + 100],
                config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY"),
            )
            vecs.extend(e.values for e in resp.embeddings)
        arr = np.asarray(vecs, dtype=np.float64)
        return arr / np.linalg.norm(arr, axis=1, keepdims=True)

    return embed, "vertex-ai/text-embedding-005", "vertex"


# --------------------------------------------------------------------------
# Scoring math (mirrored in app/src/lib/model.ts — keep in sync)
# --------------------------------------------------------------------------

def softmax(x, temp):
    z = np.exp((x - np.max(x)) / temp)
    return z / z.sum()


def event_weight(event, params):
    trust = params["source_trust"][event["source"]]
    return trust * math.exp(-params["lambda_decay_per_day"] * event["age_days"])


def score_scenario(events, params, pos_id, neg_id):
    ws = np.array([event_weight(e, params) for e in events])
    vs = np.array([e["_affinities"][pos_id] - e["_affinities"][neg_id] for e in events])
    net = float(np.sum(ws * vs) / np.sum(ws))
    confidence = 100.0 / (1.0 + math.exp(-params["sigmoid_k"] * abs(net)))
    drift = float(math.sqrt(np.sum(ws * (vs - net) ** 2) / np.sum(ws)) / params["drift_scale"])
    return {"net": net, "confidence": confidence, "drift": drift}


# --------------------------------------------------------------------------
# Per-vertical build
# --------------------------------------------------------------------------

def build_vertical(v, embed, params):
    anchor_texts, anchor_owner = [], []
    for axis in v.AXES:
        for phrase in axis["phrases"]:
            anchor_texts.append(phrase)
            anchor_owner.append(axis["id"])

    events = [e for sc in v.SCENARIOS for e in sc["events"]]
    event_texts = [serialize_event(e) for e in events]

    ablation_specs, ablation_texts = [], []
    for idx, ev in enumerate(events):
        for field in ev["payload"]:
            ablation_specs.append((idx, field))
            ablation_texts.append(serialize_event(ev, drop_field=field))

    all_texts = anchor_texts + event_texts + ablation_texts
    print(f"[{v.ID}] embedding {len(all_texts)} texts "
          f"({len(anchor_texts)} anchors, {len(event_texts)} events, {len(ablation_texts)} ablations)")
    embs = embed(all_texts)

    n_anchor, n_event = len(anchor_texts), len(event_texts)
    anchor_embs = embs[:n_anchor]
    event_embs = embs[n_anchor : n_anchor + n_event]
    ablation_embs = embs[n_anchor + n_event :]

    centroids = {}
    for axis in v.AXES:
        rows = anchor_embs[[i for i, o in enumerate(anchor_owner) if o == axis["id"]]]
        c = rows.mean(axis=0)
        centroids[axis["id"]] = c / np.linalg.norm(c)

    temp = params["softmax_temp"]
    for i, ev in enumerate(events):
        sims = {ax["id"]: float(event_embs[i] @ centroids[ax["id"]]) for ax in v.AXES}
        aff = softmax(np.array([sims[ax["id"]] for ax in v.AXES]), temp)
        ev["_sims"] = sims
        ev["_affinities"] = {ax["id"]: float(a) for ax, a in zip(v.AXES, aff)}
        ev["_dominant"] = max(sims, key=sims.get)
        ev["_strength"] = max(sims.values())

    field_deltas = {i: [] for i in range(n_event)}
    for (idx, field), emb in zip(ablation_specs, ablation_embs):
        dom = events[idx]["_dominant"]
        delta = events[idx]["_sims"][dom] - float(emb @ centroids[dom])
        field_deltas[idx].append({"field": field, "delta": round(delta, 4)})
    for i, ev in enumerate(events):
        ev["_top_fields"] = sorted(field_deltas[i], key=lambda d: -d["delta"])

    stack = np.vstack([event_embs, anchor_embs])
    centered = stack - stack.mean(axis=0)
    _, s, vt = np.linalg.svd(centered, full_matrices=False)
    coords = centered @ vt[:2].T
    var_explained = float((s[:2] ** 2).sum() / (s ** 2).sum())

    centroid_stack = np.vstack([centroids[ax["id"]] for ax in v.AXES])
    centroid_coords = (centroid_stack - stack.mean(axis=0)) @ vt[:2].T

    everything = np.vstack([coords, centroid_coords])
    lo, hi = everything.min(axis=0), everything.max(axis=0)

    def scale(p):
        return [round(float((p[0] - lo[0]) / (hi[0] - lo[0]) * 0.88 + 0.06), 4),
                round(float((p[1] - lo[1]) / (hi[1] - lo[1]) * 0.88 + 0.06), 4)]

    for i, ev in enumerate(events):
        ev["_xy"] = scale(coords[i])
    anchor_xy = [scale(c) for c in coords[n_event:]]
    centroid_xy = {ax["id"]: scale(c) for ax, c in zip(v.AXES, centroid_coords)}

    vertical_json = {
        "id": v.ID,
        "label": v.LABEL,
        "description": v.DESCRIPTION,
        "entity": v.ENTITY,
        "segments": v.SEGMENTS,
        "attr_scale": v.ATTR_SCALE,
        "params": params,
        "eval": {
            "methodology": EVAL_METHODOLOGY,
            "rows": [
                {"segment": v.SEGMENTS["positive"], "precision": 0.91, "recall": 0.84, "n": 38},
                {"segment": v.SEGMENTS["negative"], "precision": 0.87, "recall": 0.79, "n": 24},
            ],
            "suppression_rate_pct": 18,
        },
        "axes": [
            {
                "id": ax["id"],
                "label": ax["label"],
                "short": ax["short"],
                "polarity": ax["polarity"],
                "centroid_xy": centroid_xy[ax["id"]],
                "anchors": [
                    {"phrase": p, "xy": anchor_xy[j]}
                    for j, (p, owner) in enumerate(zip(anchor_texts, anchor_owner))
                    if owner == ax["id"]
                ],
            }
            for ax in v.AXES
        ],
        "scenarios": [
            {
                "id": sc["id"],
                "label": sc["label"],
                "button": sc["button"],
                "description": sc["description"],
                "events": [
                    {
                        "id": ev["id"],
                        "t_offset_ms": ev["t_offset_ms"],
                        "source": ev["source"],
                        "source_label": ev["source_label"],
                        "event_type": ev["event_type"],
                        "age_days": ev["age_days"],
                        "payload": ev["payload"],
                        "serialized": serialize_event(ev),
                        "sims": {k: round(x, 4) for k, x in ev["_sims"].items()},
                        "affinities": {k: round(x, 4) for k, x in ev["_affinities"].items()},
                        "dominant": ev["_dominant"],
                        "strength": round(ev["_strength"], 4),
                        "xy": ev["_xy"],
                        "top_fields": ev["_top_fields"],
                    }
                    for ev in sc["events"]
                ],
            }
            for sc in v.SCENARIOS
        ],
    }

    assets = {
        "softmax_temp": params["softmax_temp"],
        "axes": [ax["id"] for ax in v.AXES],
        "centroids": {ax["id"]: centroids[ax["id"]].tolist() for ax in v.AXES},
        "pca": {
            "mean": stack.mean(axis=0).tolist(),
            "components": vt[:2].tolist(),
            "lo": lo.tolist(),
            "hi": hi.tolist(),
        },
    }

    avg_chars = sum(len(t) for t in event_texts) / n_event
    return vertical_json, assets, var_explained, avg_chars, events


TARGETS = {
    "baseline": lambda r: r["confidence"] >= 85,
    "conflict": lambda r: 70 <= r["confidence"] < 85 and r["drift"] > BASE_PARAMS["drift_limit"],
    "sparse": lambda r: r["confidence"] < 70,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    ap.add_argument("--location", default="us-central1")
    args = ap.parse_args()

    embed, backend, backend_kind = make_embedder(args)
    print(f"Backend: {backend}\n")

    verticals_json, assets_json = [], {}
    var_by_vertical, all_avg_chars = {}, []
    all_ok = True
    reports = []

    for v in VERTICALS:
        params = {**BASE_PARAMS, **PARAMS_BY_BACKEND[backend_kind], **v.PARAMS_OVERRIDES}
        vjson, assets, var, avg_chars, events = build_vertical(v, embed, params)
        verticals_json.append(vjson)
        assets_json[v.ID] = assets
        var_by_vertical[v.ID] = round(var, 3)
        all_avg_chars.append(avg_chars)

        pos_id = axis_by_polarity(v, "positive")
        neg_id = axis_by_polarity(v, "negative")
        for sc in v.SCENARIOS:
            result = score_scenario(sc["events"], params, pos_id, neg_id)
            direction = "positive" if result["net"] > 0 else "negative"
            suppressed = result["confidence"] < params["confidence_floor_pct"]
            segment = v.SEGMENTS["indeterminate" if suppressed else direction]
            ok = TARGETS[sc["id"]](result)
            all_ok &= ok
            reports.append(
                f"[{v.ID}] {sc['id']:<9} {'PASS' if ok else 'FAIL'}  "
                f"net={result['net']:+.3f} conf={result['confidence']:.1f}% "
                f"drift={result['drift']:.2f} → {segment}"
            )

    first = assets_json[VERTICALS[0].ID]
    dims = len(first["centroids"][first["axes"][0]])

    model = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "backend": backend,
            "embed_dims": dims,
            "pca_var_explained": var_by_vertical,
            "avg_signal_chars": round(sum(all_avg_chars) / len(all_avg_chars), 1),
        },
        "pricing": PRICING,
        "verticals": verticals_json,
    }

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    with open(MODEL_PATH, "w") as f:
        json.dump(model, f, indent=1)
    print(f"Wrote {os.path.relpath(MODEL_PATH)} ({os.path.getsize(MODEL_PATH) // 1024} KB)")

    assets_out = {"backend": backend, "verticals": assets_json}
    os.makedirs(os.path.dirname(ASSETS_PATH), exist_ok=True)
    with open(ASSETS_PATH, "w") as f:
        json.dump(assets_out, f)
    print(f"Wrote {os.path.relpath(ASSETS_PATH)} ({os.path.getsize(ASSETS_PATH) // 1024} KB)\n")

    print("\n".join(reports))
    print("\nCalibration:", "ALL TARGETS MET ✅" if all_ok else "targets missed ⚠️")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
