import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { API_URL, EPSILONS, PRESETS, type Epsilon, type SignalEvent } from "@/lib/model";

function FeedItem({
  ev,
  hovered,
  isNew,
  epsilon,
  setHoverId,
}: {
  ev: SignalEvent;
  hovered: boolean;
  isNew: boolean;
  epsilon: Epsilon;
  setHoverId: (id: string | null) => void;
}) {
  const ts = new Date(Date.now() - ev.age_days * 864e5).toISOString().slice(0, 19) + "Z";
  const a = ev.affinities;
  return (
    <div
      className={[
        "rounded-md border border-l-3 bg-muted/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed",
        ev.source === "device" ? "border-l-viz-device" : "border-l-viz-cloud",
        hovered ? "border-foreground/40" : "",
        isNew ? "animate-in fade-in slide-in-from-bottom-1 duration-300" : "",
      ].join(" ")}
      onMouseEnter={() => setHoverId(ev.id)}
      onMouseLeave={() => setHoverId(null)}
    >
      <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground">
        <span className="font-bold text-foreground/90">{ev.source_label}</span>
        <span>{ts}</span>
        {ev.age_days > 2 && <span className="text-status-warn">⏱ t−{ev.age_days}d (stale)</span>}
      </div>
      <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/90">
        {"{ "}
        <span className="text-muted-foreground">"event"</span>: "{ev.event_type}",
        {Object.entries(ev.payload).map(([k, v]) => (
          <span key={k}>
            {"\n  "}
            <span className="text-muted-foreground">"{k}"</span>: {JSON.stringify(v)},
          </span>
        ))}
        {" }"}
      </pre>
      <div className="mt-1.5 border-t border-border pt-1 text-[10px] text-muted-foreground">
        {ev.source === "device" ? (
          <span className="text-status-good/80">
            🔒 scored on-device — only the vector [{a.upgrade_intent.toFixed(2)},{" "}
            {a.engagement_depth.toFixed(2)}, {a.churn_risk.toFixed(2)}] crosses to the cloud
            {epsilon !== null && ` · DP noise ε=${epsilon}`}
          </span>
        ) : (
          <span>
            ☁ raw payload transmitted server-side (webhook)
            {epsilon !== null && ` · vector noised ε=${epsilon} before scoring`}
          </span>
        )}
      </div>
    </div>
  );
}

export function FeedPanel({
  emitted,
  hoverId,
  setHoverId,
  onLiveEvent,
  epsilon,
  setEpsilon,
}: {
  emitted: SignalEvent[];
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  onLiveEvent: (ev: SignalEvent) => void;
  epsilon: Epsilon;
  setEpsilon: (e: Epsilon) => void;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"device" | "cloud">("device");
  const [age, setAge] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveN = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(API_URL + "/status").catch(() => {}); // warm the scoring service early
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [emitted.length]);

  async function scoreSignal(t: string, src: "device" | "cloud", ageDays: number) {
    setPending(true);
    setError(null);
    try {
      const r = await fetch(API_URL + "/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, source: src }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok)
        throw new Error(
          r.status === 429 ? "rate limit — try again in a minute" : `scoring service ${r.status}`
        );
      const s = await r.json();
      onLiveEvent({
        id: `live-${++liveN.current}`,
        t_offset_ms: 0,
        source: src,
        source_label: src === "device" ? "live_edge_input" : "live_webhook_input",
        event_type: "custom_signal",
        age_days: ageDays,
        payload: { text: t },
        serialized: s.serialized,
        sims: s.sims,
        affinities: s.affinities,
        dominant: s.dominant,
        strength: s.strength,
        xy: s.xy,
        top_fields: [],
      });
      setText("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`⚠ ${msg}${msg.includes("rate") ? "" : " — the service may be cold-starting; retry in ~10s"}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider">
            A · Live telemetry feed
          </CardTitle>
          <Badge
            variant="outline"
            className="text-[10px] font-normal text-muted-foreground"
            title="Analogue of Intent HQ's Edge AI + Deep Signal layers: on-device context plus cloud behavioral events"
          >
            ≈ Edge AI + Deep Signal
          </Badge>
        </div>
        <CardDescription>raw events, two sources, asynchronous</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5">
          <span
            className="text-xs text-muted-foreground"
            title="Analogue of Intent HQ's Privacy Twins layer: differential-privacy noise on every signal vector before scoring — tighter budget, stronger privacy, less utility"
          >
            privacy budget <span className="font-semibold text-foreground">ε</span>{" "}
            <span className="text-[10px]">(≈ Privacy Twins)</span>
          </span>
          <ToggleGroup
            value={[String(epsilon)]}
            onValueChange={(v: string[]) => {
              const next = v[0];
              if (next) setEpsilon(next === "null" ? null : parseFloat(next));
            }}
            variant="outline"
            size="sm"
          >
            {EPSILONS.map((o) => (
              <ToggleGroupItem key={o.label} value={String(o.value)} className="px-2 text-xs">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {epsilon !== null && (
          <p className="text-[11px] text-muted-foreground">
            Laplace noise (sensitivity 0.12, ε={epsilon}) applied to every vector, seeded per
            signal — cohort: plan-upgrade intent ∩ urban-5g, k ≥ 50 ✓ (cohort figure illustrative)
          </p>
        )}
        <div ref={scrollRef} className="flex h-[380px] flex-col gap-2 overflow-y-auto pr-1">
          {emitted.length === 0 ? (
            <div className="py-4 font-mono text-xs text-muted-foreground">awaiting signals…</div>
          ) : (
            emitted.map((ev, i) => (
              <FeedItem
                key={ev.id}
                ev={ev}
                hovered={hoverId === ev.id}
                isNew={i === emitted.length - 1}
                epsilon={epsilon}
                setHoverId={setHoverId}
              />
            ))
          )}
        </div>

        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) scoreSignal(text.trim(), source, Number(age));
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                className="h-7 rounded-full text-xs font-normal"
                title={`"${p.text}" · ${p.source} · ${p.age === 0 ? "fresh" : p.age + " days old"}`}
                onClick={() => {
                  setText(p.text);
                  setSource(p.source);
                  setAge(String(p.age));
                  scoreSignal(p.text, p.source, p.age);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="…or type your own signal"
            required
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={source} onValueChange={(v) => v && setSource(v as "device" | "cloud")}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="device">device (edge)</SelectItem>
                  <SelectItem value="cloud">cloud (webhook)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={age} onValueChange={(v) => v && setAge(v)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="0">fresh</SelectItem>
                  <SelectItem value="3">3 days old</SelectItem>
                  <SelectItem value="9">9 days old</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Scoring…" : "Score it"}
            </Button>
          </div>
          <p className={`text-[11px] ${error ? "text-status-warn" : "text-muted-foreground"}`}>
            {error ?? "embedded live via Vertex AI, scored in your browser · text is not stored"}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
