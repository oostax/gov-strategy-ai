"use client";

import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { Verdict } from "@/lib/schemas/structured-output";

const config: Record<
  Verdict["recommendation"],
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string; dot: string }
> = {
  go: {
    label: "Рекомендуем",
    icon: CheckCircle2,
    cls: "border-emerald-300/60 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
  "conditional-go": {
    label: "Рекомендуем условно",
    icon: HelpCircle,
    cls: "border-amber-300/60 bg-amber-50/60 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  "no-go": {
    label: "Не рекомендуем",
    icon: XCircle,
    cls: "border-destructive/40 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
  },
};

const confidenceLabel: Record<string, string> = {
  high: "высокая уверенность",
  medium: "средняя уверенность",
  low: "низкая уверенность",
};

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const c = config[verdict.recommendation] ?? config["conditional-go"];
  const Icon = c.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${c.cls}`}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold uppercase tracking-wide">{c.label}</p>
          <span className="inline-flex items-center gap-1 text-[11px] opacity-80">
            <span className={`size-1.5 rounded-full ${c.dot}`} />
            {confidenceLabel[verdict.confidence] ?? verdict.confidence}
          </span>
        </div>
        <p className="mt-1 text-sm leading-snug">{verdict.oneLineWhy}</p>
        {verdict.topCondition && (
          <p className="mt-1 text-xs leading-snug opacity-90">
            <span className="font-semibold">Условие:</span> {verdict.topCondition}
          </p>
        )}
      </div>
    </div>
  );
}
