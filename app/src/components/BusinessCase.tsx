import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Vertical } from "@/lib/model";

export function BusinessCase({ vertical }: { vertical: Vertical }) {
  const b = vertical.business;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider">
          Why this matters — {vertical.label.toLowerCase()}
        </CardTitle>
        <CardDescription>the business case vs traditional agent handling</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              The problem
            </div>
            {b.problem}
          </div>
          <div className="rounded-lg border border-l-3 border-l-primary bg-muted/40 p-3 text-sm">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              What changes here
            </div>
            {b.approach}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[18%]"></TableHead>
                <TableHead>Traditional agent handling</TableHead>
                <TableHead>Signal-time intent (this demo)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.rows.map((r) => (
                <TableRow key={r.metric}>
                  <TableCell className="font-semibold">{r.metric}</TableCell>
                  <TableCell className="text-muted-foreground">{r.traditional}</TableCell>
                  <TableCell>{r.contextlens}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          💡 {b.math_note}{" "}
          <span className="italic">
            Figures are illustrative, order-of-magnitude industry benchmarks — not measurements
            from this demo.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
