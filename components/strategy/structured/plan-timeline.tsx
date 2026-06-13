"use client";

import { CalendarCheck, Flag, GitCommitHorizontal, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanStage } from "@/lib/schemas/structured-output";

export function PlanTimeline({ stages }: { stages: PlanStage[] }) {
  if (!stages.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <CalendarCheck className="size-4" /> План
      </h3>
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-3 bottom-3 w-px bg-border" />

            <div className="space-y-0">
              {stages.map((stage, idx) => (
                <div key={`${stage.id ?? "stage"}-${idx}`} className="relative flex gap-4 pb-5 last:pb-0">
                  {/* Dot */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold ${
                        stage.isDecisionGate
                          ? "border-amber-500 text-amber-600"
                          : stage.isMilestone
                            ? "border-emerald-500 text-emerald-600"
                            : "border-primary text-primary"
                      }`}
                    >
                      {stage.isDecisionGate ? (
                        <GitCommitHorizontal className="size-4" />
                      ) : stage.isMilestone ? (
                        <Flag className="size-4" />
                      ) : (
                        stage.week.replace(/\s*нед\.?/i, "н")
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div
                    className={`min-w-0 flex-1 rounded-xl border bg-background p-3 ${
                      stage.isDecisionGate ? "border-amber-300/60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-tight">{stage.action}</p>
                      {stage.isDecisionGate && (
                        <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-600">
                          go / no-go
                        </Badge>
                      )}
                      {stage.isMilestone && !stage.isDecisionGate && (
                        <Badge variant="outline" className="border-emerald-400 text-[10px] text-emerald-600">
                          веха
                        </Badge>
                      )}
                      {stage.date && (
                        <span className="text-[11px] text-muted-foreground">{stage.date}</span>
                      )}
                    </div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                      <MiniField
                        icon={<User className="size-3" />}
                        label="Владелец"
                        value={stage.owner}
                      />
                      <MiniField label="Результат" value={stage.deliverable} />
                      <MiniField label="Готово когда" value={stage.doneWhen} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniField({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-0.5 text-xs leading-snug">{value}</p>
    </div>
  );
}
