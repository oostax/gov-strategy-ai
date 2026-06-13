"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Risk } from "@/lib/schemas/structured-output";
import { cn } from "@/lib/utils";

const impactColors: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
  low: "bg-muted text-muted-foreground border-border",
};

const impactLabels: Record<string, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const impactWeight: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function RisksPanel({ risks }: { risks: Risk[] }) {
  if (!risks.length) return null;
  const sorted = [...risks].sort(
    (a, b) => (impactWeight[a.impact] ?? 3) - (impactWeight[b.impact] ?? 3),
  );
  const counts = {
    high: risks.filter((r) => r.impact === "high").length,
    medium: risks.filter((r) => r.impact === "medium").length,
    low: risks.filter((r) => r.impact === "low").length,
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ShieldAlert className="size-4" /> Риски и стоп-факторы
        </h3>
        <div className="flex items-center gap-1.5">
          {counts.high > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              <span className="size-1.5 rounded-full bg-destructive" /> {counts.high} высоких
            </span>
          )}
          {counts.medium > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-500" /> {counts.medium} средних
            </span>
          )}
          {counts.low > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" /> {counts.low} низких
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sorted.map((risk, idx) => (
          <Card key={`${risk.id ?? "risk"}-${idx}`} className="rounded-xl">
            <CardContent className="p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-semibold leading-tight">{risk.title}</p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 text-[10px]", impactColors[risk.impact])}
                >
                  {impactLabels[risk.impact] ?? risk.impact}
                </Badge>
              </div>
              <div className="space-y-1.5 pl-5">
                <div>
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">
                    Как снять
                  </p>
                  <p className="text-xs leading-snug">{risk.mitigation}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">
                    Владелец
                  </p>
                  <p className="text-xs font-medium">{risk.owner}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
