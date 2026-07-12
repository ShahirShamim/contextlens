"""ContextLens live-scoring API.

Embeds a free-text signal with the same Vertex AI model the pipeline used,
scores it against the same axis centroids, and projects it with the same PCA
transform — so a live signal is indistinguishable, mathematically, from the
precomputed demo signals. Text is scored in memory and never stored.
"""

import json
import math
import os
import time
from collections import defaultdict, deque

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ASSETS = json.load(open(os.path.join(os.path.dirname(__file__), "scoring_assets.json")))

VERTICALS = {}
for _vid, _va in ASSETS["verticals"].items():
    VERTICALS[_vid] = {
        "axes": _va["axes"],
        "centroids": np.array([_va["centroids"][a] for a in _va["axes"]]),
        "pca_mean": np.array(_va["pca"]["mean"]),
        "pca_comp": np.array(_va["pca"]["components"]),
        "pca_lo": np.array(_va["pca"]["lo"]),
        "pca_hi": np.array(_va["pca"]["hi"]),
        "temp": _va["softmax_temp"],
    }

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")

PER_IP_PER_MIN = 10
GLOBAL_PER_DAY = 2000

app = FastAPI(title="ContextLens live scoring", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://contextlens.hireme.jmkn.tech",
        "https://contextlens-619062244311.europe-west1.run.app",
        "http://localhost:5173",
        "http://localhost:8735",
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

_client = None


def client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
    return _client


_ip_hits = defaultdict(deque)
_day = [time.strftime("%Y-%m-%d"), 0]


def check_limits(ip):
    now = time.time()
    q = _ip_hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_IP_PER_MIN:
        raise HTTPException(429, "rate limit: max 10 scores per minute")
    today = time.strftime("%Y-%m-%d")
    if _day[0] != today:
        _day[0], _day[1] = today, 0
    if _day[1] >= GLOBAL_PER_DAY:
        raise HTTPException(429, "daily scoring budget exhausted — try tomorrow")
    q.append(now)
    _day[1] += 1


class ScoreRequest(BaseModel):
    text: str = Field(min_length=3, max_length=200)
    source: str = Field(default="device", pattern="^(device|cloud)$")
    vertical: str = Field(default="telco")


# Note: /healthz is intercepted by the Google Frontend on run.app and never
# reaches the container — hence /status.
@app.get("/status")
def status():
    return {"ok": True}


@app.post("/score")
def score(req: ScoreRequest, request: Request):
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
    check_limits(ip)
    v = VERTICALS.get(req.vertical)
    if v is None:
        raise HTTPException(422, f"unknown vertical: {req.vertical}")

    kind = "mobile app event" if req.source == "device" else "cloud event"
    serialized = f"{kind} — custom signal. text: {req.text}"

    from google.genai import types

    resp = client().models.embed_content(
        model="text-embedding-005",
        contents=[serialized],
        config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY"),
    )
    emb = np.array(resp.embeddings[0].values)
    emb = emb / np.linalg.norm(emb)

    sims = v["centroids"] @ emb
    z = np.exp((sims - sims.max()) / v["temp"])
    aff = z / z.sum()

    coord = (emb - v["pca_mean"]) @ v["pca_comp"].T
    xy = (coord - v["pca_lo"]) / (v["pca_hi"] - v["pca_lo"]) * 0.88 + 0.06
    xy = np.clip(xy, 0.02, 0.98)

    axes = v["axes"]
    return {
        "serialized": serialized,
        "sims": {a: round(float(s), 4) for a, s in zip(axes, sims)},
        "affinities": {a: round(float(x), 4) for a, x in zip(axes, aff)},
        "dominant": axes[int(np.argmax(sims))],
        "strength": round(float(sims.max()), 4),
        "xy": [round(float(xy[0]), 4), round(float(xy[1]), 4)],
    }
