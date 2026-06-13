"use client";

import { Grid2x2 } from "lucide-react";
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
import type { StrategyBet } from "@/lib/schemas/structured-output";

const typeLabel: Record<string, string> = {
  process: "Процесс",
  financial: "Финансы",
  technology: "Технологии",
  partnership: "Партнёрство",
  regulatory: "Регулирование",
};

/** Рендерим матрицу только если у 2+ ставок есть обе числовые оценки. */
export function hasEffortImpact(bets: StrategyBet[]): boolean {
  return (
    bets.filter((b) => Number.isFinite(b.impactScore) && Number.isFinite(b.effortScore)).length >= 2
  );
}

export function BetsEffortImpact({ bets }: { bets: StrategyBet[] }) {
  const scored = bets.filter(
    (b) => Number.isFinite(b.impactScore) && Number.isFinite(b.effortScore),
  );
  if (scored.length < 2) return null;

  const clamp01 = (n: number) => Math.max(0, Math.min(100, n));
  const points = scored.map((b) => ({
    label: b.title,
    // ось X — реализуемость (чем меньше усилие, тем правее)
    x: clamp01(100 - (b.effortScore as number)),
    y: clamp01(b.impactScore as number),
    z: b.recommended ? 380 : 180,
    recommended: b.recommended,
    type: typeLabel[b.type] ?? b.type,
    product: b.sberProduct,
  }));

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Grid2x2 className="size-4 text-primary" /> Матрица выбора: эффект × реализуемость
        </h3>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Размер точки — приоритет. Рекомендуемая ставка выделена цветом.
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 20, bottom: 28, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              {/* Квадрант «Быстрые победы» — высокий эффект + высокая реализуемость */}
              <ReferenceArea x1={50} x2={100} y1={50} y2={100} fill="#16a34a" fillOpacity={0.08} />
              <ReferenceLine x={50} stroke="#cbd5e1" />
              <ReferenceLine y={50} stroke="#cbd5e1" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                allowDataOverflow
                tick={{ fontSize: 10 }}
                label={{ value: "Реализуемость →", position: "insideBottom", offset: -14, fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, 100]}
                allowDataOverflow
                tick={{ fontSize: 10 }}
                label={{ value: "Эффект →", angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <ZAxis type="number" dataKey="z" range={[140, 420]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const p = payload[0].payload as (typeof points)[number];
                  return (
                    <div className="max-w-[240px] rounded-lg border bg-background p-2 text-xs shadow-md">
                      <p className="font-semibold">{p.label}</p>
                      <p className="text-muted-foreground">
                        {p.type} · {p.product}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Эффект {p.y} · Реализуемость {p.x}
                        {p.recommended ? " · рекомендуем" : ""}
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter data={points}>
                {points.map((p, idx) => (
                  <Cell key={idx} fill={p.recommended ? "#2563eb" : "#94a3b8"} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] text-muted-foreground">
          <span>↗ верх-право: быстрые победы</span>
          <span className="text-right">↖ верх-лево: большие ставки</span>
          <span>↘ низ-право: заполнители</span>
          <span className="text-right">↙ низ-лево: отложить</span>
        </div>
      </CardContent>
    </Card>
  );
}
