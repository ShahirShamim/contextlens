"""ContextLens precompute pipeline.

Embeds the authored scenario signals and axis anchors, computes axis
affinities, field-level ablations, and a 2D projection, then writes
web/data/model.json for the static UI.

The UI never invents a number: every score it shows is recomputed in the
browser from the per-event affinities in model.json using the same formulas
this file documents (and mirrors in its calibration report).

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

from anchors import AXES
from scenarios import SCENARIOS, SUBSCRIBER, serialize_event

# Scoring parameters — single source of truth, exported to model.json so the
# browser uses exactly these values.
PARAMS = {
    "lambda_decay_per_day": 0.13,   # w decays e^(-lambda * age_days)
    "source_trust": {"device": 1.0, "cloud": 0.85},
    "softmax_temp": 0.10,           # sharpens cosine sims into affinities
    "sigmoid_k": 4.0,               # confidence = sigmoid(k * |net evidence|)
    "confidence_floor_pct": 70.0,   # below this: suppress, route to baseline
    "drift_scale": 0.30,            # normalizes weighted std of evidence
    "drift_limit": 1.5,             # above this: mute downstream triggers
    "latency_budget_ms": 250,       # client-side compute budget (fallback rule)
}

# Different embedding models produce differently-spread cosine similarities, so
# the confidence/drift scaling constants are calibrated per backend (the axis
# affinities themselves stay untouched — these only rescale the readout).
PARAMS_BY_BACKEND = {
    "local":  {"sigmoid_k": 4.0, "drift_scale": 0.30},
    "vertex": {"sigmoid_k": 8.0, "drift_scale": 0.19},
}

PRICING = {
    "embed_usd_per_1k_chars": 0.000025,  # Vertex text-embedding pricing basis
    "note": "Embedding happens once at ingest; runtime inference is arithmetic on cached vectors.",
}

# Illustrative offline eval — clearly labeled as such in the UI/README.
EVAL_TABLE = {
    "methodology": (
        "Illustrative offline evaluation on 62 simulated held-out sessions "
        "with authored ground-truth labels. Included to show the shape of a "
        "model health ledger, not as a real benchmark."
    ),
    "rows": [
        {"segment": "High-Value Upgrade Propensity", "precision": 0.91, "recall": 0.84, "n": 38},
        {"segment": "Churn Risk — Retention Route", "precision": 0.87, "recall": 0.79, "n": 24},
    ],
    "suppression_rate_pct": 18,
}

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "data", "model.json")


# --------------------------------------------------------------------------
# Embedding backends
# --------------------------------------------------------------------------

def embed_local(texts):
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("all-MiniLM-L6-v2")
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vecs, dtype=np.float64), "sentence-transformers/all-MiniLM-L6-v2"


def embed_vertex(texts, project, location):
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=project, location=location)
    vecs = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp = client.models.embed_content(
            model="text-embedding-005",
            contents=batch,
            config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY"),
        )
        vecs.extend(e.values for e in resp.embeddings)
    arr = np.asarray(vecs, dtype=np.float64)
    arr /= np.linalg.norm(arr, axis=1, keepdims=True)
    return arr, "vertex-ai/text-embedding-005"


# --------------------------------------------------------------------------
# Scoring math (mirrored in web/app.js — keep in sync)
# --------------------------------------------------------------------------

def softmax(x, temp):
    z = np.exp((x - np.max(x)) / temp)
    return z / z.sum()


def event_weight(event):
    trust = PARAMS["source_trust"][event["source"]]
    return trust * math.exp(-PARAMS["lambda_decay_per_day"] * event["age_days"])


def score_scenario(events):
    """Replicates the browser-side aggregation for the calibration report."""
    ws = np.array([event_weight(e) for e in events])
    vs = np.array([e["_affinities"]["upgrade_intent"] - e["_affinities"]["churn_risk"] for e in events])
    net = float(np.sum(ws * vs) / np.sum(ws))
    confidence = 100.0 / (1.0 + math.exp(-PARAMS["sigmoid_k"] * abs(net)))
    mean_v = float(np.sum(ws * vs) / np.sum(ws))
    drift = float(math.sqrt(np.sum(ws * (vs - mean_v) ** 2) / np.sum(ws)) / PARAMS["drift_scale"])
    if confidence < PARAMS["confidence_floor_pct"]:
        segment = "Indeterminate — General Baseline"
    elif net > 0:
        segment = "High-Value Upgrade Propensity"
    else:
        segment = "Churn Risk — Retention Route"
    return {"net": net, "confidence": confidence, "drift": drift, "segment": segment}


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="use sentence-transformers instead of Vertex AI")
    ap.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    ap.add_argument("--location", default="us-central1", help="Vertex region for embedding calls")
    args = ap.parse_args()

    # 1. Collect every text we need: anchors, full events, ablated events.
    anchor_texts, anchor_owner = [], []
    for axis in AXES:
        for phrase in axis["phrases"]:
            anchor_texts.append(phrase)
            anchor_owner.append(axis["id"])

    events = [e for sc in SCENARIOS for e in sc["events"]]
    event_texts = [serialize_event(e) for e in events]

    ablation_specs = []  # (event_index, field)
    ablation_texts = []
    for idx, ev in enumerate(events):
        for field in ev["payload"]:
            ablation_specs.append((idx, field))
            ablation_texts.append(serialize_event(ev, drop_field=field))

    all_texts = anchor_texts + event_texts + ablation_texts
    print(f"Embedding {len(all_texts)} texts "
          f"({len(anchor_texts)} anchors, {len(event_texts)} events, {len(ablation_texts)} ablations)…")

    if args.local:
        embs, backend = embed_local(all_texts)
        PARAMS.update(PARAMS_BY_BACKEND["local"])
    else:
        if not args.project:
            sys.exit("No GCP project. Pass --project / set GOOGLE_CLOUD_PROJECT, or use --local.")
        embs, backend = embed_vertex(all_texts, args.project, args.location)
        PARAMS.update(PARAMS_BY_BACKEND["vertex"])
    print(f"Backend: {backend}, dims: {embs.shape[1]}")

    n_anchor, n_event = len(anchor_texts), len(event_texts)
    anchor_embs = embs[:n_anchor]
    event_embs = embs[n_anchor : n_anchor + n_event]
    ablation_embs = embs[n_anchor + n_event :]

    # 2. Axis centroids.
    centroids = {}
    for axis in AXES:
        rows = anchor_embs[[i for i, owner in enumerate(anchor_owner) if owner == axis["id"]]]
        c = rows.mean(axis=0)
        centroids[axis["id"]] = c / np.linalg.norm(c)

    # 3. Per-event sims, affinities, dominant axis.
    temp = PARAMS["softmax_temp"]
    for i, ev in enumerate(events):
        sims = {ax["id"]: float(event_embs[i] @ centroids[ax["id"]]) for ax in AXES}
        aff = softmax(np.array([sims[ax["id"]] for ax in AXES]), temp)
        ev["_sims"] = sims
        ev["_affinities"] = {ax["id"]: float(a) for ax, a in zip(AXES, aff)}
        ev["_dominant"] = max(sims, key=sims.get)
        ev["_strength"] = max(sims.values())

    # 4. Field ablation: cosine delta on the event's dominant axis.
    field_deltas = {i: [] for i in range(n_event)}
    for (idx, field), emb in zip(ablation_specs, ablation_embs):
        dom = events[idx]["_dominant"]
        delta = events[idx]["_sims"][dom] - float(emb @ centroids[dom])
        field_deltas[idx].append({"field": field, "delta": round(delta, 4)})
    for i, ev in enumerate(events):
        ev["_top_fields"] = sorted(field_deltas[i], key=lambda d: -d["delta"])

    # 5. 2D projection (PCA over events + anchor phrases) for the graph.
    stack = np.vstack([event_embs, anchor_embs])
    centered = stack - stack.mean(axis=0)
    _, s, vt = np.linalg.svd(centered, full_matrices=False)
    coords = centered @ vt[:2].T
    var_explained = float((s[:2] ** 2).sum() / (s ** 2).sum())

    centroid_stack = np.vstack([centroids[ax["id"]] for ax in AXES])
    centroid_coords = (centroid_stack - stack.mean(axis=0)) @ vt[:2].T

    everything = np.vstack([coords, centroid_coords])
    lo, hi = everything.min(axis=0), everything.max(axis=0)
    scale = lambda p: [round(float((p[0] - lo[0]) / (hi[0] - lo[0]) * 0.88 + 0.06), 4),
                       round(float((p[1] - lo[1]) / (hi[1] - lo[1]) * 0.88 + 0.06), 4)]

    for i, ev in enumerate(events):
        ev["_xy"] = scale(coords[i])
    anchor_xy = [scale(c) for c in coords[n_event:]]
    centroid_xy = {ax["id"]: scale(c) for ax, c in zip(AXES, centroid_coords)}

    # 6. Assemble model.json.
    avg_chars = sum(len(t) for t in event_texts) / n_event
    out = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "backend": backend,
            "embed_dims": int(embs.shape[1]),
            "pca_var_explained": round(var_explained, 3),
            "params": PARAMS,
            "avg_signal_chars": round(avg_chars, 1),
        },
        "pricing": PRICING,
        "eval": EVAL_TABLE,
        "subscriber": SUBSCRIBER,
        "axes": [
            {
                "id": ax["id"],
                "label": ax["label"],
                "short": ax["short"],
                "centroid_xy": centroid_xy[ax["id"]],
                "anchors": [
                    {"phrase": p, "xy": anchor_xy[j]}
                    for j, (p, owner) in enumerate(zip(anchor_texts, anchor_owner))
                    if owner == ax["id"]
                ],
            }
            for ax in AXES
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
                        "sims": {k: round(v, 4) for k, v in ev["_sims"].items()},
                        "affinities": {k: round(v, 4) for k, v in ev["_affinities"].items()},
                        "dominant": ev["_dominant"],
                        "strength": round(ev["_strength"], 4),
                        "xy": ev["_xy"],
                        "top_fields": ev["_top_fields"],
                    }
                    for ev in sc["events"]
                ],
            }
            for sc in SCENARIOS
        ],
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=1)
    print(f"Wrote {os.path.relpath(OUT_PATH)} ({os.path.getsize(OUT_PATH) // 1024} KB)\n")

    # 7. Calibration report.
    targets = {
        "baseline": lambda r: r["confidence"] >= 85 and r["segment"].startswith("High-Value"),
        "conflict": lambda r: 70 <= r["confidence"] < 85 and r["segment"].startswith("High-Value"),
        "sparse": lambda r: r["confidence"] < 70,
    }
    all_ok = True
    for sc in SCENARIOS:
        result = score_scenario(sc["events"])
        ok = targets[sc["id"]](result)
        all_ok &= ok
        print(f"── {sc['label']}  [{'PASS' if ok else 'FAIL'}]")
        print(f"   net={result['net']:+.3f}  confidence={result['confidence']:.1f}%  "
              f"drift={result['drift']:.2f}  → {result['segment']}")
        for ev in sc["events"]:
            a = ev["_affinities"]
            print(f"   {ev['id']:>3} {ev['source']:<6} age={ev['age_days']:>2}d "
                  f"w={event_weight(ev):.2f}  U={a['upgrade_intent']:.2f} "
                  f"E={a['engagement_depth']:.2f} C={a['churn_risk']:.2f}  "
                  f"v={a['upgrade_intent'] - a['churn_risk']:+.2f}  [{ev['event_type']}]")
        print()
    print("Calibration:", "ALL TARGETS MET ✅" if all_ok else "targets missed — tune anchors/PARAMS ⚠️")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
