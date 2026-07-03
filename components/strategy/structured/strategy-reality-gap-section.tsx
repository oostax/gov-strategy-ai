"use client";

import { GitCompareArrows, Target, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { RegionStrategyRealityGap } from "@/lib/schemas/structured-output";

export function StrategyRealityGapSection({ gaps }: { gaps?: RegionStrategyRealityGap[] }) {
  if (!gaps?.length) return null;

  return (
    <Card className="rounded-2xl border-primary/10">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <GitCompareArrows className="size-4 text-primary" />
          Разрыв между замыслом стратегии и фактом
        </h3>
        <div className="grid gap-3">
          {gaps.map((gap, idx) => (
            <div key={`${gap.id ?? "gap"}-${idx}`} className="rounded-xl border bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold leading-tight">{gap.dimension}</p>
                {gap.gapMagnitude && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                    {gap.gapMagnitude}
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <GapCell
                  icon={<Target className="size-3.5" />}
                  label="Замысел стратегии"
                  value={gap.strategyIntent}
                />
                <GapCell
                  icon={<TriangleAlert className="size-3.5" />}
                  label="Факт"
                  value={gap.actualFact}
                  tone="warning"
                />
              </div>
              {gap.source && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {gap.sourceUrl ? (
                    <a
                      href={gap.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {gap.source}
                    </a>
                  ) : (
                    gap.source
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GapCell({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-lg bg-background px-2.5 py-2">
      <p
        className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
          tone === "warning" ? "text-amber-600" : "text-muted-foreground"
        }`}
      >
        {icon} {label}
      </p>
      <p className="text-xs leading-snug">{value}</p>
    </div>
  );
}
