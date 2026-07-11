/* ContextLens front-end.
 *
 * Everything displayed is computed here, live, from the precomputed embedding
 * scores in data/model.json — the same formulas as pipeline/build.py:
 *
 *   w_i        = trust(source) * exp(-lambda * age_days)
 *   v_i        = affinity(upgrade_intent) - affinity(churn_risk)
 *   net        = sum(w_i * v_i) / sum(w_i)
 *   confidence = 100 * sigmoid(k * |net|)
 *   drift      = weightedStd(v_i) / drift_scale
 */

(async function () {
  const model = await fetch("data/model.json").then((r) => r.json());
  const P = model.meta.params;

  // Live-scoring endpoint (embeds free-text signals via Vertex AI).
  const API_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:8081"
    : "https://contextlens-api-619062244311.europe-west1.run.app";

  let decayOn = new URLSearchParams(location.search).get("decay") !== "0";
  let tourOn = localStorage.getItem("contextlens_tour") !== "0";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------------------------------------------------------------- scoring

  const weight = (ev) =>
    P.source_trust[ev.source] * (decayOn ? Math.exp(-P.lambda_decay_per_day * ev.age_days) : 1);

  function aggregate(events) {
    const rows = events.map((ev) => {
      const w = weight(ev);
      const v = ev.affinities.upgrade_intent - ev.affinities.churn_risk;
      return { ev, w, v, wv: w * v };
    });
    const sumW = rows.reduce((a, r) => a + r.w, 0);
    const net = rows.reduce((a, r) => a + r.wv, 0) / sumW;
    const confidence = 100 / (1 + Math.exp(-P.sigmoid_k * Math.abs(net)));
    const drift =
      Math.sqrt(rows.reduce((a, r) => a + r.w * (r.v - net) ** 2, 0) / sumW) / P.drift_scale;
    const sumAbs = rows.reduce((a, r) => a + Math.abs(r.wv), 0);
    rows.forEach((r) => (r.share = sumAbs ? Math.abs(r.wv) / sumAbs : 0));

    const suppressed = confidence < P.confidence_floor_pct;
    const drifting = drift > P.drift_limit;
    return { rows, net, confidence, drift, suppressed, drifting };
  }

  // ------------------------------------------------------------ static bits

  const sub = model.subscriber;
  $("subscriber-chip").innerHTML =
    `<b>${esc(sub.user_id)}</b> · ${esc(sub.plan)} · tenure ${sub.tenure_months}mo · ${esc(sub.region)}`;

  $("meta-line").textContent =
    `embeddings: ${model.meta.backend} (${model.meta.embed_dims}d) · ` +
    `2D map: PCA, ${(model.meta.pca_var_explained * 100).toFixed(0)}% variance · ` +
    `built ${model.meta.generated_at.slice(0, 10)}`;

  $("map-sub").textContent =
    `PCA of ${model.meta.embed_dims}-d embedding space (${(model.meta.pca_var_explained * 100).toFixed(0)}% var)`;

  // Eval table (static, honestly labeled)
  {
    const t = $("eval-table");
    t.innerHTML =
      `<tr><th>Segment</th><th>Precision</th><th>Recall</th><th>n</th></tr>` +
      model.eval.rows
        .map(
          (r) =>
            `<tr><td>${esc(r.segment)}</td><td>${r.precision.toFixed(2)}</td>` +
            `<td>${r.recall.toFixed(2)}</td><td>${r.n}</td></tr>`
        )
        .join("") +
      `<tr><td>Suppressed (routed to baseline)</td><td colspan="3">${model.eval.suppression_rate_pct}% of sessions</td></tr>`;
    $("eval-sub").textContent = "illustrative offline eval";
    const foot = document.createElement("p");
    foot.className = "eval-foot";
    foot.textContent = model.eval.methodology;
    t.after(foot);
  }

  // ------------------------------------------------------------ semantic map

  const SVGNS = "http://www.w3.org/2000/svg";
  const map = $("map");
  const W = 600, H = 460;
  const px = (xy) => [xy[0] * W, xy[1] * H];

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    (parent || map).appendChild(el);
    return el;
  }

  for (const axis of model.axes) {
    const [cx, cy] = px(axis.centroid_xy);
    for (const a of axis.anchors) {
      const [x, y] = px(a.xy);
      const dot = svgEl("circle", { cx: x, cy: y, r: 3, class: "anchor-dot" });
      const title = document.createElementNS(SVGNS, "title");
      title.textContent = `${axis.label} anchor: “${a.phrase}”`;
      dot.appendChild(title);
    }
    svgEl("rect", {
      x: cx - 5, y: cy - 5, width: 10, height: 10,
      class: "centroid", transform: `rotate(45 ${cx} ${cy})`,
    });
    svgEl("text", {
      x: cx, y: cy - 12, class: "centroid-label",
      "text-anchor": "middle",
    }).textContent = axis.label;
  }

  const dotById = {}, hitById = {}, evById = {};
  function addEventGeometry(ev) {
    const [x, y] = px(ev.xy);
    dotById[ev.id] = svgEl("circle", {
      cx: x, cy: y, r: 4 + ev.strength * 5,
      class: `event-dot src-${ev.source}`, "data-id": ev.id,
    });
    hitById[ev.id] = svgEl("circle", { cx: x, cy: y, r: 16, class: "hit", "data-id": ev.id });
    evById[ev.id] = ev;
  }
  const allEvents = model.scenarios.flatMap((sc) => sc.events);
  allEvents.forEach(addEventGeometry);
  let liveGeoms = [];

  // ---------------------------------------------------------------- tooltip

  const tooltip = $("tooltip");
  function showTooltip(ev, x, y) {
    const a = ev.affinities;
    const fields = (ev.top_fields || [])
      .slice(0, 2)
      .map((f) => `${f.field} (${f.delta >= 0 ? "+" : ""}${f.delta.toFixed(3)})`)
      .join(", ");
    const note = fields
      ? `strongest fields: ${esc(fields)} — cosine delta when removed`
      : "live signal — embedded via Vertex AI just now";
    tooltip.innerHTML =
      `<div class="tt-title">${esc(ev.event_type)} · ${ev.source} · ${ev.age_days}d old</div>` +
      `<div>${esc(ev.serialized)}</div>` +
      `<div class="tt-row"><span>Upgrade Intent</span><span>${(a.upgrade_intent * 100).toFixed(0)}%</span></div>` +
      `<div class="tt-row"><span>Engagement Depth</span><span>${(a.engagement_depth * 100).toFixed(0)}%</span></div>` +
      `<div class="tt-row"><span>Churn Risk</span><span>${(a.churn_risk * 100).toFixed(0)}%</span></div>` +
      `<div class="tt-note">${note}</div>`;
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.min(x + 14, innerWidth - r.width - 10) + "px";
    tooltip.style.top = Math.min(y + 14, innerHeight - r.height - 10) + "px";
  }
  const hideTooltip = () => (tooltip.hidden = true);

  map.addEventListener("mousemove", (e) => {
    const id = e.target.dataset && e.target.dataset.id;
    if (id && dotById[id].classList.contains("on")) {
      showTooltip(evById[id], e.clientX, e.clientY);
      setHighlight(id, true);
    } else {
      hideTooltip();
      setHighlight(null, false);
    }
  });
  map.addEventListener("mouseleave", () => { hideTooltip(); setHighlight(null, false); });

  let hlId = null;
  function setHighlight(id, on) {
    if (hlId && hlId !== id) {
      dotById[hlId].classList.remove("hl");
      const item = document.querySelector(`.feed-item[data-id="${hlId}"]`);
      if (item) item.classList.remove("hl");
    }
    hlId = on ? id : null;
    if (id && on) {
      dotById[id].classList.add("hl");
      const item = document.querySelector(`.feed-item[data-id="${id}"]`);
      if (item) item.classList.add("hl");
    }
  }

  // ------------------------------------------------------------------- feed

  const feed = $("feed");
  function feedItem(ev) {
    const ts = new Date(Date.now() - ev.age_days * 864e5);
    const item = document.createElement("div");
    item.className = `feed-item src-${ev.source}`;
    item.dataset.id = ev.id;
    const stale = ev.age_days > 2 ? ` <span class="stale">⏱ t−${ev.age_days}d (stale)</span>` : "";
    const payload = Object.entries(ev.payload)
      .map(([k, v]) => `  <span class="k">"${esc(k)}"</span>: <span class="v">${esc(JSON.stringify(v))}</span>`)
      .join(",\n");
    item.innerHTML =
      `<div class="feed-meta"><span class="src">${esc(ev.source_label)}</span>` +
      `<span>${ts.toISOString().slice(0, 19)}Z</span>${stale}</div>` +
      `<pre class="feed-json">{ <span class="k">"event"</span>: <span class="v">"${esc(ev.event_type)}"</span>,\n${payload} }</pre>`;
    const a = ev.affinities;
    const priv = document.createElement("div");
    if (ev.source === "device") {
      priv.className = "privacy-line device";
      priv.textContent =
        `🔒 scored on-device — only the vector [${a.upgrade_intent.toFixed(2)}, ` +
        `${a.engagement_depth.toFixed(2)}, ${a.churn_risk.toFixed(2)}] crosses to the cloud`;
    } else {
      priv.className = "privacy-line cloud";
      priv.textContent = "☁ raw payload transmitted server-side (webhook)";
    }
    item.appendChild(priv);
    item.addEventListener("mouseenter", () => setHighlight(ev.id, true));
    item.addEventListener("mouseleave", () => setHighlight(ev.id, false));
    feed.appendChild(item);
    feed.scrollTop = feed.scrollHeight;
  }

  // ------------------------------------------------------------ tour captions

  const CAPTIONS = {
    baseline: [
      [500, "Two sources stream in for one subscriber: on-device SDK events (blue) and cloud webhooks (green)."],
      [2600, "Device payloads are scored on the phone — only a 3-number vector crosses to the cloud. 🔒"],
      [5200, "Every signal lands in the semantic space and the attribution recomposes — hover any dot or bar."],
      [8600, "Fresh, coherent evidence → high confidence. All three guardrails green: cleared for activation."],
    ],
    conflict: [
      [600, "Fresh device signals show intense upgrade intent…"],
      [2800, "…but the cloud delivers a 9-day-old cancel enquiry and a failed payment. The sources disagree."],
      [6200, "Exponential time decay weighs the stale churn evidence at ~0.3× — the tie breaks toward fresh intent."],
      [10200, "Confidence drops honestly, and drift mutes downstream activation. Flip “time decay: ON” to see the counterfactual."],
    ],
    sparse: [
      [600, "Now the signals are weak, stale and ambiguous."],
      [4400, "Evidence never accumulates — confidence stays under the 70% floor."],
      [8200, "So the system refuses to emit a segment: routed to the general baseline. No guess, no damage."],
    ],
  };

  const captionEl = $("tour-caption");
  let captionHideTimer = null;
  function showCaption(text) {
    captionEl.textContent = text;
    captionEl.hidden = false;
    captionEl.classList.add("show");
    clearTimeout(captionHideTimer);
    captionHideTimer = setTimeout(() => captionEl.classList.remove("show"), 3600);
  }
  function hideCaption() {
    clearTimeout(captionHideTimer);
    captionEl.classList.remove("show");
    captionEl.hidden = true;
  }

  // -------------------------------------------------------------- verdict UI

  function statusOf(agg) {
    if (agg.suppressed)
      return { cls: "critical", icon: "⛔", text: `Suppressed — confidence < ${P.confidence_floor_pct}% floor` };
    if (agg.drifting)
      return { cls: "warning", icon: "⚠", text: "Verified — downstream activation muted (signal drift)" };
    return { cls: "good", icon: "✓", text: "Verified & trusted — cleared for activation" };
  }

  function segmentOf(agg) {
    if (agg.suppressed) return "Indeterminate — General Baseline";
    return agg.net > 0 ? "High-Value Upgrade Propensity (Unlimited 5G)" : "Churn Risk — Retention Route";
  }

  let inferences = 0, signalsSeen = 0;

  function renderVerdict(agg, latencyMs) {
    $("segment-value").textContent = segmentOf(agg);
    $("confidence-value").textContent = agg.confidence.toFixed(1) + "%";
    $("confidence-note").textContent =
      `net evidence ${agg.net >= 0 ? "+" : ""}${agg.net.toFixed(3)} · drift ${agg.drift.toFixed(2)}` +
      (decayOn ? "" : " · ⚠ counterfactual: time decay disabled");

    const st = statusOf(agg);
    const badge = $("status-badge");
    badge.className = "status-badge " + st.cls;
    badge.innerHTML = `<span class="badge-icon">${st.icon}</span><span class="badge-text">${st.text}</span>`;

    // Attribution bars: length = share of total |weighted evidence|, direction/color = evidence sign.
    const rows = [...agg.rows].sort((a, b) => b.share - a.share);
    const maxShare = rows[0] ? rows[0].share : 1;
    $("attr-bars").innerHTML = rows
      .map((r) => {
        const dir = r.v >= 0 ? "pos" : "neg";
        const w = maxShare ? (r.share / maxShare) * 48 : 0;
        const label = `${r.ev.event_type.replace(/_/g, " ")} · ${r.ev.source} · ${r.ev.age_days}d`;
        return (
          `<div class="attr-row" data-id="${r.ev.id}">` +
          `<div class="attr-label"><span class="who">${esc(label)}</span>` +
          `<span class="val">${r.v >= 0 ? "+" : "−"}${(r.share * 100).toFixed(0)}%</span></div>` +
          `<div class="attr-track"><div class="attr-fill ${dir}" style="width:${w}%"></div></div></div>`
        );
      })
      .join("");

    // Math expander
    $("math-body").innerHTML =
      `<div class="formula">${decayOn
        ? `wᵢ = trust(src)·e^(−λ·ageᵢ)      λ=${P.lambda_decay_per_day}/day · trust device=${P.source_trust.device.toFixed(2)}, cloud=${P.source_trust.cloud.toFixed(2)}`
        : `wᵢ = trust(src)      ⚠ COUNTERFACTUAL: λ forced to 0, stale signals at full weight`}\n` +
      `vᵢ = affinity(upgrade) − affinity(churn)\n` +
      `net = Σwᵢvᵢ / Σwᵢ = ${agg.net >= 0 ? "+" : ""}${agg.net.toFixed(3)}\n` +
      `confidence = σ(k·|net|) = ${agg.confidence.toFixed(1)}%      k=${P.sigmoid_k}\n` +
      `drift = weightedStd(vᵢ)/${P.drift_scale} = ${agg.drift.toFixed(2)}      mute &gt; ${P.drift_limit} · suppress &lt; ${P.confidence_floor_pct}% conf</div>` +
      `<table><tr><th>signal</th><th>src</th><th>age</th><th>wᵢ</th><th>U</th><th>E</th><th>C</th><th>vᵢ</th><th>wᵢvᵢ</th><th>share</th></tr>` +
      agg.rows
        .map((r) => {
          const a = r.ev.affinities;
          return (
            `<tr><td>${esc(r.ev.event_type)}</td><td>${r.ev.source}</td><td>${r.ev.age_days}d</td>` +
            `<td>${r.w.toFixed(2)}</td><td>${a.upgrade_intent.toFixed(2)}</td><td>${a.engagement_depth.toFixed(2)}</td>` +
            `<td>${a.churn_risk.toFixed(2)}</td><td>${r.v >= 0 ? "+" : ""}${r.v.toFixed(2)}</td>` +
            `<td>${r.wv >= 0 ? "+" : ""}${r.wv.toFixed(2)}</td><td>${(r.share * 100).toFixed(0)}%</td></tr>`
          );
        })
        .join("") +
      `</table>`;

    renderLamps(agg, latencyMs);
    renderEcon();
  }

  function lamp(cls, icon, rule, detail) {
    return `<li class="lamp ${cls}"><span class="icon">${icon}</span><span><span class="rule">${rule}</span><br><span class="detail">${detail}</span></span></li>`;
  }

  function renderLamps(agg, latencyMs) {
    const l = $("lamps");
    if (!agg) {
      l.innerHTML =
        lamp("", "·", `Latency budget ${P.latency_budget_ms}ms`, "over budget → fall back to cloud heuristic cache") +
        lamp("", "·", `Confidence floor ${P.confidence_floor_pct}%`, "below floor → route to general baseline, no segment emitted") +
        lamp("", "·", `Drift limit ${P.drift_limit}`, "sources disagree → mute downstream bidding triggers");
      return;
    }
    const okLat = latencyMs < P.latency_budget_ms;
    l.innerHTML =
      lamp(okLat ? "good" : "critical", okLat ? "✓" : "⛔",
        `Latency ${latencyMs < 0.1 ? "<0.1" : latencyMs.toFixed(1)}ms / ${P.latency_budget_ms}ms budget`,
        okLat ? "semantic layer served in time (client-side compute)" : "over budget → served cloud heuristic cache") +
      lamp(agg.suppressed ? "critical" : "good", agg.suppressed ? "⛔" : "✓",
        `Confidence ${agg.confidence.toFixed(1)}% vs ${P.confidence_floor_pct}% floor`,
        agg.suppressed ? "below floor → routed to general baseline, no segment emitted" : "above floor — segment may be emitted") +
      lamp(agg.drifting ? "warning" : "good", agg.drifting ? "⚠" : "✓",
        `Drift index ${agg.drift.toFixed(2)} vs ${P.drift_limit} limit`,
        agg.drifting ? "sources disagree → downstream bidding triggers muted" : "sources consistent — activation allowed");
  }

  function renderEcon() {
    const perSignalUsd = (model.meta.avg_signal_chars * model.pricing.embed_usd_per_1k_chars) / 1000;
    $("econ").innerHTML =
      `<div class="stat-tile"><div class="stat-label">Embedding cost / 1k signals</div>` +
      `<div class="stat-value">$${(perSignalUsd * 1000).toFixed(4)}</div>` +
      `<div class="stat-delta">once, at ingest (${model.meta.avg_signal_chars} chars avg)</div></div>` +
      `<div class="stat-tile"><div class="stat-label">Marginal inference cost</div>` +
      `<div class="stat-value">≈ $0</div><div class="stat-delta">arithmetic on cached vectors</div></div>` +
      `<div class="stat-tile"><div class="stat-label">Signals processed</div>` +
      `<div class="stat-value">${signalsSeen}</div><div class="stat-delta">this session</div></div>` +
      `<div class="stat-tile"><div class="stat-label">Inferences run</div>` +
      `<div class="stat-value">${inferences}</div><div class="stat-delta">re-scored on every signal</div></div>`;
  }

  // --------------------------------------------------------------- playback

  let timers = [];
  let activeEvents = [];

  function reset() {
    timers.forEach(clearTimeout);
    timers = [];
    activeEvents = [];
    hideCaption();
    feed.querySelectorAll(".feed-item").forEach((n) => n.remove());
    $("feed-empty").style.display = "";
    Object.values(dotById).forEach((d) => d.classList.remove("on"));
    liveGeoms.forEach((el) => el.remove());
    liveGeoms = [];
    $("segment-value").textContent = "—";
    $("confidence-value").textContent = "—";
    $("confidence-note").textContent = "";
    const badge = $("status-badge");
    badge.className = "status-badge";
    badge.innerHTML = `<span class="badge-icon">·</span><span class="badge-text">awaiting signals</span>`;
    $("attr-bars").innerHTML = `<div class="attr-empty">no signals yet</div>`;
    $("math-body").innerHTML = "";
    renderLamps(null);
  }

  function emit(ev) {
    $("feed-empty").style.display = "none";
    feedItem(ev);
    dotById[ev.id].classList.add("on");
    activeEvents.push(ev);
    signalsSeen += 1;

    const t0 = performance.now();
    const agg = aggregate(activeEvents);
    const latencyMs = performance.now() - t0;
    inferences += 1;
    renderVerdict(agg, latencyMs);
  }

  function play(scenarioId) {
    reset();
    const sc = model.scenarios.find((s) => s.id === scenarioId);
    document.querySelectorAll(".controls .btn[data-scenario]").forEach((b) =>
      b.classList.toggle("active", b.dataset.scenario === scenarioId)
    );
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    sc.events.forEach((ev, i) => {
      const delay = reduced ? i * 60 : ev.t_offset_ms;
      timers.push(setTimeout(() => emit(ev), delay));
    });
    if (tourOn && !reduced) {
      for (const [at, text] of CAPTIONS[scenarioId] || []) {
        timers.push(setTimeout(() => showCaption(text), at));
      }
    }
  }

  function refresh() {
    if (!activeEvents.length) return;
    const t0 = performance.now();
    const agg = aggregate(activeEvents);
    const latencyMs = performance.now() - t0;
    inferences += 1;
    renderVerdict(agg, latencyMs);
  }

  // --------------------------------------------------------------- controls

  const controls = $("controls");
  const helpBtn = $("help-btn");
  for (const sc of model.scenarios) {
    const b = document.createElement("button");
    b.className = "btn";
    b.dataset.scenario = sc.id;
    b.textContent = sc.button;
    b.title = sc.description;
    b.addEventListener("click", () => play(sc.id));
    controls.insertBefore(b, helpBtn);
  }

  const tourBtn = document.createElement("button");
  tourBtn.className = "btn";
  tourBtn.title = "Narrated captions during playback";
  const renderTourBtn = () => (tourBtn.textContent = tourOn ? "💬 tour: on" : "💬 tour: off");
  renderTourBtn();
  tourBtn.addEventListener("click", () => {
    tourOn = !tourOn;
    localStorage.setItem("contextlens_tour", tourOn ? "1" : "0");
    renderTourBtn();
    if (!tourOn) hideCaption();
  });
  controls.insertBefore(tourBtn, helpBtn);

  const decayBtn = $("decay-toggle");
  const renderDecayBtn = () => {
    decayBtn.textContent = decayOn ? "time decay: ON" : "time decay: OFF (counterfactual)";
    decayBtn.classList.toggle("off", !decayOn);
  };
  renderDecayBtn();
  decayBtn.addEventListener("click", () => {
    decayOn = !decayOn;
    renderDecayBtn();
    refresh();
  });

  // ------------------------------------------------------------- live signal

  fetch(API_URL + "/status").catch(() => {}); // warm the scoring service early

  const PRESETS = [
    { label: "😤 asked how to cancel", text: "asked support how to cancel service", source: "cloud", age: "9" },
    { label: "🔍 compared unlimited plans", text: "spent ten minutes comparing unlimited 5G plan prices", source: "device", age: "0" },
    { label: "💳 payment failed twice", text: "monthly payment failed twice this month", source: "cloud", age: "3" },
    { label: "📱 checked trade-in value", text: "checked trade-in value for current phone", source: "device", age: "0" },
  ];

  let liveN = 0;
  const liveForm = $("live-form");
  const liveNote = $("live-note");
  const liveDefaultNote = liveNote.textContent;

  const chips = $("preset-chips");
  for (const p of PRESETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = p.label;
    chip.title = `"${p.text}" · ${p.source} · ${p.age === "0" ? "fresh" : p.age + " days old"}`;
    chip.addEventListener("click", () => {
      $("live-text").value = p.text;
      $("live-source").value = p.source;
      $("live-age").value = p.age;
      liveForm.requestSubmit();
    });
    chips.appendChild(chip);
  }
  liveForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("live-text").value.trim();
    if (!text) return;
    const source = $("live-source").value;
    const btn = $("live-submit");
    btn.disabled = true;
    btn.textContent = "Scoring…";
    chips.querySelectorAll(".chip").forEach((c) => (c.disabled = true));
    try {
      const r = await fetch(API_URL + "/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(r.status === 429 ? "rate limit — try again in a minute" : `scoring service ${r.status}`);
      const s = await r.json();
      const ev = {
        id: `live-${++liveN}`,
        t_offset_ms: 0,
        source,
        source_label: source === "device" ? "live_edge_input" : "live_webhook_input",
        event_type: "custom_signal",
        age_days: Number($("live-age").value),
        payload: { text },
        serialized: s.serialized,
        sims: s.sims,
        affinities: s.affinities,
        dominant: s.dominant,
        strength: s.strength,
        xy: s.xy,
        top_fields: [],
      };
      addEventGeometry(ev);
      liveGeoms.push(dotById[ev.id], hitById[ev.id]);
      emit(ev);
      $("live-text").value = "";
      liveNote.textContent = liveDefaultNote;
      liveNote.classList.remove("err");
    } catch (err) {
      liveNote.textContent = `⚠ ${err.message}${err.message.includes("rate") ? "" : " — the service may be cold-starting; retry in ~10s"}`;
      liveNote.classList.add("err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Score it";
      chips.querySelectorAll(".chip").forEach((c) => (c.disabled = false));
    }
  });

  const overlay = $("overlay");
  const deepLink = new URLSearchParams(location.search).get("play");
  const autoplayId = model.scenarios.some((s) => s.id === deepLink) ? deepLink : null;
  const seen = localStorage.getItem("contextlens_seen") || autoplayId;
  if (!seen) overlay.hidden = false;
  $("overlay-start").addEventListener("click", () => {
    overlay.hidden = true;
    localStorage.setItem("contextlens_seen", "1");
    play("baseline");
  });
  helpBtn.addEventListener("click", () => (overlay.hidden = false));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  reset();
  renderEcon();
  if (seen) setTimeout(() => play(autoplayId || "baseline"), 400);
})();
