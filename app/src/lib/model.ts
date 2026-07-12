/* Data model, scoring math, and demo constants — vertical-agnostic.
 *
 * The scoring formulas mirror pipeline/build.py exactly:
 *   w_i        = trust(source) * exp(-lambda * age_days)   (decay can be
 *                counterfactually disabled)
 *   v_i        = affinity(positive axis) - affinity(negative axis)
 *   net        = sum(w_i * v_i) / sum(w_i)
 *   confidence = 100 * sigmoid(k * |net|)
 *   drift      = weightedStd(v_i) / drift_scale
 *
 * Each vertical declares its own axes (with polarity), segments, labels and
 * params — the engine doesn't know what a telco, marketplace or fintech is.
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

export interface Axis {
  id: string;
  label: string;
  short: string;
  polarity: "positive" | "neutral" | "negative";
  centroid_xy: [number, number];
  anchors: { phrase: string; xy: [number, number] }[];
}

export interface Params {
  lambda_decay_per_day: number;
  source_trust: Record<string, number>;
  softmax_temp: number;
  sigmoid_k: number;
  confidence_floor_pct: number;
  drift_scale: number;
  drift_limit: number;
  latency_budget_ms: number;
}

export interface Vertical {
  id: string;
  label: string;
  description: string;
  entity: { id: string; summary: string };
  segments: { positive: string; negative: string; indeterminate: string };
  attr_scale: { left: string; right: string };
  business: {
    problem: string;
    approach: string;
    rows: { metric: string; traditional: string; contextlens: string }[];
    econ: { traditional_cost_usd: number; traditional_unit: string; resolution_label: string };
    math_note: string;
  };
  params: Params;
  eval: {
    methodology: string;
    rows: { segment: string; precision: number; recall: number; n: number }[];
    suppression_rate_pct: number;
  };
  axes: Axis[];
  scenarios: Scenario[];
}

export interface Model {
  meta: {
    generated_at: string;
    backend: string;
    embed_dims: number;
    pca_var_explained: Record<string, number>;
    avg_signal_chars: number;
  };
  pricing: { embed_usd_per_1k_chars: number; note: string };
  verticals: Vertical[];
}

export const polarityAxis = (v: Vertical, polarity: Axis["polarity"]) =>
  v.axes.find((a) => a.polarity === polarity)!.id;

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

export function aggregate(
  events: SignalEvent[],
  P: Params,
  decayOn: boolean,
  posAxis: string,
  negAxis: string
): Aggregate {
  const rows: ScoredRow[] = events.map((ev) => {
    const w = weight(ev, P, decayOn);
    const v = ev.affinities[posAxis] - ev.affinities[negAxis];
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

export function segmentOf(agg: Aggregate, vertical: Vertical): string {
  if (agg.suppressed) return vertical.segments.indeterminate;
  return agg.net > 0 ? vertical.segments.positive : vertical.segments.negative;
}

export type StatusKind = "good" | "warning" | "critical";

export function statusOf(agg: Aggregate, P: Params): { kind: StatusKind; icon: string; text: string } {
  if (agg.suppressed)
    return { kind: "critical", icon: "⛔", text: `Suppressed — confidence < ${P.confidence_floor_pct}% floor` };
  if (agg.drifting)
    return { kind: "warning", icon: "⚠", text: "Verified — downstream activation muted (signal drift)" };
  return { kind: "good", icon: "✓", text: "Verified & trusted — cleared for activation" };
}

/* ------------------------------------------------------------------ privacy */

const DP_SENSITIVITY = 0.12;
const DP_VARIANCE_PENALTY = 30;

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

export type Epsilon = number | null;

export const EPSILONS: { value: Epsilon; label: string }[] = [
  { value: null, label: "off" },
  { value: 5, label: "ε=5" },
  { value: 2, label: "ε=2" },
  { value: 1, label: "ε=1" },
  { value: 0.5, label: "ε=0.5" },
];

export function dpPenalizedParams(P: Params, epsilon: Epsilon): Params {
  if (epsilon === null) return P;
  const variance = 2 * (DP_SENSITIVITY / epsilon) ** 2;
  return { ...P, sigmoid_k: P.sigmoid_k / (1 + DP_VARIANCE_PENALTY * variance) };
}

export function applyPrivacyNoise(events: SignalEvent[], epsilon: Epsilon): SignalEvent[] {
  if (epsilon === null) return events;
  const b = DP_SENSITIVITY / epsilon;
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

/* --------------------------------------------------------- agent assist */

export function agentPhrase(ev: SignalEvent): string {
  const when = ev.age_days === 0 ? "this session" : `${ev.age_days}d ago`;
  const p = ev.payload as Record<string, string | number>;
  switch (ev.event_type) {
    case "app_screen_dwell":
      return `was on “${p.screen}” ${when}`;
    case "cart_event":
      return `${p.action} ${when}`;
    case "billing_event":
      return `billing: ${p.type} ${when}`;
    case "support_ticket":
      return `support contact ${when}: ${p.topic}`;
    case "web_visit":
      return `browsed ${p.url} ${when}`;
    case "network_probe":
      return `${p.action} ${when}`;
    case "marketing_event":
      return `${p.type} — ${p.campaign} ${when}`;
    case "app_open":
      return `opened the app on “${p.screen}” ${when}`;
    case "custom_signal":
      return `live signal ${when}: “${p.text}”`;
    case "tracking_page_view":
      return `tracking page ${when}: “${p.screen}”`;
    case "carrier_webhook":
      return `carrier ${when}: ${p.status}`;
    case "crm_event":
      return `CRM ${when}: ${p.note ?? p.type}`;
    case "app_search":
      return `searched “${p.query}” ${when}`;
    case "order_history_view":
      return `viewed past orders ${when}`;
    case "transfer_retry":
      return `${p.action} ${when}${p.attempts_today ? ` (${p.attempts_today}× today)` : ""}`;
    case "card_action":
      return `${p.action} ${when}`;
    case "dispute_webhook":
      return `dispute system ${when}: ${p.type}`;
    case "case_history":
      return `history ${when}: ${p.type}`;
    case "survey_event":
      return `survey ${when}: ${p.score ?? p.type}`;
    default:
      return `${ev.event_type.replace(/_/g, " ")} ${when}`;
  }
}

export interface AgentPlay {
  kind: StatusKind;
  verb: "ACT" | "EXPLORE" | "LISTEN";
  headline: string;
  steps: string[];
}

export function agentPlay(agg: Aggregate, vertical: Vertical): AgentPlay {
  const top = [...agg.rows].sort((a, b) => b.share - a.share);
  const topPos = top.find((r) => r.v >= 0);
  const topNeg = top.find((r) => r.v < 0);
  const verb: AgentPlay["verb"] = agg.suppressed ? "LISTEN" : agg.confidence >= 85 ? "ACT" : "EXPLORE";
  const conf = agg.confidence.toFixed(0);

  if (agg.suppressed) {
    const byVertical: Record<string, string[]> = {
      telco: [
        "The system declines to presume intent below the 70% floor — open questions only",
        "Don't reference offers or churn risk; there's no evidence to anchor either",
        "Fresh signals from this call will rebuild the score in real time",
      ],
      marketplace: [
        "Too little signal — don't manufacture an intervention",
        "Unprompted 'don't worry!' messages create the anxiety they try to prevent",
        "If the buyer reaches out, treat it as fresh context, not a failure",
      ],
      fintech: [
        "No basis to jump the queue in either direction — standard track",
        "Priority is earned by evidence, not guesswork",
        "New friction signals will re-score the case in real time",
      ],
    };
    return {
      kind: "critical",
      verb,
      headline: vertical.id === "fintech" ? "Standard queue — no priority juggling" : "Listen — no reliable inference",
      steps: byVertical[vertical.id] ?? byVertical.telco,
    };
  }

  if (agg.drifting) {
    const byVertical: Record<string, { headline: string; steps: string[] }> = {
      telco: {
        headline: "Fix the friction first, then pivot",
        steps: [
          topNeg
            ? `Sources disagree — acknowledge the negative first: ${agentPhrase(topNeg.ev)}`
            : "Sources disagree — surface and resolve the friction before anything else",
          "Do NOT lead with a sales pitch while that friction is unresolved",
          topPos
            ? `Once resolved, pivot to their live interest: ${agentPhrase(topPos.ev)}`
            : "Once resolved, explore what brought them in today",
          "Automated activation is muted for this exact reason — the human closes the gap",
        ],
      },
      marketplace: {
        headline: "Acknowledge the worry — no chirpy template",
        steps: [
          topNeg
            ? `Carrier data disagrees with the buyer's mood: ${agentPhrase(topNeg.ev)}`
            : "Carrier data says fine; the buyer's behavior says otherwise",
          topPos ? `Open by acknowledging what they're doing: ${agentPhrase(topPos.ev)}` : "Open by acknowledging the wait",
          "Don't send the automated “it's on its way!” template — it reads as dismissive",
          "Offer tracking transparency or a small goodwill gesture; human tone required",
        ],
      },
      fintech: {
        headline: "History says patient — behavior says not anymore",
        steps: [
          topNeg
            ? `The record is reassuring (${agentPhrase(topNeg.ev)}) — don't rely on it today`
            : "The record is reassuring — don't rely on it today",
          topPos ? `Address the live friction first: ${agentPhrase(topPos.ev)}` : "Address the live friction first",
          "A personal call today beats an automated email tomorrow",
          "Automated routing is held while sources disagree — the human decides",
        ],
      },
    };
    const d = byVertical[vertical.id] ?? byVertical.telco;
    return { kind: "warning", verb, headline: d.headline, steps: d.steps };
  }

  if (agg.net > 0) {
    const byVertical: Record<string, { headline: string; steps: string[] }> = {
      telco: {
        headline: "Lead with the upgrade",
        steps: [
          `${verb === "ACT" ? "Offer" : "Explore"} Unlimited 5G directly — ${conf}% confidence, guardrails clear`,
          topPos ? `Anchor on their strongest signal: ${agentPhrase(topPos.ev)}` : "Anchor on their recent plan research",
          topNeg ? `Be ready for: ${agentPhrase(topNeg.ev)} — address it if raised, don't ignore it` : "No negative signals on file",
          "Close with in-app confirmation next session",
        ],
      },
      marketplace: {
        headline: "Reach out before they reach the contact form",
        steps: [
          `Send the proactive delay notice now — ${conf}% confidence, before the ticket exists`,
          topPos ? `They already know something's off: ${agentPhrase(topPos.ev)}` : "The buyer is already watching the tracking page",
          "Include the revised ETA and a small voucher — honesty beats spin",
          "Log the deflection so the WISMO model learns from the outcome",
        ],
      },
      fintech: {
        headline: "Escalate proactively — don't wait for the angry call",
        steps: [
          `Route to a senior agent with this brief — ${conf}% confidence`,
          topPos ? `Lead with the live friction: ${agentPhrase(topPos.ev)}` : "Lead with the live friction in the app",
          "Have goodwill / provisional credit pre-approved before dialing",
          "Don't make them repeat the story — the brief is the handoff",
        ],
      },
    };
    const d = byVertical[vertical.id] ?? byVertical.telco;
    return { kind: "good", verb, headline: d.headline, steps: d.steps };
  }

  const byVertical: Record<string, { headline: string; steps: string[] }> = {
    telco: {
      headline: "Retention play",
      steps: [
        "Churn evidence outweighs upgrade intent — lead with value, not price",
        topNeg ? `Address the strongest driver: ${agentPhrase(topNeg.ev)}` : "Probe for the friction driving churn signals",
        "Offer a retention credit before they ask for a cancellation path",
      ],
    },
    marketplace: {
      headline: "On track — don't interfere",
      steps: [
        "Delivery confidence dominates — outreach would create the anxiety it prevents",
        topNeg ? `Everything supports silence: ${agentPhrase(topNeg.ev)}` : "The carrier trail is clean",
        "Keep monitoring; only a new negative signal changes the play",
      ],
    },
    fintech: {
      headline: "Self-serve track — let the flow land",
      steps: [
        "Resolution confidence dominates — the automated flow will resolve this",
        topNeg ? `The record backs it: ${agentPhrase(topNeg.ev)}` : "History supports self-serve",
        "Don't interrupt with a call they don't need; escalate only on new friction",
      ],
    },
  };
  const d = byVertical[vertical.id] ?? byVertical.telco;
  return { kind: "good", verb, headline: d.headline, steps: d.steps };
}

export function agentDecision(agg: Aggregate, vertical: Vertical): { kind: StatusKind; text: string } {
  if (agg.suppressed) {
    const t: Record<string, string> = {
      telco: "no action — general baseline only, nothing personalized",
      marketplace: "no outreach — general queue, nothing sent",
      fintech: "no routing change — standard queue",
    };
    return { kind: "critical", text: t[vertical.id] ?? t.telco };
  }
  if (agg.drifting) {
    const t: Record<string, string> = {
      telco: "action drafted — held by drift guardrail, nothing sent downstream",
      marketplace: "outreach drafted — automated template held by drift guardrail",
      fintech: "routing drafted — automation held by drift guardrail",
    };
    return { kind: "warning", text: t[vertical.id] ?? t.telco };
  }
  if (agg.net > 0) {
    const t: Record<string, string> = {
      telco: "→ queue “Unlimited 5G upgrade” offer · in-app push, next session",
      marketplace: "→ send proactive delay notice + voucher · push, now",
      fintech: "→ route to senior agent · case briefed, priority queue",
    };
    return { kind: "good", text: t[vertical.id] ?? t.telco };
  }
  const t: Record<string, string> = {
    telco: "→ retention journey · care callback within 24h",
    marketplace: "→ suppress outreach · on track, don't interfere",
    fintech: "→ keep on self-serve track · automated resolution",
  };
  return { kind: "good", text: t[vertical.id] ?? t.telco };
}

/* ------------------------------------------------- Intent HQ layer map */

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
    ours: "Live telemetry feed — async device + cloud events, three industries, one engine",
    simplified: "A handful of authored events vs. their 250B events/day",
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
    ours: "Agent decision line + agent console — action queued, held by drift, or withheld entirely",
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

export interface Preset {
  label: string;
  text: string;
  source: "device" | "cloud";
  age: number;
}

export const PRESETS: Record<string, Preset[]> = {
  telco: [
    { label: "😤 asked how to cancel", text: "asked support how to cancel service", source: "cloud", age: 9 },
    { label: "🔍 compared unlimited plans", text: "spent ten minutes comparing unlimited 5G plan prices", source: "device", age: 0 },
    { label: "💳 payment failed twice", text: "monthly payment failed twice this month", source: "cloud", age: 3 },
    { label: "📱 checked trade-in value", text: "checked trade-in value for current phone", source: "device", age: 0 },
  ],
  marketplace: [
    { label: "😟 checked tracking again", text: "checked the order tracking page for the fifth time today", source: "device", age: 0 },
    { label: "🚚 carrier: delayed", text: "carrier reports the package is delayed at the sort facility", source: "cloud", age: 0 },
    { label: "💬 searched courier contact", text: "searched how to contact the courier about my order", source: "device", age: 0 },
    { label: "✅ scan on schedule", text: "carrier scan shows the package on schedule and arriving on time", source: "cloud", age: 0 },
  ],
  fintech: [
    { label: "😡 third transfer retry", text: "retried the failed transfer for the third time today", source: "device", age: 0 },
    { label: "🧊 froze the card", text: "froze the card after spotting a disputed charge", source: "device", age: 0 },
    { label: "📄 read resolution FAQ", text: "calmly read the dispute resolution FAQ", source: "device", age: 0 },
    { label: "✅ accepted refund timeline", text: "accepted the proposed refund timeline without complaint", source: "cloud", age: 3 },
  ],
};

export const CAPTIONS: Record<string, Record<string, [number, string][]>> = {
  telco: {
    baseline: [
      [500, "Two sources stream in for one subscriber: on-device SDK events (blue) and cloud webhooks (orange)."],
      [2600, "Device payloads are scored on the phone — only a 3-number vector crosses to the cloud. 🔒"],
      [5200, "Every signal lands in the semantic space and the attribution recomposes — hover any dot or bar."],
      [9600, "Even a stale churn whisper shows up — decayed to a small red counterweight, visible, never hidden."],
      [13400, "Fresh, coherent evidence → high confidence. All three guardrails green: cleared for activation."],
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
  },
  marketplace: {
    baseline: [
      [500, "A buyer and their order: device signals (blue), carrier and CRM webhooks (orange)."],
      [2600, "The carrier reports a delay — while the buyer is already refreshing the tracking page."],
      [5600, "WISMO risk climbs with every anxious signal. The support ticket doesn't exist yet."],
      [9000, "High confidence: reach out before they reach the contact form. Deflection, not reaction."],
    ],
    conflict: [
      [600, "The buyer keeps checking tracking this morning…"],
      [2800, "…but day-old carrier scans insist everything is on time. The sources disagree."],
      [6200, "Delivery context decays fast (λ=0.45/day here) — fresh anxiety outweighs yesterday's reassurance."],
      [10200, "Outreach is warranted, but the automated template is muted — a human should acknowledge the worry."],
    ],
    sparse: [
      [600, "Label created, one casual app open — the order is barely underway."],
      [4200, "Nothing accumulates. Guessing an intervention would create the very contact it fears."],
      [7400, "Suppressed: general queue. Sometimes silence is the best CX."],
    ],
  },
  fintech: {
    baseline: [
      [500, "A dispute case: in-app behavior (blue) plus dispute and support webhooks (orange)."],
      [2600, "A retry loop and a card freeze — live distress, scored on-device."],
      [5600, "Escalation risk compounds; the chargeback webhook confirms the stakes."],
      [9000, "Route to a senior agent with the brief — before the angry call happens."],
    ],
    conflict: [
      [600, "Live behavior: retries, card frozen, status checks…"],
      [2800, "…but the record says this customer resolves things amicably — refund accepted, 9/10 CSAT."],
      [6200, "Decay sides with today: history says patient, behavior says not anymore."],
      [10200, "Escalation likely — but automated routing holds while sources disagree. Call them today."],
    ],
    sparse: [
      [600, "Case open, merchant silent, customer barely active."],
      [4200, "No basis to jump the queue in either direction."],
      [7400, "Standard track — priority is earned by evidence, not guesswork."],
    ],
  },
};
