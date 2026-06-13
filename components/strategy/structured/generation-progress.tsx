"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const steps = [
  { label: "Загружаю контекст", duration: 3 },
  { label: "Читаю стратегию региона", duration: 5 },
  { label: "Подбираю правила", duration: 3 },
  { label: "Ищу свежие источники", duration: 18 },
  { label: "Собираю доказательную базу", duration: 12 },
  { label: "Генерирую материал", duration: 55 },
  { label: "Проверяю как руководитель", duration: 18 },
  { label: "Убираю воду и гипотезы", duration: 10 },
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
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="text-sm font-semibold">
              {steps[currentStep]?.label ?? "Генерирую..."}
            </span>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs tabular-nums text-muted-foreground">
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

        {/* Step indicators */}
        <div className="flex gap-1">
          {steps.map((step, idx) => (
            <div
              key={step.label}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-500",
                idx < currentStep
                  ? "bg-primary"
                  : idx === currentStep
                    ? "bg-primary/50 animate-pulse"
                    : "bg-muted",
              )}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
