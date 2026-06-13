"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cog,
  DollarSign,
  Handshake,
  Landmark,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { StrategyBet } from "@/lib/schemas/structured-output";
import { cn } from "@/lib/utils";

const typeIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  process: Cog,
  financial: DollarSign,
  technology: Zap,
  partnership: Handshake,
  regulatory: Landmark,
};

const typeLabel: Record<string, string> = {
  process: "Процессная",
  financial: "Финансовая",
  technology: "Технологическая",
  partnership: "Партнёрская",
  regulatory: "Регуляторная",
};

export function BetsGrid({ bets }: { bets: StrategyBet[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!bets.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Sparkles className="size-4" /> Стратегические ставки
      </h3>
      <div className="grid gap-3 md:grid-cols-3">
        {bets.map((bet, idx) => {
          const Icon = typeIcon[bet.type] ?? Cog;
          const isOpen = expanded === idx;
          return (
            <Card
              key={`${bet.id ?? "bet"}-${idx}`}
              className={cn(
                "cursor-pointer rounded-2xl transition hover:shadow-md",
                bet.recommended && "ring-2 ring-primary/30",
              )}
              onClick={() => setExpanded(isOpen ? null : idx)}
            >
              <CardContent className="p-4">
                {/* Header */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {typeLabel[bet.type] ?? bet.type}
                    </Badge>
                  </div>
                  {bet.recommended && (
                    <Badge className="gap-1 bg-primary/10 text-primary">
                      <CheckCircle2 className="size-3" /> Рекомендуем
                    </Badge>
                  )}
                </div>

                {/* Title */}
                <p className="mb-2 text-sm font-semibold leading-tight">{bet.title}</p>

                {/* Product */}
                <div className="mb-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Продукт Сбера
                  </p>
                  <p className="text-sm font-semibold">{bet.sberProduct}</p>
                </div>

                {/* Expand toggle — карточка кликабельна целиком (onClick на Card) */}
                <span
                  aria-hidden
                  className="flex w-full items-center justify-center gap-1 pt-1 text-xs text-muted-foreground"
                >
                  {isOpen ? (
                    <>
                      Свернуть <ChevronUp className="size-3" />
                    </>
                  ) : (
                    <>
                      Подробнее <ChevronDown className="size-3" />
                    </>
                  )}
                </span>

                {/* Expanded details */}
                {isOpen && (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <Detail label="Логика" value={bet.logic} />
                    <Detail label="Первые 2 недели" value={bet.sberAction2weeks} />
                    <Detail label="Go / No-go" value={bet.goNoGo} />
                    <Detail label="Что проверить" value={bet.checkNeeded} />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm leading-snug">{value}</p>
    </div>
  );
}
