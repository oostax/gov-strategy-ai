"use client";

import { useEffect, useState } from "react";
import { CircleDashed, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const steps = [
  { label: "Загрузка контекста", duration: 3 },
  { label: "Анализ стратегии региона", duration: 5 },
  { label: "Подбор правил", duration: 3 },
  { label: "Поиск источников", duration: 18 },
  { label: "Сбор доказательной базы", duration: 12 },
  { label: "Формирование материала", duration: 55 },
  { label: "Контрольная проверка", duration: 18 },
  { label: "Финальное форматирование", duration: 10 },
];

export function GenerationProgress({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!active) {
      const resetTimer = window.setTimeout(() => {
        setElapsed(0);
        setCurrentStep(0);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setElapsed(sec);

      // Advance step based on elapsed time
      let accumulated = 0;
      for (let i = 0; i < steps.length; i++) {
        accumulated += steps[i].duration;
        if (sec < accumulated) {
          setCurrentStep(i);
          break;
        }
        if (i === steps.length - 1) setCurrentStep(i);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
  const progress = Math.min(95, (elapsed / totalDuration) * 100);

  return (
    <Card className="animate-in fade-in slide-in-from-top-2 overflow-hidden rounded-2xl border-primary/10">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <span className="truncate text-sm font-semibold">
              {steps[currentStep]?.label ?? "Формирование материала"}
            </span>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {elapsed} сек
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step list */}
        <ul className="space-y-1.5">
          {steps.map((step, idx) => {
            const status = idx < currentStep ? "done" : idx === currentStep ? "active" : "queued";
            return (
              <li
                key={step.label}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1"
              >
                <span
                  className={cn(
                    "truncate text-xs",
                    status === "queued" ? "text-muted-foreground" : "text-foreground font-medium",
                  )}
                >
                  {step.label}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  {status === "done" && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> Готово
                    </span>
                  )}
                  {status === "active" && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Loader2 className="size-3 animate-spin" /> Идёт
                    </span>
                  )}
                  {status === "queued" && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CircleDashed className="size-3" /> В очереди
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
