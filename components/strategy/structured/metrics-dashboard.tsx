"use client";

import { ArrowRight, BarChart3, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Metric } from "@/lib/schemas/structured-output";

export function MetricsDashboard({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <BarChart3 className="size-4" /> Метрики
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric, idx) => (
          <Card key={`${metric.id ?? "m"}-${idx}`} className="rounded-2xl">
            <CardContent className="p-4">
              <div className="mb-3 flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Target className="size-3.5 text-muted-foreground" />
                </span>
                <p className="text-sm font-semibold leading-tight">{metric.name}</p>
              </div>

              <div className="space-y-2">
                <Row label="Формула" value={metric.formula} />
                <Row label="Источник" value={metric.source} />
                <MetricDelta metric={metric} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const UNCERTAIN = /нужно снять|не снят|определ|после пилота|к\s*\d{4}|n\/?a/i;

// Доверяем числу ТОЛЬКО из явного поля или из строки, которая целиком —
// число с опциональной единицей («30 %», «1 200 ₽», «40 мин»). Иначе null:
// свободный текст вроде «снизить к 2026 году» не должен давать ложную дельту.
function trustedNum(explicit: number | undefined, text: string | undefined): number | null {
  if (Number.isFinite(explicit)) return explicit as number;
  if (!text || UNCERTAIN.test(text)) return null;
  const cleaned = text.replace(/ /g, " ").trim();
  if (!/^[−+-]?\d[\d\s]*(?:[.,]\d+)?\s*(?:%|₽|руб\.?|млн|млрд|тыс\.?|мин|час|ч|дн\w*|сут\w*|шт\.?|чел\.?|раз)?$/i.test(cleaned)) {
    return null;
  }
  const v = Number(cleaned.replace(/[^\d.,−+-]/g, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function MetricDelta({ metric }: { metric: Metric }) {
  const baselineNum = trustedNum(metric.baselineValue, metric.baseline);
  const targetNum = trustedNum(metric.targetValue, metric.target);

  // Оба числа надёжны — показываем дельту и бар.
  if (baselineNum !== null && targetNum !== null) {
    const max = Math.max(Math.abs(baselineNum), Math.abs(targetNum), 1);
    const basePct = Math.min(100, (Math.abs(baselineNum) / max) * 100);
    const targetPct = Math.min(100, (Math.abs(targetNum) / max) * 100);
    const delta = targetNum - baselineNum;
    const deltaPct = baselineNum !== 0 ? Math.round((delta / Math.abs(baselineNum)) * 100) : null;
    const up = delta >= 0;
    return (
      <div className="rounded-lg border bg-muted/30 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
          <span className="text-muted-foreground">{fmt(baselineNum, metric.unit)}</span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="text-primary">{fmt(targetNum, metric.unit)}</span>
        </div>
        <div className="space-y-1">
          <Bar pct={basePct} className="bg-muted-foreground/40" />
          <Bar pct={targetPct} className="bg-primary" />
        </div>
        {deltaPct !== null && (
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
            {up ? "▲" : "▼"} {Math.abs(deltaPct)}% к baseline
          </p>
        )}
      </div>
    );
  }

  // Baseline не снят / не число — честно подсвечиваем пробел.
  const baselineMissing =
    !Number.isFinite(metric.baselineValue) && (!metric.baseline || UNCERTAIN.test(metric.baseline));
  return (
    <div className="grid grid-cols-2 gap-2">
      {baselineMissing ? (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50/40 px-2.5 py-2 dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Baseline
          </p>
          <p className="mt-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">не снят</p>
        </div>
      ) : (
        <ValueBox label="Baseline" value={metric.baseline} muted />
      )}
      <ValueBox label="Цель" value={metric.target} />
    </div>
  );
}

function Bar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function fmt(n: number, unit?: string): string {
  const s = Math.abs(n) >= 1000 ? n.toLocaleString("ru-RU") : String(n);
  return unit ? `${s} ${unit}` : s;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xs leading-snug">{value}</p>
    </div>
  );
}

function ValueBox({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-semibold ${muted ? "text-muted-foreground" : ""}`}>
        {value}
      </p>
    </div>
  );
}
