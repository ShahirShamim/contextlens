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
import { AttrPanel } from "@/components/AttrPanel";
import { FeedPanel } from "@/components/FeedPanel";
import { HealthStrip } from "@/components/HealthStrip";
import { MapPanel } from "@/components/MapPanel";
import { aggregate, CAPTIONS, REPO_URL, type Model, type SignalEvent } from "@/lib/model";

const params = new URLSearchParams(location.search);

export default function App() {
  const [model, setModel] = useState<Model | null>(null);
  const [emitted, setEmitted] = useState<SignalEvent[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [decayOn, setDecayOn] = useState(params.get("decay") !== "0");
  const [tourOn, setTourOn] = useState(() => localStorage.getItem("contextlens_tour") !== "0");
  const [caption, setCaption] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [signalsSeen, setSignalsSeen] = useState(0);
  const [inferences, setInferences] = useState(0);

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
    (scenarioId: string, m: Model, tour: boolean) => {
      clearTimers();
      setEmitted([]);
      setActiveScenario(scenarioId);
      const sc = m.scenarios.find((s) => s.id === scenarioId);
      if (!sc) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      sc.events.forEach((ev, i) => {
        timers.current.push(
          window.setTimeout(() => emit(ev), reduced ? i * 60 : ev.t_offset_ms)
        );
      });
      if (tour && !reduced) {
        for (const [at, text] of CAPTIONS[scenarioId] || []) {
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
    const deepLink = params.get("play");
    const auto = model.scenarios.some((s) => s.id === deepLink) ? deepLink : null;
    const seen = localStorage.getItem("contextlens_seen") || auto;
    if (!seen) {
      setIntroOpen(true);
    } else {
      const t = window.setTimeout(() => play(auto || "baseline", model, tourOn), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const scored = useMemo(() => {
    if (!emitted.length || !model) return { agg: null, latencyMs: 0 };
    const t0 = performance.now();
    const agg = aggregate(emitted, model.meta.params, decayOn);
    return { agg, latencyMs: performance.now() - t0 };
  }, [emitted, decayOn, model]);

  if (!model) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        loading model…
      </div>
    );
  }
  const P = model.meta.params;
  const allEvents = [
    ...model.scenarios.flatMap((s) => s.events),
    ...emitted.filter((e) => e.id.startsWith("live-")),
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
            Explainable intent resolution — from raw fragmented signals to an auditable score
          </p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 font-mono text-xs" title="Mock subscriber under observation">
          <b className="text-foreground">{model.subscriber.user_id}</b>
          <span className="text-muted-foreground">
            {" "}· {model.subscriber.plan} · tenure {model.subscriber.tenure_months}mo ·{" "}
            {model.subscriber.region}
          </span>
        </div>
      </header>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Scenario controls">
        {model.scenarios.map((sc) => (
          <Button
            key={sc.id}
            variant={activeScenario === sc.id ? "default" : "outline"}
            size="sm"
            title={sc.description}
            onClick={() => play(sc.id, model, tourOn)}
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
        <Button variant="outline" size="sm" className="ml-auto" title="What am I looking at?" onClick={() => setIntroOpen(true)}>
          ?
        </Button>
      </nav>

      <main className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-[1.05fr_1.2fr_1.1fr]">
        <FeedPanel emitted={emitted} hoverId={hoverId} setHoverId={setHoverId} onLiveEvent={emit} />
        <MapPanel model={model} events={allEvents} visibleIds={visibleIds} hoverId={hoverId} setHoverId={setHoverId} />
        <div className="min-w-0 md:col-span-2 xl:col-span-1">
          <AttrPanel agg={scored.agg} decayOn={decayOn} setDecayOn={setDecayOn} P={P} />
        </div>
      </main>

      <HealthStrip
        model={model}
        agg={scored.agg}
        latencyMs={scored.latencyMs}
        signalsSeen={signalsSeen}
        inferences={inferences}
        P={P}
      />

      <footer className="flex flex-wrap justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
        <span>
          embeddings: {model.meta.backend} ({model.meta.embed_dims}d) · 2D map: PCA,{" "}
          {(model.meta.pca_var_explained * 100).toFixed(0)}% variance · built{" "}
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

      <Dialog open={introOpen} onOpenChange={setIntroOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>What am I looking at?</DialogTitle>
            <DialogDescription>
              A working demo of explainable behavioral prediction.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            <p>
                  <strong className="text-foreground">ContextLens</strong> is a working demo of{" "}
                  <em>explainable</em> behavioral prediction. It streams raw telemetry for one mock
                  telco subscriber from two fragmented sources — an on-device SDK and cloud webhooks
                  — maps each signal into a shared semantic space (real embeddings, precomputed),
                  and resolves them into a propensity score where{" "}
                  <strong className="text-foreground">
                    every percentage point is traceable to a signal
                  </strong>
                  .
                </p>
                <p>
                  Try the three scenarios: a clean session, a{" "}
                  <strong className="text-foreground">signal conflict</strong> resolved by time
                  decay, and a sparse session where the system{" "}
                  <strong className="text-foreground">refuses to predict</strong> rather than guess.
                  Then type your own signal and watch it get scored live — or flip the time-decay
                  toggle to see the counterfactual.
                </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setIntroOpen(false);
                localStorage.setItem("contextlens_seen", "1");
                if (!emitted.length) play("baseline", model, tourOn);
              }}
            >
              ▶ Play the demo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
