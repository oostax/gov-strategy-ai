"use client";

import { BarChart3, Building2, Landmark, RefreshCw, Route, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionProfile } from "@/lib/schemas/session";

const REGION_FOCUSES = [
  {
    label: "Всё",
    icon: RefreshCw,
    prompt:
      "Собери доказательный региональный бриф: факты из источников, структура бюджета, отрасли, приоритеты региона на 5 лет, сценарии, руководители, поставщики и список фактов для добора.",
  },
  {
    label: "Бюджет",
    icon: Landmark,
    prompt:
      "Пересобери с акцентом на бюджет: доходы, расходы, структура расходов, госпрограммы, закупки, бюджетные ограничения и что нужно проверить.",
  },
  {
    label: "Отрасли",
    icon: Building2,
    prompt:
      "Пересобери с акцентом на отрасли региона: драйверы экономики, АПК/промышленность/туризм/логистика/ЖКХ, подтверждённые ограничения, участники рынка и что нужно дозапросить.",
  },
  {
    label: "5 лет",
    icon: Zap,
    prompt:
      "Пересобери с акцентом на текущую стратегию региона и приоритеты на 5 лет: СЭР, нацпроекты, госпрограммы, что подтверждено источниками.",
  },
  {
    label: "Сценарии",
    icon: Route,
    prompt:
      "Пересобери с акцентом на 3-4 сценария развития региона: базовый, ускоренный, стрессовый и отраслевой поворот; покажи триггеры, бюджетные последствия, ранние сигналы и ссылку на факты.",
  },
] as const;

export function GenerationFocusControls({
  session,
  loading,
  onGenerate,
}: {
  session: SessionProfile;
  loading: boolean;
  onGenerate: (prompt?: string) => void;
}) {
  const isRegionSession =
    session.taskType === "region_strategy" || session.taskType === "sber_region_strategy";
  if (!isRegionSession) return null;

  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BarChart3 className="size-3.5" />
        Что пересобрать
      </div>
      <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent sm:hidden" />
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {REGION_FOCUSES.map((focus) => {
          const Icon = focus.icon;
          return (
            <Button
              key={focus.label}
              variant={focus.label === "Всё" ? "default" : "outline"}
              size="sm"
              disabled={loading}
              onClick={() => onGenerate(focus.prompt)}
              className="shrink-0 rounded-xl"
            >
              <Icon className="size-4" />
              {focus.label}
            </Button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
