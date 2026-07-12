import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agentDecision, segmentOf, statusOf, type Aggregate, type Epsilon, type Params } from "@/lib/model";

const badgeClass: Record<string, string> = {
  good: "border-status-good text-status-good",
  warning: "border-status-warn text-status-warn",
  critical: "border-status-crit text-status-crit",
};

const agentClass: Record<string, string> = {
  good: "border-l-status-good",
  warning: "border-l-status-warn",
  critical: "border-l-status-crit",
  idle: "border-l-border",
};

export function AttrPanel({
  agg,
  decayOn,
  setDecayOn,
  P,
  epsilon,
  privacyCost,
}: {
  agg: Aggregate | null;
  decayOn: boolean;
  setDecayOn: (v: boolean) => void;
  P: Params;
  epsilon: Epsilon;
  privacyCost: number;
}) {
  const rows = agg ? [...agg.rows].sort((a, b) => b.share - a.share) : [];
  const maxShare = rows[0]?.share || 1;
  const st = agg ? statusOf(agg, P) : null;
  const agent = agg ? agentDecision(agg, P) : null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider">
            C · Attribution &amp; explainability
          </CardTitle>
          <label
            className="flex cursor-pointer items-center gap-2 text-xs"
            title="Counterfactual: re-score with exponential time decay disabled (λ=0) — stale signals weigh the same as fresh ones"
          >
            <span className={decayOn ? "text-muted-foreground" : "font-semibold text-status-warn"}>
              time decay {decayOn ? "on" : "off — counterfactual"}
            </span>
            <Switch checked={decayOn} onCheckedChange={setDecayOn} />
          </label>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0 rounded-lg border bg-muted/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Predicted segment
            </div>
            <div className="mt-1 text-base font-semibold leading-snug">
              {agg ? segmentOf(agg) : "—"}
            </div>
            {st ? (
              <Badge
                variant="outline"
                className={`mt-2 h-auto whitespace-normal text-left leading-snug ${badgeClass[st.kind]}`}
              >
                {st.icon} {st.text}
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-2 text-muted-foreground">
                · awaiting signals
              </Badge>
            )}
          </div>
          <div className="min-w-0 rounded-lg border bg-muted/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Confidence
            </div>
            <div className="mt-0.5 text-5xl font-semibold leading-tight">
              {agg ? `${agg.confidence.toFixed(1)}%` : "—"}
            </div>
            {agg && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                net evidence {agg.net >= 0 ? "+" : ""}
                {agg.net.toFixed(3)} · drift {agg.drift.toFixed(2)}
                {!decayOn && " · ⚠ counterfactual"}
                {epsilon !== null && (
                  <span className="text-status-warn">
                    {" "}· privacy cost −{Math.abs(privacyCost).toFixed(1)} pts (ε={epsilon})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {agent && (
          <div
            className={`rounded-lg border border-l-3 bg-muted/40 px-3 py-2 text-sm ${agentClass[agent.kind]}`}
            title="Analogue of Intent HQ's Marketing Agents layer: detected intent becomes timely action — but only when the guardrails clear it"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Agent decision <span className="normal-case">(≈ Marketing Agents)</span>
            </span>
            <div className="mt-0.5">{agent.text}</div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Attribution breakdown</span>
            <span className="normal-case tracking-normal">
              <span className="text-viz-neg">← churn evidence</span> ·{" "}
              <span className="text-viz-device">upgrade evidence →</span>
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">no signals yet</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {rows.map((r) => (
                <div key={r.ev.id} className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex justify-between gap-3 text-xs">
                    <span className="truncate text-foreground/85">
                      {r.ev.event_type.replace(/_/g, " ")} · {r.ev.source} · {r.ev.age_days}d
                    </span>
                    <span className="font-semibold">
                      {r.v >= 0 ? "+" : "−"}
                      {(r.share * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="relative h-3.5 rounded bg-muted">
                    <div className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
                    <div
                      className={
                        r.v >= 0
                          ? "absolute inset-y-0 left-1/2 rounded-r bg-viz-pos transition-all duration-400"
                          : "absolute inset-y-0 right-1/2 rounded-l bg-viz-neg transition-all duration-400"
                      }
                      style={{ width: `${(r.share / maxShare) * 48}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {agg && (
          <Collapsible>
            <CollapsibleTrigger className="text-sm text-viz-device hover:underline">
              ▸ How is this computed?
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 overflow-x-auto font-mono text-[11px]">
                <pre className="mb-2 whitespace-pre-wrap text-foreground/90">
                  {decayOn
                    ? `wᵢ = trust(src)·e^(−λ·ageᵢ)      λ=${P.lambda_decay_per_day}/day · trust device=${P.source_trust.device.toFixed(2)}, cloud=${P.source_trust.cloud.toFixed(2)}`
                    : `wᵢ = trust(src)      ⚠ COUNTERFACTUAL: λ forced to 0, stale signals at full weight`}
                  {`\nvᵢ = affinity(upgrade) − affinity(churn)`}
                  {`\nnet = Σwᵢvᵢ / Σwᵢ = ${agg.net >= 0 ? "+" : ""}${agg.net.toFixed(3)}`}
                  {`\nconfidence = σ(k·|net|) = ${agg.confidence.toFixed(1)}%      k=${Number(P.sigmoid_k.toFixed(2))}${epsilon !== null ? " (discounted for ε noise variance)" : ""}`}
                  {`\ndrift = weightedStd(vᵢ)/${P.drift_scale} = ${agg.drift.toFixed(2)}      mute > ${P.drift_limit} · suppress < ${P.confidence_floor_pct}% conf`}
                </pre>
                <Table className="text-[11px] tabular-nums">
                  <TableHeader>
                    <TableRow>
                      <TableHead>signal</TableHead>
                      <TableHead>src</TableHead>
                      <TableHead className="text-right">age</TableHead>
                      <TableHead className="text-right">wᵢ</TableHead>
                      <TableHead className="text-right">U</TableHead>
                      <TableHead className="text-right">E</TableHead>
                      <TableHead className="text-right">C</TableHead>
                      <TableHead className="text-right">vᵢ</TableHead>
                      <TableHead className="text-right">wᵢvᵢ</TableHead>
                      <TableHead className="text-right">share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.rows.map((r) => (
                      <TableRow key={r.ev.id}>
                        <TableCell>{r.ev.event_type}</TableCell>
                        <TableCell>{r.ev.source}</TableCell>
                        <TableCell className="text-right">{r.ev.age_days}d</TableCell>
                        <TableCell className="text-right">{r.w.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.ev.affinities.upgrade_intent.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.ev.affinities.engagement_depth.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.ev.affinities.churn_risk.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.v >= 0 ? "+" : ""}{r.v.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.wv >= 0 ? "+" : ""}{r.wv.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{(r.share * 100).toFixed(0)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
