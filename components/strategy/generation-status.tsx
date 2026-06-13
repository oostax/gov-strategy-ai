"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileCheck2, Loader2, Search, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const steps = [
  { id: "storage", label: "Открываю сессию", phase: "context" },
  { id: "playbooks", label: "Поднимаю правила", phase: "context" },
  { id: "region_context", label: "Читаю регион и портфель Сбера", phase: "context" },
  { id: "memory_search", label: "Проверяю память", phase: "context" },
  { id: "web_research", label: "Ищу факты", phase: "evidence" },
  { id: "llm_summary", label: "Формулирую решение", phase: "strategy" },
  { id: "llm_directions", label: "Сравниваю ставки", phase: "strategy" },
  { id: "llm_mvp", label: "Собираю пилот", phase: "strategy" },
  { id: "llm_metrics", label: "Считаю метрики", phase: "strategy" },
  { id: "llm_risks", label: "Проверяю риски", phase: "strategy" },
  { id: "assemble", label: "Упаковываю brief", phase: "document" },
  { id: "save_output", label: "Сохраняю версию", phase: "document" },
  { id: "memory_write", label: "Запоминаю вывод", phase: "document" },
];

const phases = [
  { id: "context", label: "Контекст", icon: CheckCircle2 },
  { id: "evidence", label: "Источники", icon: Search },
  { id: "strategy", label: "Стратегия", icon: Sparkles },
  { id: "document", label: "Brief", icon: FileCheck2 },
];

function executiveMessage(step?: string, message?: string) {
  if (step === "region_context")
    return "Беру стратегию региона и портфель Сбера — чтобы материал был релевантным";
  if (step === "web_research") return "Ищу открытые источники, чтобы не подменять факты гипотезами";
  if (step?.startsWith("llm_")) return "Собираю управленческую позицию: решение, доказательства, роль Сбера";
  if (step === "assemble") return "Упаковываю материал в управленческую записку";
  if (step === "memory_write") return "Сохраняю выводы в память агента";
  return message || "Готовлю стратегический материал";
}

export function GenerationStatus({ active, currentStep, message }: { active: boolean; currentStep?: string; message?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  const progress = useMemo(() => Math.round(((currentIndex + 1) / steps.length) * 100), [currentIndex]);
  const current = steps[currentIndex] ?? steps[0];
  const currentPhaseIndex = Math.max(0, phases.findIndex((phase) => phase.id === current.phase));

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/15 bg-background shadow-sm">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              <span>{current.label}</span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-4 text-muted-foreground md:text-sm">
              {executiveMessage(currentStep, message)}
            </p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-muted-foreground">{elapsed} сек</span>
        </div>
        <Progress value={progress} className="mt-3 h-1" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {phases.map((phase, index) => {
            const Icon = phase.icon;
            const isDone = index < currentPhaseIndex;
            const isActive = index === currentPhaseIndex;
            return (
              <div
                key={phase.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  isActive ? "border-primary/30 bg-primary/5 font-medium text-primary" : isDone ? "bg-muted/50 text-foreground/70" : "text-muted-foreground/50"
                }`}
              >
                {isDone
                  ? <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                  : isActive
                    ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                    : <Icon className="size-3.5 shrink-0" />}
                {phase.label}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
