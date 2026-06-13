"use client";

import { ChevronDown, ChevronUp, ChartNoAxesCombined, Clock8, FileText, Presentation, Route, ShieldAlert, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ActionType } from "@/lib/schemas/agent";

const actions: Array<{ type: ActionType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { type: "shorten_for_vp", label: "Записка для ВП", icon: FileText },
  { type: "add_economic_effect", label: "Экономика и базовая линия", icon: ChartNoAxesCombined },
  { type: "add_8_week_mvp", label: "Пилот на 8 недель", icon: Clock8 },
  { type: "add_risks", label: "Риски и стоп-факторы", icon: ShieldAlert },
  { type: "make_roadmap", label: "План с владельцами", icon: Route },
  { type: "meeting_talking_points", label: "Тезисы для ЛПР", icon: Sparkles },
  { type: "presentation_format", label: "Структура презентации", icon: Presentation },
];

export function InteractiveActions({ disabled, loading, onAction }: { disabled: boolean; loading: boolean; onAction: (action: ActionType) => void }) {
  const [open, setOpen] = useState(false);
  const primary = actions.slice(0, 3);
  const secondary = actions.slice(3);
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <WandSparkles className="size-4" />
            <p className="font-semibold">Пульт агента</p>
          </div>
          <Badge variant="secondary">{actions.length} действий</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {primary.map((action) => (
            <ActionButton key={action.type} action={action} disabled={disabled || loading} onAction={onAction} compact />
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-between rounded-xl px-2" onClick={() => setOpen((value) => !value)}>
          Еще действия
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
        {open && (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {secondary.map((action) => (
              <ActionButton key={action.type} action={action} disabled={disabled || loading} onAction={onAction} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionButton({
  action,
  disabled,
  onAction,
  compact = false,
}: {
  action: { type: ActionType; label: string; icon: React.ComponentType<{ className?: string }> };
  disabled: boolean;
  onAction: (action: ActionType) => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="outline"
      className={compact
        ? "h-16 flex-col gap-1 rounded-xl px-2 text-center text-[11px] leading-3"
        : "min-h-10 justify-start rounded-xl px-3 text-left text-sm leading-5"}
      disabled={disabled}
      onClick={() => onAction(action.type)}
    >
      <action.icon className={compact ? "size-4" : "size-4"} />
      <span className={compact ? "line-clamp-2" : ""}>{action.label}</span>
    </Button>
  );
}
