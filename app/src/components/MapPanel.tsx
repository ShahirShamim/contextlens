import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Model, SignalEvent, Vertical } from "@/lib/model";

const W = 600;
const H = 460;
const px = (xy: [number, number]) => [xy[0] * W, xy[1] * H] as const;

interface Tip {
  ev: SignalEvent;
  x: number;
  y: number;
}

export function MapPanel({
  model,
  vertical,
  events,
  visibleIds,
  hoverId,
  setHoverId,
}: {
  model: Model;
  vertical: Vertical;
  events: SignalEvent[];
  visibleIds: Set<string>;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider">
          B · Intent semantic map
        </CardTitle>
        <CardDescription>
          PCA of {model.meta.embed_dims}-d embedding space (
          {((model.meta.pca_var_explained[vertical.id] ?? 0) * 100).toFixed(0)}% var)
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-viz-device" /> device signal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-viz-cloud" /> cloud signal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/50" /> anchor phrase
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rotate-45 border border-muted-foreground" /> axis centroid
          </span>
        </div>

        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full"
            role="img"
            aria-label="Scatter plot of signals and semantic axes in embedding space"
            onMouseLeave={() => {
              setTip(null);
              setHoverId(null);
            }}
          >
            {vertical.axes.map((axis) => {
              const [cx, cy] = px(axis.centroid_xy);
              return (
                <g key={axis.id}>
                  {axis.anchors.map((a, i) => {
                    const [x, y] = px(a.xy);
                    return (
                      <circle key={i} cx={x} cy={y} r={3} className="fill-muted-foreground/40">
                        <title>{`${axis.label} anchor: “${a.phrase}”`}</title>
                      </circle>
                    );
                  })}
                  <rect
                    x={cx - 5}
                    y={cy - 5}
                    width={10}
                    height={10}
                    transform={`rotate(45 ${cx} ${cy})`}
                    className="fill-none stroke-foreground/70"
                    strokeWidth={1.5}
                  />
                  <text
                    x={cx}
                    y={cy - 12}
                    textAnchor="middle"
                    className="fill-foreground/80 text-[11px] font-semibold"
                  >
                    {axis.label}
                  </text>
                </g>
              );
            })}

            {events.map((ev) => {
              const [x, y] = px(ev.xy);
              const on = visibleIds.has(ev.id);
              return (
                <g key={ev.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={4 + ev.strength * 5}
                    strokeWidth={2}
                    className={[
                      "stroke-card transition-opacity duration-300",
                      ev.source === "device" ? "fill-viz-device" : "fill-viz-cloud",
                      on ? "opacity-100" : "opacity-0",
                      hoverId === ev.id ? "stroke-foreground" : "",
                    ].join(" ")}
                  />
                  {on && (
                    <circle
                      cx={x}
                      cy={y}
                      r={16}
                      className="cursor-pointer fill-transparent"
                      onMouseMove={(e) => {
                        setTip({ ev, x: e.clientX, y: e.clientY });
                        setHoverId(ev.id);
                      }}
                      onMouseLeave={() => {
                        setTip(null);
                        setHoverId(null);
                      }}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {tip && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover p-3 text-xs shadow-xl"
              style={{
                left: Math.min(tip.x + 14, window.innerWidth - 330),
                top: Math.min(tip.y + 14, window.innerHeight - 180),
              }}
            >
              <div className="mb-1 font-semibold text-popover-foreground">
                {tip.ev.event_type} · {tip.ev.source} · {tip.ev.age_days}d old
              </div>
              <div className="text-muted-foreground">{tip.ev.serialized}</div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {vertical.axes.map((ax) => (
                  <div key={ax.id} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{ax.label}</span>
                    <span className="text-popover-foreground">
                      {(tip.ev.affinities[ax.id] * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 italic text-muted-foreground">
                {tip.ev.top_fields.length
                  ? `strongest fields: ${tip.ev.top_fields
                      .slice(0, 2)
                      .map((f) => `${f.field} (${f.delta >= 0 ? "+" : ""}${f.delta.toFixed(3)})`)
                      .join(", ")} — cosine delta when removed`
                  : "live signal — embedded via Vertex AI just now"}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
