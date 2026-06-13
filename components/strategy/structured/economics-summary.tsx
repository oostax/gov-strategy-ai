"use client";

import { Banknote, Clock3, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { EconomicsSummary as Economics } from "@/lib/schemas/structured-output";

const confidenceLabel: Record<string, string> = {
  high: "оценка надёжная",
  medium: "оценка ориентировочная",
  low: "требует baseline",
};

export function EconomicsSummary({ economics }: { economics: Economics }) {
  const cells = [
    economics.capex && { icon: <Wallet className="size-4" />, label: "Инвестиции (CAPEX)", value: economics.capex },
    economics.opex && { icon: <Banknote className="size-4" />, label: "OPEX / год", value: economics.opex },
    economics.expectedEffect && {
      icon: <TrendingUp className="size-4" />,
      label: "Ожидаемый эффект",
      value: economics.expectedEffect,
      accent: true,
    },
    economics.payback && { icon: <Clock3 className="size-4" />, label: "Окупаемость", value: economics.payback },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string; accent?: boolean }[];

  if (!cells.length) return null;

  return (
    <Card className="rounded-2xl border-primary/10">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="size-4 text-primary" /> Экономика решения
          </h3>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {economics.horizon && <span>горизонт: {economics.horizon}</span>}
            {economics.confidence && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                {confidenceLabel[economics.confidence] ?? economics.confidence}
              </span>
            )}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {cells.map((cell, idx) => (
            <div
              key={idx}
              className={`rounded-xl border p-3 ${
                cell.accent ? "border-primary/30 bg-primary/[0.04]" : "bg-muted/20"
              }`}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {cell.icon} {cell.label}
              </p>
              <p
                className={`mt-1.5 text-xl font-bold leading-none tabular-nums ${
                  cell.accent ? "text-primary" : ""
                }`}
              >
                {cell.value}
              </p>
            </div>
          ))}
        </div>
        {economics.note && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{economics.note}</p>
        )}
      </CardContent>
    </Card>
  );
}
