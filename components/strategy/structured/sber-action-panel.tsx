"use client";

import { ArrowRight, BriefcaseBusiness, Database, FileText, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SberAction } from "@/lib/schemas/structured-output";

export function SberActionPanel({ actions }: { actions: SberAction[] }) {
  if (!actions.length) return null;

  return (
    <Card className="rounded-2xl border-primary/10">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <BriefcaseBusiness className="size-4 text-primary" />
          Участие Сбера
        </h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {actions.slice(0, 4).map((action, idx) => (
            <div key={`${action.id ?? "act"}-${idx}`} className="rounded-xl border bg-muted/20 p-3">
              <p className="mb-2 text-sm font-semibold leading-tight">{action.asset}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Mini icon={<Timer className="size-3.5" />} label="2 недели" value={action.firstTwoWeeks} />
                <Mini icon={<Database className="size-3.5" />} label="Данные" value={action.dataNeeded} />
                <Mini icon={<FileText className="size-3.5" />} label="Артефакт" value={action.artifact} />
                <Mini icon={<ArrowRight className="size-3.5" />} label="Следующий ход" value={action.commercialNextStep} />
              </div>
            </div>
          ))}
        </div>
        {actions.length > 4 && (
          <p className="mt-2 text-xs text-muted-foreground">
            + ещё {actions.length - 4}{" "}
            {plural(actions.length - 4, "актив", "актива", "активов")} Сбера
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-2.5 py-2">
      <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="text-xs leading-snug">{value}</p>
    </div>
  );
}
