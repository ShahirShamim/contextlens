import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttrPanel } from "@/components/AttrPanel";
import { FeedPanel } from "@/components/FeedPanel";
import { HealthStrip } from "@/components/HealthStrip";
import { MapPanel } from "@/components/MapPanel";
import {
  aggregate,
  applyPrivacyNoise,
  CAPTIONS,
  dpPenalizedParams,
  EPSILONS,
  LAYER_MAP,
  polarityAxis,
  REPO_URL,
  type Epsilon,
  type Model,
  type SignalEvent,
  type Vertical,
} from "@/lib/model";

const params = new URLSearchParams(location.search);

export default function App() {
  const [model, setModel] = useState<Model | null>(null);
  const [verticalId, setVerticalId] = useState(params.get("vertical") || "telco");
  const [emitted, setEmitted] = useState<SignalEvent[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [decayOn, setDecayOn] = useState(params.get("decay") !== "0");
  const [tourOn, setTourOn] = useState(() => localStorage.getItem("contextlens_tour") !== "0");
  const [caption, setCaption] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [archOpen, setArchOpen] = useState(false);
  const [signalsSeen, setSignalsSeen] = useState(0);
  const [inferences, setInferences] = useState(0);
  const [epsilon, setEpsilon] = useState<Epsilon>(() => {
    const e = parseFloat(params.get("eps") || "");
    return EPSILONS.some((o) => o.value === e) ? e : null;
  });

  const timers = useRef<number[]>([]);
  const captionTimer = useRef<number>(0);

  useEffect(() => {
    fetch("data/model.json").then((r) => r.json()).then(setModel);
  }, []);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearTimeout(captionTimer.current);
    setCaption(null);
  };

  const emit = useCallback((ev: SignalEvent) => {
    setEmitted((prev) => [...prev, ev]);
    setSignalsSeen((n) => n + 1);
    setInferences((n) => n + 1);
  }, []);

  const play = useCallback(
    (scenarioId: string, v: Vertical, tour: boolean) => {
      clearTimers();
      setEmitted([]);
      setActiveScenario(scenarioId);
      const sc = v.scenarios.find((s) => s.id === scenarioId);
      if (!sc) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      sc.events.forEach((ev, i) => {
        timers.current.push(window.setTimeout(() => emit(ev), reduced ? i * 60 : ev.t_offset_ms));
      });
      if (tour && !reduced) {
        for (const [at, text] of CAPTIONS[v.id]?.[scenarioId] || []) {
          timers.current.push(
            window.setTimeout(() => {
              setCaption(text);
              clearTimeout(captionTimer.current);
              captionTimer.current = window.setTimeout(() => setCaption(null), 3600);
            }, at)
          );
        }
      }
    },
    [emit]
  );

  useEffect(() => {
    if (!model) return;
    const v = model.verticals.find((x) => x.id === verticalId) ?? model.verticals[0];
    const deepLink = params.get("play");
    const auto = v.scenarios.some((s) => s.id === deepLink) ? deepLink : null;
    if (!localStorage.getItem("contextlens_seen") && !auto) setIntroOpen(true);
    const t = window.setTimeout(() => play(auto || "baseline", v, tourOn), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const vertical = model
    ? (model.verticals.find((x) => x.id === verticalId) ?? model.verticals[0])
    : null;
  const posAxis = vertical ? polarityAxis(vertical, "positive") : "";
  const negAxis = vertical ? polarityAxis(vertical, "negative") : "";

  const noisedEmitted = useMemo(() => applyPrivacyNoise(emitted, epsilon), [emitted, epsilon]);

  const scored = useMemo(() => {
    if (!emitted.length || !vertical) return { agg: null, latencyMs: 0, privacyCost: 0, P: null };
    const P = dpPenalizedParams(vertical.params, epsilon);
    const t0 = performance.now();
    const agg = aggregate(noisedEmitted, P, decayOn, posAxis, negAxis);
    const latencyMs = performance.now() - t0;
    const privacyCost =
      epsilon === null
        ? 0
        : aggregate(emitted, vertical.params, decayOn, posAxis, negAxis).confidence - agg.confidence;
    return { agg, latencyMs, privacyCost, P };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitted, noisedEmitted, decayOn, vertical, epsilon]);

  if (!model || !vertical) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        loading model…
      </div>
    );
  }

  const switchVertical = (id: string) => {
    setVerticalId(id);
    const v = model.verticals.find((x) => x.id === id)!;
    play("baseline", v, tourOn);
  };

  const noisedById = new Map(noisedEmitted.map((e) => [e.id, e]));
  const allEvents = [
    ...vertical.scenarios.flatMap((s) => s.events).map((e) => noisedById.get(e.id) ?? e),
    ...noisedEmitted.filter((e) => e.id.startsWith("live-")),
  ];
  const visibleIds = new Set(emitted.map((e) => e.id));

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3.5 px-4 pb-6 pt-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
            ContextLens
          </h1>
          <p className="text-sm text-muted-foreground">
            Explainable intent resolution — one engine, three industries
          </p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 font-mono text-xs" title={vertical.description}>
          <b className="text-foreground">{vertical.entity.id}</b>
          <span className="text-muted-foreground"> · {vertical.entity.summary}</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={vertical.id} onValueChange={(v) => v && switchVertical(v)}>
          <TabsList>
            {model.verticals.map((v) => (
              <TabsTrigger key={v.id} value={v.id} title={v.description}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">{vertical.description}</span>
      </div>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Scenario controls">
        {vertical.scenarios.map((sc) => (
          <Button
            key={sc.id}
            variant={activeScenario === sc.id ? "default" : "outline"}
            size="sm"
            title={sc.description}
            onClick={() => play(sc.id, vertical, tourOn)}
          >
            {sc.button}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          title="Narrated captions during playback"
          onClick={() => {
            const next = !tourOn;
            setTourOn(next);
            localStorage.setItem("contextlens_tour", next ? "1" : "0");
            if (!next) setCaption(null);
          }}
        >
          💬 tour: {tourOn ? "on" : "off"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          title="How this maps to Intent HQ's published seven-layer architecture"
          onClick={() => setArchOpen(true)}
        >
          🗺 architecture
        </Button>
        <Button variant="outline" size="sm" title="What am I looking at?" onClick={() => setIntroOpen(true)}>
          ?
        </Button>
      </nav>

      <main className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-[1.05fr_1.2fr_1.1fr]">
        <FeedPanel
          emitted={noisedEmitted}
          hoverId={hoverId}
          setHoverId={setHoverId}
          onLiveEvent={emit}
          epsilon={epsilon}
          setEpsilon={setEpsilon}
          vertical={vertical}
        />
        <MapPanel
          model={model}
          vertical={vertical}
          events={allEvents}
          visibleIds={visibleIds}
          hoverId={hoverId}
          setHoverId={setHoverId}
        />
        <div className="min-w-0 md:col-span-2 xl:col-span-1">
          <AttrPanel
            agg={scored.agg}
            decayOn={decayOn}
            setDecayOn={setDecayOn}
            P={scored.P ?? vertical.params}
            epsilon={epsilon}
            privacyCost={scored.privacyCost}
            vertical={vertical}
            initialCallOpen={params.get("call") === "1"}
          />
        </div>
      </main>

      <HealthStrip
        model={model}
        vertical={vertical}
        agg={scored.agg}
        latencyMs={scored.latencyMs}
        signalsSeen={signalsSeen}
        inferences={inferences}
        P={scored.P ?? vertical.params}
      />

      <footer className="flex flex-wrap justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
        <span>
          embeddings: {model.meta.backend} ({model.meta.embed_dims}d) · 2D map: PCA,{" "}
          {((model.meta.pca_var_explained[vertical.id] ?? 0) * 100).toFixed(0)}% variance · built{" "}
          {model.meta.generated_at.slice(0, 10)}
        </span>
        <span>
          Scenario data is authored; embeddings, similarity and attribution math are real.{" "}
          <a href={REPO_URL} rel="noopener" className="text-viz-device hover:underline">
            Source &amp; case study →
          </a>
        </span>
      </footer>

      {caption && (
        <div className="fixed bottom-6 left-1/2 z-30 max-w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-primary/60 bg-popover px-4 py-2.5 text-sm shadow-2xl animate-in fade-in slide-in-from-bottom-2">
          {caption}
        </div>
      )}

      <Dialog open={archOpen} onOpenChange={setArchOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How this maps to a real intent platform</DialogTitle>
            <DialogDescription>
              Intent HQ publishes a seven-layer architecture (“Seven layers. One architecture.”) —
              each ContextLens element is a deliberately small analogue of one layer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {LAYER_MAP.map((row) => (
              <div key={row.layer} className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-primary">{row.layer}</span>
                </div>
                <p className="italic text-muted-foreground">{row.theirs}</p>
                <p className="mt-1.5">
                  <span className="text-muted-foreground">Here: </span>
                  {row.ours}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Simplified: {row.simplified}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Mapping based on Intent HQ's public{" "}
              <a href="https://intenthq.com/deeptech" rel="noopener" className="text-viz-device hover:underline">
                /deeptech
              </a>{" "}
              page (July 2026). ContextLens is an independent exploration and simplification — not
              affiliated with, endorsed by, or representative of Intent HQ's implementation.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={introOpen} onOpenChange={setIntroOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>What am I looking at?</DialogTitle>
            <DialogDescription>
              A working demo of explainable behavioral prediction — one engine, three industries.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">ContextLens</strong> streams raw telemetry from
              two fragmented sources — an on-device SDK and cloud webhooks — maps each signal into
              a shared semantic space (real embeddings, precomputed), and resolves them into a
              propensity score where{" "}
              <strong className="text-foreground">every percentage point is traceable to a signal</strong>.
              Switch tabs to see the same engine drive telco upgrades, marketplace WISMO
              deflection, and fintech escalation routing.
            </p>
            <p>
              Try the three scenarios per industry: a clean session, a{" "}
              <strong className="text-foreground">signal conflict</strong> resolved by time decay,
              and a sparse session where the system{" "}
              <strong className="text-foreground">refuses to predict</strong> rather than guess.
              Then type your own signal, take the ☎ inbound call, or flip the time-decay and ε
              privacy toggles.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setIntroOpen(false);
                localStorage.setItem("contextlens_seen", "1");
                if (!emitted.length) play("baseline", vertical, tourOn);
              }}
            >
              Got it — show me
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
