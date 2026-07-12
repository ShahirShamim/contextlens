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
