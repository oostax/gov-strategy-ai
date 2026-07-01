"use client";

import { BarChart3, GitBranch, LayoutGrid, Rows3 } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type { OutputVisual, VisualItem } from "@/lib/schemas/structured-output";

const iconByType: Record<OutputVisual["type"], React.ComponentType<{ className?: string }>> = {
  bar: BarChart3,
  matrix: LayoutGrid,
  funnel: GitBranch,
  scorecard: Rows3,
};

// Литеральные цвета: токены темы заданы в oklch(), а recharts пишет fill/stroke
// как SVG-атрибуты, которые не понимают var()/oklch-обёртки. Литералы рендерятся всегда.
const COLOR = {
  good: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
  neutral: "#475569",
  grid: "#e2e8f0",
  quadrant: "#16a34a",
};

const toneFill: Record<string, string> = {
  good: COLOR.good,
  warn: COLOR.warn,
  bad: COLOR.bad,
  neutral: COLOR.neutral,
};

const clamp01 = (n: number) => Math.max(0, Math.min(100, n));
const hasLabel = (item: VisualItem) => Boolean(item.label?.trim());

// Фактическое число к показу: реальное значение приоритетнее нормализованного 0-100.
function displayNumber(item: VisualItem): number | null {
  if (Number.isFinite(item.valueRaw)) return item.valueRaw as number;
  if (Number.isFinite(item.value)) return item.value;
  return null;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString("ru-RU");
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatValue(item: VisualItem): string {
  const n = displayNumber(item);
  if (n === null) return "нужно снять";
  // Единицу показываем только у реального числа (valueRaw); у нормализованной доли — нет.
  const showUnit = Number.isFinite(item.valueRaw) && item.unit;
  return showUnit ? `${formatNumber(n)} ${item.unit}` : formatNumber(n);
}

export function VisualsSection({ visuals }: { visuals: OutputVisual[] }) {
  const useful = (visuals ?? []).filter(isUsefulVisual).slice(0, 4);
  if (!useful.length) return null;

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      {useful.map((visual, idx) => (
        <VisualCard key={`${visual.id ?? "v"}-${idx}`} visual={visual} />
      ))}
    </div>
  );
}

// Гард: пропускаем содержательные визуалы, режем пустые/декоративные/без подписей.
function isUsefulVisual(visual: OutputVisual) {
  const items = (visual.items ?? []).filter(hasLabel);
  if (items.length < 2) return false;
  const uniqueLabels = new Set(items.map((item) => item.label.trim().toLowerCase()));
  if (uniqueLabels.size < 2) return false;

  // Чисто служебные «мета»-графики о самом процессе поиска.
  if (/опора на источники|использованные домены|подтверждено фактами/i.test(visual.title)) {
    return false;
  }

  // Матрица требует ОБЕ координаты у 2+ точек — иначе это не 2D-поле.
  if (visual.type === "matrix") {
    return items.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y)).length >= 2;
  }

  // Остальные типы — минимум 2 числовых значения (real или нормализованных).
  return items.filter((item) => displayNumber(item) !== null).length >= 2;
}

function VisualCard({ visual }: { visual: OutputVisual }) {
  const Icon = iconByType[visual.type] ?? BarChart3;
  const items = (visual.items ?? []).filter(hasLabel);

  return (
    <Card className="min-w-0 rounded-2xl">
      <CardContent className="p-4">
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="size-4 text-muted-foreground" />
            {visual.title}
          </h3>
          {visual.note && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{visual.note}</p>
          )}
        </div>

        {visual.type === "matrix" ? (
          <MatrixChart visual={visual} items={items} />
        ) : visual.type === "funnel" ? (
          <FunnelChart items={items} />
        ) : visual.type === "scorecard" ? (
          <Scorecard items={items} />
        ) : (
          <BarVisual items={items} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Матрица эффект/реализуемость: настоящее 2D-поле с квадрантами ────────────
function MatrixChart({ visual, items }: { visual: OutputVisual; items: VisualItem[] }) {
  // Только точки с реальными координатами — без фабрикации центра.
  const points = items
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .map((item) => ({
      label: item.label,
      x: clamp01(item.x as number),
      y: clamp01(item.y as number),
      z: 100,
      fill: toneFill[item.tone ?? "neutral"] ?? toneFill.neutral,
      description: item.description,
    }));

  if (points.length < 2) return null;

  return (
    <div>
      <div className="h-64 min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR.grid} />
            <ReferenceArea x1={50} x2={100} y1={50} y2={100} fill={COLOR.quadrant} fillOpacity={0.07} />
            <ReferenceLine x={50} stroke={COLOR.grid} />
            <ReferenceLine y={50} stroke={COLOR.grid} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 100]}
              allowDataOverflow
              tick={{ fontSize: 10 }}
              label={{ value: visual.xLabel ?? "Реализуемость →", position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              allowDataOverflow
              tick={{ fontSize: 10 }}
              label={{ value: visual.yLabel ?? "Эффект →", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="z" range={[140, 340]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                if (!payload?.length) return null;
                const p = payload[0].payload as (typeof points)[number];
                return (
                  <div className="max-w-[220px] rounded-lg border bg-background p-2 text-xs shadow-md">
                    <p className="font-semibold">{p.label}</p>
                    <p className="text-muted-foreground">Реализуемость {p.x} · Эффект {p.y}</p>
                    {p.description && <p className="mt-1 text-muted-foreground">{p.description}</p>}
                  </div>
                );
              }}
            />
            <Scatter data={points}>
              {points.map((p, idx) => (
                <Cell key={idx} fill={p.fill} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {points.map((p, idx) => (
          <span key={idx} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: p.fill }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Воронка: ступени сужаются сверху вниз, показывая конверсию ────────────────
function FunnelChart({ items }: { items: VisualItem[] }) {
  const nums = items.map((i) => displayNumber(i) ?? 0);
  const max = Math.max(...nums, 1);

  return (
    <div className="space-y-1.5 py-1">
      {items.map((item, idx) => {
        const n = displayNumber(item) ?? 0;
        const widthPct = Math.max(12, Math.round((n / max) * 100));
        const prev = idx > 0 ? (displayNumber(items[idx - 1]) ?? 0) : null;
        const conv = prev && prev > 0 ? Math.round((n / prev) * 100) : null;
        return (
          <div key={idx} className="flex flex-col items-center">
            <div
              className="flex items-center justify-between gap-2 rounded-md bg-primary/85 px-3 py-2 text-primary-foreground transition-all"
              style={{ width: `${widthPct}%` }}
            >
              <span className="truncate text-xs font-medium">{item.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums">{formatValue(item)}</span>
            </div>
            {conv !== null && (
              <span className="py-0.5 text-[10px] text-muted-foreground">↓ {conv}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Scorecard: KPI-плитки с крупным числом ───────────────────────────────────
function Scorecard({ items }: { items: VisualItem[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item, idx) => {
        const hasDelta = Number.isFinite(item.baseline) && Number.isFinite(item.target);
        return (
          <div key={idx} className="rounded-xl border bg-muted/20 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums leading-none">{formatValue(item)}</p>
            {hasDelta && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatNumber(item.baseline as number)} → {formatNumber(item.target as number)}
                {item.unit ? ` ${item.unit}` : ""}
              </p>
            )}
            {item.description && (
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Бар: реальные числа, ось Y под данные (не прибита к 0-100) ────────────────
function BarVisual({ items }: { items: VisualItem[] }) {
  const data = items.map((item) => {
    const label = item.label ?? "";
    return {
      label,
      display: displayNumber(item) ?? 0,
      fill: toneFill[item.tone ?? "neutral"] ?? toneFill.neutral,
      unit: item.unit ?? "",
      description: item.description,
    };
  });
  const max = Math.max(...data.map((item) => item.display), 1);

  return (
    <div className="space-y-2">
      {data.map((item, idx) => {
        const width = Math.max(4, Math.round((item.display / max) * 100));
        return (
          <div key={idx} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-medium">{item.label}</p>
              <p className="shrink-0 text-xs font-semibold tabular-nums">
                {formatNumber(item.display)}{item.unit ? ` ${item.unit}` : ""}
              </p>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${width}%`, backgroundColor: item.fill }}
              />
            </div>
            {item.description && (
              <p className="line-clamp-1 text-[11px] text-muted-foreground">{item.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
