import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Aggregate, Model, Params } from "@/lib/model";

function Lamp({
  kind,
  icon,
  rule,
  detail,
}: {
  kind: "good" | "warning" | "critical" | "idle";
  icon: string;
  rule: string;
  detail: string;
}) {
  const color =
    kind === "good"
      ? "text-status-good"
      : kind === "warning"
        ? "text-status-warn"
        : kind === "critical"
          ? "text-status-crit"
          : "text-muted-foreground";
  return (
    <li className="flex items-baseline gap-2.5 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span className={`font-bold ${color}`}>{icon}</span>
      <span>
        <span className="font-semibold">{rule}</span>
        <br />
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

function Econ({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{note}</div>
    </div>
  );
}

export function HealthStrip({
  model,
  agg,
  latencyMs,
  signalsSeen,
  inferences,
  P,
}: {
  model: Model;
  agg: Aggregate | null;
  latencyMs: number;
  signalsSeen: number;
  inferences: number;
  P: Params;
}) {
  const perSignalUsd = (model.meta.avg_signal_chars * model.pricing.embed_usd_per_1k_chars) / 1000;
  const okLat = latencyMs < P.latency_budget_ms;

  return (
    <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.15fr_1fr]">
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Guardrails</CardTitle>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
              title="Analogue of Intent HQ's IntentOne layer: governance over data, audiences, agents and activation"
            >
              ≈ IntentOne governance
            </span>
          </div>
          <CardDescription>
            know when <em>not</em> to infer
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {agg ? (
              <>
                <Lamp
                  kind={okLat ? "good" : "critical"}
                  icon={okLat ? "✓" : "⛔"}
                  rule={`Latency ${latencyMs < 0.1 ? "<0.1" : latencyMs.toFixed(1)}ms / ${P.latency_budget_ms}ms budget`}
                  detail={
                    okLat
                      ? "semantic layer served in time (client-side compute)"
                      : "over budget → served cloud heuristic cache"
                  }
                />
                <Lamp
                  kind={agg.suppressed ? "critical" : "good"}
                  icon={agg.suppressed ? "⛔" : "✓"}
                  rule={`Confidence ${agg.confidence.toFixed(1)}% vs ${P.confidence_floor_pct}% floor`}
                  detail={
                    agg.suppressed
                      ? "below floor → routed to general baseline, no segment emitted"
                      : "above floor — segment may be emitted"
                  }
                />
                <Lamp
                  kind={agg.drifting ? "warning" : "good"}
                  icon={agg.drifting ? "⚠" : "✓"}
                  rule={`Drift index ${agg.drift.toFixed(2)} vs ${P.drift_limit} limit`}
                  detail={
                    agg.drifting
                      ? "sources disagree → downstream bidding triggers muted"
                      : "sources consistent — activation allowed"
                  }
                />
              </>
            ) : (
              <>
                <Lamp kind="idle" icon="·" rule={`Latency budget ${P.latency_budget_ms}ms`} detail="over budget → fall back to cloud heuristic cache" />
                <Lamp kind="idle" icon="·" rule={`Confidence floor ${P.confidence_floor_pct}%`} detail="below floor → route to general baseline, no segment emitted" />
                <Lamp kind="idle" icon="·" rule={`Drift limit ${P.drift_limit}`} detail="sources disagree → mute downstream bidding triggers" />
              </>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider">
            Model health ledger
          </CardTitle>
          <CardDescription>illustrative offline eval</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="text-sm tabular-nums">
              <TableHeader>
                <TableRow>
                  <TableHead>Segment</TableHead>
                  <TableHead className="text-right">Precision</TableHead>
                  <TableHead className="text-right">Recall</TableHead>
                  <TableHead className="text-right">n</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.eval.rows.map((r) => (
                  <TableRow key={r.segment}>
                    <TableCell>{r.segment}</TableCell>
                    <TableCell className="text-right">{r.precision.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.recall.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.n}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>Suppressed (routed to baseline)</TableCell>
                  <TableCell colSpan={3} className="text-right">
                    {model.eval.suppression_rate_pct}% of sessions
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{model.eval.methodology}</p>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider">
            Unit economics
          </CardTitle>
          <CardDescription>embed once at ingest, infer from cache</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5">
            <Econ
              label="Embedding cost / 1k signals"
              value={`$${(perSignalUsd * 1000).toFixed(4)}`}
              note={`once, at ingest (${model.meta.avg_signal_chars} chars avg)`}
            />
            <Econ label="Marginal inference cost" value="≈ $0" note="arithmetic on cached vectors" />
            <Econ label="Signals processed" value={String(signalsSeen)} note="this session" />
            <Econ label="Inferences run" value={String(inferences)} note="re-scored on every signal" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
