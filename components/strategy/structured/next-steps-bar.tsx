"use client";

import { ArrowRight, CalendarDays, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { NextStep } from "@/lib/schemas/structured-output";

function isUrgent(deadline: string): boolean {
  if (/час|сегодня|завтра|48|немедленн|сроч/i.test(deadline)) return true;
  const iso = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const days = (Date.parse(iso[0]) - Date.now()) / 86_400_000;
    return days <= 7;
  }
  return false;
}

export function NextStepsBar({ steps }: { steps: NextStep[] }) {
  if (!steps.length) return null;
  return (
    <Card className="rounded-2xl border-primary/10 bg-gradient-to-r from-primary/[0.02] to-transparent">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ArrowRight className="size-4 text-primary" /> Следующие шаги
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {steps.map((step, idx) => {
            const urgent = isUrgent(step.deadline);
            return (
              <div
                key={`${step.id ?? "step"}-${idx}`}
                className={`flex flex-col gap-2 rounded-xl border bg-background p-3 ${
                  urgent ? "border-destructive/40 ring-1 ring-destructive/10" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {idx + 1}
                  </span>
                  <p className="text-sm font-medium leading-tight">{step.action}</p>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3" /> {step.owner}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      urgent ? "font-semibold text-destructive" : ""
                    }`}
                  >
                    <CalendarDays className="size-3" /> {step.deadline}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
