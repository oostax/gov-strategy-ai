"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { StrategyBet } from "@/lib/schemas/structured-output";

const typeLabel: Record<string, string> = {
  process: "Процесс",
  financial: "Финансы",
  technology: "Технологии",
  partnership: "Партнерство",
  regulatory: "Регулирование",
};

export function BetsDecisionMatrix({ bets }: { bets: StrategyBet[] }) {
  if (bets.length < 2) return null;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Сравнение ставок</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="border-b px-3 py-2 font-semibold">Опция</th>
                <th className="border-b px-3 py-2 font-semibold">Тип</th>
                <th className="border-b px-3 py-2 font-semibold">Что делает Сбер</th>
                <th className="border-b px-3 py-2 font-semibold">Критерий запуска/остановки</th>
                <th className="border-b px-3 py-2 font-semibold">Что проверить</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet, idx) => (
                <tr key={`${bet.id ?? "bet"}-${idx}`} className="align-top">
                  <td className="border-b px-3 py-3">
                    <div className="flex gap-2">
                      {bet.recommended ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-semibold leading-tight">{bet.title}</p>
                        {bet.recommended && (
                          <p className="mt-1 text-[11px] text-primary">Рекомендуемая</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="border-b px-3 py-3 text-muted-foreground">
                    {typeLabel[bet.type] ?? bet.type}
                  </td>
                  <td className="border-b px-3 py-3">
                    <p className="font-medium">{bet.sberProduct}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {bet.sberAction2weeks}
                    </p>
                  </td>
                  <td className="border-b px-3 py-3 text-xs leading-snug">{bet.goNoGo}</td>
                  <td className="border-b px-3 py-3 text-xs leading-snug">{bet.checkNeeded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
