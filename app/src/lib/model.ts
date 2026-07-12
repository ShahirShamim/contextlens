/* Data model, scoring math, and demo constants.
 *
 * The scoring formulas mirror pipeline/build.py exactly:
 *   w_i        = trust(source) * exp(-lambda * age_days)   (decay can be
 *                counterfactually disabled)
 *   v_i        = affinity(upgrade_intent) - affinity(churn_risk)
 *   net        = sum(w_i * v_i) / sum(w_i)
 *   confidence = 100 * sigmoid(k * |net|)
 *   drift      = weightedStd(v_i) / drift_scale
 */

export interface SignalEvent {
  id: string;
  t_offset_ms: number;
  source: "device" | "cloud";
  source_label: string;
  event_type: string;
  age_days: number;
  payload: Record<string, unknown>;
  serialized: string;
  sims: Record<string, number>;
  affinities: Record<string, number>;
  dominant: string;
  strength: number;
  xy: [number, number];
  top_fields: { field: string; delta: number }[];
}

export interface Scenario {
  id: string;
  label: string;
  button: string;
  description: string;
  events: SignalEvent[];
}

export interface Model {
  meta: {
    generated_at: string;
    backend: string;
    embed_dims: number;
    pca_var_explained: number;
    avg_signal_chars: number;
    params: {
      lambda_decay_per_day: number;
      source_trust: Record<string, number>;
      softmax_temp: number;
      sigmoid_k: number;
      confidence_floor_pct: number;
      drift_scale: number;
      drift_limit: number;
      latency_budget_ms: number;
    };
  };
  pricing: { embed_usd_per_1k_chars: number; note: string };
  eval: {
    methodology: string;
    rows: { segment: string; precision: number; recall: number; n: number }[];
    suppression_rate_pct: number;
  };
  subscriber: { user_id: string; plan: string; tenure_months: number; region: string };
  axes: {
    id: string;
    label: string;
    short: string;
    centroid_xy: [number, number];
    anchors: { phrase: string; xy: [number, number] }[];
  }[];
  scenarios: Scenario[];
}

export type Params = Model["meta"]["params"];

export interface ScoredRow {
  ev: SignalEvent;
  w: number;
  v: number;
  wv: number;
  share: number;
}

export interface Aggregate {
  rows: ScoredRow[];
  net: number;
  confidence: number;
  drift: number;
  suppressed: boolean;
  drifting: boolean;
}

export function weight(ev: SignalEvent, P: Params, decayOn: boolean): number {
  return P.source_trust[ev.source] * (decayOn ? Math.exp(-P.lambda_decay_per_day * ev.age_days) : 1);
}

export function aggregate(events: SignalEvent[], P: Params, decayOn: boolean): Aggregate {
  const rows: ScoredRow[] = events.map((ev) => {
    const w = weight(ev, P, decayOn);
    const v = ev.affinities.upgrade_intent - ev.affinities.churn_risk;
    return { ev, w, v, wv: w * v, share: 0 };
  });
  const sumW = rows.reduce((a, r) => a + r.w, 0);
  const net = rows.reduce((a, r) => a + r.wv, 0) / sumW;
  const confidence = 100 / (1 + Math.exp(-P.sigmoid_k * Math.abs(net)));
  const drift =
    Math.sqrt(rows.reduce((a, r) => a + r.w * (r.v - net) ** 2, 0) / sumW) / P.drift_scale;
  const sumAbs = rows.reduce((a, r) => a + Math.abs(r.wv), 0);
  rows.forEach((r) => (r.share = sumAbs ? Math.abs(r.wv) / sumAbs : 0));
  return {
    rows,
    net,
    confidence,
    drift,
    suppressed: confidence < P.confidence_floor_pct,
    drifting: drift > P.drift_limit,
  };
}

export function segmentOf(agg: Aggregate): string {
  if (agg.suppressed) return "Indeterminate — General Baseline";
  return agg.net > 0
    ? "High-Value Upgrade Propensity (Unlimited 5G)"
    : "Churn Risk — Retention Route";
}

export type StatusKind = "good" | "warning" | "critical";

export function statusOf(agg: Aggregate, P: Params): { kind: StatusKind; icon: string; text: string } {
  if (agg.suppressed)
    return { kind: "critical", icon: "⛔", text: `Suppressed — confidence < ${P.confidence_floor_pct}% floor` };
  if (agg.drifting)
    return { kind: "warning", icon: "⚠", text: "Verified — downstream activation muted (signal drift)" };
  return { kind: "good", icon: "✓", text: "Verified & trusted — cleared for activation" };
}

/* ------------------------------------------------------------------ privacy
 * Differential-privacy simulation for the "Privacy Twin" view: seeded Laplace
 * noise on each signal's affinity vector. Deterministic per (event, epsilon)
 * so the demo is stable across re-renders and repeat visits.
 */

const DP_SENSITIVITY = 0.12;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Epsilon = number | null; // null = privacy noise off (ε → ∞)

export const EPSILONS: { value: Epsilon; label: string }[] = [
  { value: null, label: "off" },
  { value: 5, label: "ε=5" },
  { value: 2, label: "ε=2" },
  { value: 1, label: "ε=1" },
  { value: 0.5, label: "ε=0.5" },
];

// A noisy channel must not read as a confident one: the confidence readout's
// k is discounted by the injected Laplace variance (2b²), so tightening ε
// honestly widens uncertainty instead of letting noise inflate |net|.
const DP_VARIANCE_PENALTY = 30;

export function dpPenalizedParams(P: Params, epsilon: Epsilon): Params {
  if (epsilon === null) return P;
  const variance = 2 * (DP_SENSITIVITY / epsilon) ** 2;
  return { ...P, sigmoid_k: P.sigmoid_k / (1 + DP_VARIANCE_PENALTY * variance) };
}

export function applyPrivacyNoise(events: SignalEvent[], epsilon: Epsilon): SignalEvent[] {
  if (epsilon === null) return events;
  const b = DP_SENSITIVITY / epsilon; // Laplace scale
  return events.map((ev) => {
    const rand = mulberry32(hashString(`${ev.id}:${epsilon}`));
    const laplace = () => {
      const u = rand() - 0.5;
      return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    };
    const affinities: Record<string, number> = {};
    for (const [k, v] of Object.entries(ev.affinities)) {
      affinities[k] = Math.min(1, Math.max(0, v + laplace()));
    }
    return { ...ev, affinities };
  });
}

/* ------------------------------------------------------- agent decision
 * Layer-5 analogue: what the (simulated) marketing agent does with the
 * verdict. Purely derived from the aggregate — the guardrails gate it.
 */

export function agentDecision(agg: Aggregate, P: Params): { kind: StatusKind | "idle"; text: string } {
  if (agg.suppressed)
    return { kind: "critical", text: "no action — general baseline only, nothing personalized" };
  if (agg.drifting)
    return { kind: "warning", text: "action drafted — held by drift guardrail, nothing sent downstream" };
  if (agg.confidence >= P.confidence_floor_pct && agg.net > 0)
    return { kind: "good", text: "→ queue “Unlimited 5G upgrade” offer · in-app push, next session" };
  return { kind: "good", text: "→ retention journey · care callback within 24h" };
}

/* ------------------------------------------------- Intent HQ layer map
 * Source: intenthq.com/deeptech ("Seven layers. One architecture."), July
 * 2026. This demo is an independent simplification, not their implementation.
 */

export const LAYER_MAP: { layer: string; theirs: string; ours: string; simplified: string }[] = [
  {
    layer: "1 · Edge AI",
    theirs: "“Real-time customer context, generated on the device and kept private by design”",
    ours: "Device signals scored on-device; only the 3-axis vector crosses (feed privacy lines)",
    simplified: "Scoring is precomputed/simulated, not a real on-device SDK",
  },
  {
    layer: "2 · Deep Signal",
    theirs: "“Behaviour at production scale, made usable while the moment still matters”",
    ours: "Live telemetry feed — async device + cloud events for one subscriber",
    simplified: "5–6 authored events vs. their 250B events/day",
  },
  {
    layer: "3 · Intent AI",
    theirs: "“AI that reads the shape of a decision, not just the record of an action” — intent vectors",
    ours: "Semantic map + axis affinities: every signal becomes an intent vector via real embeddings",
    simplified: "3 axes and cosine-to-anchor scoring vs. learned models",
  },
  {
    layer: "4 · Privacy Twins",
    theirs: "“A privacy-preserving behavioural replica that keeps the value of the signal without exposing the person”",
    ours: "ε-budget control: real Laplace noise on vectors, utility cost shown honestly",
    simplified: "Illustrative k-anonymity cohort; single-user demo can't aggregate",
  },
  {
    layer: "5 · Marketing Agents",
    theirs: "“Turn detected intent into timely action while the opportunity still exists”",
    ours: "Agent decision line — action queued, held by drift, or withheld entirely",
    simplified: "One hardcoded next-best-action per verdict",
  },
  {
    layer: "6 · IntentOne",
    theirs: "Hub for “data, audiences, agents, activation, and governance”",
    ours: "Guardrails panel — latency budget, confidence floor, drift mute",
    simplified: "Three rules vs. a governance platform",
  },
  {
    layer: "7 · Built to Scale",
    theirs: "“Scale only matters if the intelligence stays individual”",
    ours: "Unit-economics tiles — embed once at ingest, ≈$0 marginal inference",
    simplified: "Cost math shown for one user, not 320M profiles",
  },
];

export const API_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8081"
  : "https://contextlens-api-619062244311.europe-west1.run.app";

export const REPO_URL = "https://github.com/ShahirShamim/contextlens";

export const PRESETS = [
  { label: "😤 asked how to cancel", text: "asked support how to cancel service", source: "cloud" as const, age: 9 },
  { label: "🔍 compared unlimited plans", text: "spent ten minutes comparing unlimited 5G plan prices", source: "device" as const, age: 0 },
  { label: "💳 payment failed twice", text: "monthly payment failed twice this month", source: "cloud" as const, age: 3 },
  { label: "📱 checked trade-in value", text: "checked trade-in value for current phone", source: "device" as const, age: 0 },
];

export const CAPTIONS: Record<string, [number, string][]> = {
  baseline: [
    [500, "Two sources stream in for one subscriber: on-device SDK events (blue) and cloud webhooks (orange)."],
    [2600, "Device payloads are scored on the phone — only a 3-number vector crosses to the cloud. 🔒"],
    [5200, "Every signal lands in the semantic space and the attribution recomposes — hover any dot or bar."],
    [8600, "Fresh, coherent evidence → high confidence. All three guardrails green: cleared for activation."],
  ],
  conflict: [
    [600, "Fresh device signals show intense upgrade intent…"],
    [2800, "…but the cloud delivers a 9-day-old cancel enquiry and a failed payment. The sources disagree."],
    [6200, "Exponential time decay weighs the stale churn evidence at ~0.3× — the tie breaks toward fresh intent."],
    [10200, "Confidence drops honestly, and drift mutes downstream activation. Flip “time decay” to see the counterfactual."],
  ],
  sparse: [
    [600, "Now the signals are weak, stale and ambiguous."],
    [4400, "Evidence never accumulates — confidence stays under the 70% floor."],
    [8200, "So the system refuses to emit a segment: routed to the general baseline. No guess, no damage."],
  ],
};
