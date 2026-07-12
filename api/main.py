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
AXES = ASSETS["axes"]
CENTROIDS = np.array([ASSETS["centroids"][a] for a in AXES])
PCA_MEAN = np.array(ASSETS["pca"]["mean"])
PCA_COMP = np.array(ASSETS["pca"]["components"])
PCA_LO = np.array(ASSETS["pca"]["lo"])
PCA_HI = np.array(ASSETS["pca"]["hi"])
TEMP = ASSETS["softmax_temp"]

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


# Note: /healthz is intercepted by the Google Frontend on run.app and never
# reaches the container — hence /status.
@app.get("/status")
def status():
    return {"ok": True}


@app.post("/score")
def score(req: ScoreRequest, request: Request):
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
    check_limits(ip)

    kind = "mobile app event" if req.source == "device" else "cloud event"
    serialized = f"{kind} — custom signal. text: {req.text}"

    from google.genai import types

    resp = client().models.embed_content(
        model="text-embedding-005",
        contents=[serialized],
        config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY"),
    )
    v = np.array(resp.embeddings[0].values)
    v = v / np.linalg.norm(v)

    sims = CENTROIDS @ v
    z = np.exp((sims - sims.max()) / TEMP)
    aff = z / z.sum()

    coord = (v - PCA_MEAN) @ PCA_COMP.T
    xy = (coord - PCA_LO) / (PCA_HI - PCA_LO) * 0.88 + 0.06
    xy = np.clip(xy, 0.02, 0.98)

    return {
        "serialized": serialized,
        "sims": {a: round(float(s), 4) for a, s in zip(AXES, sims)},
        "affinities": {a: round(float(x), 4) for a, x in zip(AXES, aff)},
        "dominant": AXES[int(np.argmax(sims))],
        "strength": round(float(sims.max()), 4),
        "xy": [round(float(xy[0]), 4), round(float(xy[1]), 4)],
    }
