"use client";

import { AlertTriangle, Building2, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Verdict } from "@/lib/schemas/structured-output";
import { VerdictBanner } from "./verdict-banner";

interface Props {
  decision: string;
  whyNow: string;
  costOfInaction: string;
  sberRole: string;
  verdict?: Verdict;
}

export function DecisionHero({ decision, whyNow, costOfInaction, sberRole, verdict }: Props) {
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10 shadow-sm">
      <CardContent className="p-0">
        {/* Решение — крупно */}
        <div className="space-y-3 border-b bg-gradient-to-br from-primary/[0.03] to-transparent p-5">
          {verdict && <VerdictBanner verdict={verdict} />}
          <p className="text-lg font-semibold leading-snug tracking-tight">{decision}</p>
        </div>

        {/* Три строки контекста */}
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MiniBlock
            icon={<Zap className="size-4 text-amber-600" />}
            label="Почему сейчас"
            value={whyNow}
          />
          <MiniBlock
            icon={<AlertTriangle className="size-4 text-destructive" />}
            label="Цена бездействия"
            value={costOfInaction}
          />
          <MiniBlock
            icon={<Building2 className="size-4 text-primary" />}
            label="Роль Сбера"
            value={sberRole}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniBlock({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm leading-snug">{value}</p>
      </div>
    </div>
  );
}
