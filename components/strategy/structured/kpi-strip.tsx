"use client";

import { CalendarClock, Layers, ShieldAlert, Target, TrendingUp } from "lucide-react";
import type { Metric, NextStep, Risk, StrategyBet } from "@/lib/schemas/structured-output";

/**
 * Сводный KPI-ряд — всегда строится из уже присутствующих полей.
 * Даёт руководителю масштаб решения за первые секунды.
 */
export function KpiStrip({
  bets,
  risks,
  metrics,
  nextSteps,
  planStages,
}: {
  bets: StrategyBet[];
  risks: Risk[];
  metrics: Metric[];
  nextSteps: NextStep[];
  planStages: number;
}) {
  const recommended = bets.filter((b) => b.recommended).length;
  const highRisks = risks.filter((r) => r.impact === "high").length;
  const nearest = nearestDeadline(nextSteps);

  const tiles: KpiTile[] = [];
  if (bets.length) {
    tiles.push({
      icon: <Layers className="size-4" />,
      value: String(bets.length),
      label: "Стратегических ставок",
      hint: recommended ? `${recommended} рекомендуем` : undefined,
    });
  }
  if (risks.length) {
    tiles.push({
      icon: <ShieldAlert className="size-4" />,
      value: String(highRisks),
      label: "Высоких рисков",
      hint: `из ${risks.length} всего`,
      tone: highRisks > 0 ? "bad" : "good",
    });
  }
  if (metrics.length) {
    tiles.push({
      icon: <Target className="size-4" />,
      value: String(metrics.length),
      label: "Метрик успеха",
    });
  }
  if (planStages) {
    tiles.push({
      icon: <TrendingUp className="size-4" />,
      value: String(planStages),
      label: "Этапов плана",
    });
  }
  if (nearest) {
    tiles.push({
      icon: <CalendarClock className="size-4" />,
      value: nearest,
      label: "Ближайший шаг",
      tone: "warn",
    });
  }

  if (tiles.length < 2) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile, idx) => (
        <div
          key={idx}
          className="flex items-center gap-3 rounded-xl border bg-card p-3"
        >
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
              tile.tone === "bad"
                ? "bg-destructive/10 text-destructive"
                : tile.tone === "good"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : tile.tone === "warn"
                    ? "bg-amber-500/10 text-amber-600"
                    : "bg-primary/10 text-primary"
            }`}
          >
            {tile.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-none tabular-nums">{tile.value}</p>
            <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">{tile.label}</p>
            {tile.hint && <p className="truncate text-[10px] text-muted-foreground/80">{tile.hint}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface KpiTile {
  icon: React.ReactNode;
  value: string;
  label: string;
  hint?: string;
  tone?: "bad" | "good" | "warn" | "neutral";
}

function nearestDeadline(steps: NextStep[]): string | null {
  // Срочные текстовые сроки приоритетнее далёких ISO-дат.
  const urgent = steps.find((s) => /час|сегодня|завтра|48|срочно|немедленн/i.test(s.deadline));
  if (urgent) return formatShort(urgent.deadline);

  const now = Date.now();
  const dated = steps
    .map((s) => ({ raw: s.deadline, parsed: parseDate(s.deadline) }))
    .filter((s) => s.parsed !== null)
    .sort((a, b) => (a.parsed as number) - (b.parsed as number));
  const future = dated.filter((s) => (s.parsed as number) >= now);
  if (future.length) return formatShort(future[0].raw);
  if (dated.length) return formatShort(dated[0].raw);
  return steps[0]?.deadline ?? null;
}

function parseDate(s: string): number | null {
  const iso = s.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const t = Date.parse(iso[0]);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function formatShort(s: string): string {
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const m = months[Number(iso[2]) - 1] ?? iso[2];
    return `${Number(iso[3])} ${m}`;
  }
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}
