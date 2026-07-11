# ContextLens

**Explainable intent resolution — from raw fragmented signals to an auditable score.**

A working, interactive demo of how behavioral prediction can be made *legible*: raw
telemetry for one mock telco subscriber streams in from two fragmented sources (an
on-device SDK and cloud webhooks), maps into a shared semantic embedding space, and
resolves into a propensity score where **every percentage point is traceable to a
signal** — or, when the evidence doesn't support a prediction, into an explicit,
guardrailed refusal to predict.

<!-- Live demo: URL added after Cloud Run deploy -->

![ContextLens — conflict scenario](docs/screenshot-conflict.png)

## Why this exists

Enterprise buyers routinely stall or reject behavioral targeting products on one
objection: *"you can't tell me why the model said that."* Sales teams then either
over-promise ("the AI just knows") or under-sell. This project is a product
exploration of the counter: what does a scoring pipeline look like when
explainability, conflict handling, and knowing-when-not-to-infer are the product,
not an afterthought?

It's an independent portfolio project, inspired by the architecture that
intent-analytics platforms such as Intent HQ describe publicly (privacy-first
on-device signals fused with cloud event streams). It is not affiliated with or
endorsed by any company.

## The three scenarios

| Scenario | What happens | What it demonstrates |
|---|---|---|
| **Baseline session** (`?play=baseline`) | Fresh, coherent device + cloud signals | High-confidence prediction, full attribution, all guardrails green |
| **Asynchronous conflict** (`?play=conflict`) | Fresh on-device upgrade signals vs. week-old cloud churn signals (a cancel enquiry, a failed payment) | Exponential time decay resolves the tie; confidence honestly drops from ~86% to ~75%; the drift guardrail **mutes downstream activation** while sources disagree |
| **Sparse / drifting** (`?play=sparse`) | Weak, stale, ambiguous signals | Confidence falls below the 70% floor — the system routes to a general baseline and **emits no segment** rather than guessing |

## What's real vs. what's simulated

Honesty table — this demo argues against black boxes, so it doesn't get to be one:

| Component | Real or simulated? |
|---|---|
| Scenario telemetry (the events themselves) | **Authored.** Hand-written to tell three specific stories, and worded so the embedding math produces the intended shapes. Disclosed here on purpose. |
| Embeddings | **Real.** Every signal and anchor phrase is embedded with a real model (Vertex AI `text-embedding-005`, or sentence-transformers MiniLM via `--local`). Nothing is hand-assigned a score. |
| Axis affinities (Upgrade Intent / Engagement Depth / Churn Risk) | **Real math.** Cosine similarity to anchor-phrase centroids, softmax-normalized. Precomputed by the pipeline. |
| Field-level attribution | **Real math.** Leave-one-out ablation: each payload field is removed, the signal re-embedded, and the cosine delta is that field's contribution. |
| Final score, confidence, drift, attribution shares | **Real math, computed live in your browser** from the precomputed affinities — the formulas are shown in the UI (“How is this computed?”). |
| 2D semantic map | **Real projection.** PCA of the embedding space (variance shown in the UI). |
| Model health ledger (precision/recall) | **Illustrative.** Labeled as such in the UI — scoring a simulator against its own authored ground truth would be circular theater. |
| Latency guardrail | **Real measurement, simulated stakes.** Actual client-side compute time against a 250ms budget. |

## How the score is computed

Each signal `i` gets a weight and a signed evidence value:

```
w_i        = trust(source) · e^(−λ · age_days)         λ = 0.13/day; trust: device 1.0, cloud 0.85
v_i        = affinity(upgrade_intent) − affinity(churn_risk)
net        = Σ w_i·v_i / Σ w_i
confidence = 100 · σ(k · |net|)                        k = 4
drift      = weighted_std(v_i) / 0.30
```

Attribution share is each signal's fraction of total weighted evidence,
`|w_i·v_i| / Σ|w_j·v_j|` — so the attribution bars always decompose the score
exactly, and the UI's expandable math table shows every intermediate number.

The conflict tie-break is not a heuristic bolted on top: it *is* the time-decay
weight. A 9-day-old churn signal keeps its (real, embedding-derived) churn
affinity, but carries `e^(−0.13·9) ≈ 0.31×` the weight of a fresh signal.

## Guardrails — knowing when not to infer

Three rules, forming an escalation ladder the scenarios walk through:

1. **Latency budget (250ms).** Over budget → serve the cloud heuristic cache
   instead of the semantic layer.
2. **Drift limit (1.5).** Sources disagree beyond the limit → the prediction is
   still shown, but downstream bidding/activation triggers are **muted**. A
   prediction and permission to act on it are different things.
3. **Confidence floor (70%).** Below the floor → no segment is emitted at all;
   the user is routed to the general baseline.

## Architecture

```
pipeline/ (Python, runs once at build time)                 web/ (static, no backend)
┌──────────────────────────────────────────────┐            ┌──────────────────────────┐
│ scenarios.py   authored raw telemetry        │            │ index.html / styles.css  │
│ anchors.py     axis anchor phrases           │            │ app.js                   │
│ build.py    →  embed (Vertex AI / MiniLM)    │──model.json→  · playback engine       │
│                cosine affinities, ablations, │            │  · live scoring (same    │
│                PCA coords, calibration check │            │    formulas as build.py) │
└──────────────────────────────────────────────┘            └──────────────────────────┘
```

Embedding once at ingest and doing runtime inference as pure arithmetic on cached
vectors is also the unit-economics story: ~$0.003 of embedding per 1,000 signals,
and a marginal inference cost of approximately zero.

## Run it yourself

```bash
# 1. Precompute (local embedding model, no cloud account needed)
python -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
cd pipeline && ../.venv/bin/python build.py --local

# 2. Serve the UI
cd ../web && python3 -m http.server 8000
# open http://localhost:8000
```

`build.py` prints a calibration report and exits non-zero if the three scenarios
stop hitting their intended confidence shapes — edit `anchors.py` /
`scenarios.py` and re-run.

To use Vertex AI embeddings instead:

```bash
gcloud auth application-default login
../.venv/bin/python build.py --project YOUR_GCP_PROJECT
```

## Deploy (Cloud Run)

```bash
gcloud run deploy contextlens --source web/ --region europe-west2 --allow-unauthenticated
```

The container is nginx serving the static bundle; Cloud Run scales it to zero
between visits.

---

*Built as a product-thinking portfolio piece: the interesting decisions here are
which numbers to show, which to suppress, and how to earn trust in the ones that
remain.*
