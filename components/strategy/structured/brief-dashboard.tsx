"use client";

import { ArrowRight, CalendarDays, CheckCircle2, Equal, FileText, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BriefOutput } from "@/lib/schemas/structured-output";
import { RisksPanel } from "./risks-panel";
import { SourcesFooter } from "./sources-footer";
import { VisualsSection } from "./visuals-section";
import { SberActionPanel } from "./sber-action-panel";

export function BriefDashboard({ data }: { data: BriefOutput }) {
  return (
    <div className="space-y-5">
      {/* Решение — крупно */}
      <Card id="decision" className="scroll-mt-56 overflow-hidden rounded-2xl border-primary/10">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Решение
            </p>
          </div>
          <p className="text-lg font-semibold leading-snug">{data.decision}</p>
        </CardContent>
      </Card>

      <div id="sber-actions" className="scroll-mt-56">
        <SberActionPanel actions={data.sberActions ?? []} />
      </div>

      <div id="visuals" className="scroll-mt-56">
        <VisualsSection visuals={data.visuals ?? []} />
      </div>

      {/* Факты */}
      {data.evidence?.length > 0 && (
        <Card id="evidence" className="scroll-mt-56 rounded-2xl">
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-emerald-600" /> Доказательная база
            </h3>
            <div className="space-y-2">
              {data.evidence.map((fact, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-xl border bg-muted/20 px-3 py-2.5"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {idx + 1}
                  </span>
                  <p className="text-sm leading-snug">{fact}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Экономика */}
      {data.economics && (
        <div id="economics" className="scroll-mt-56">
          <EconomicsFormula economics={data.economics} />
        </div>
      )}

      {/* Риски */}
      <div id="risks" className="scroll-mt-56">
        <RisksPanel risks={data.risks ?? []} />
      </div>

      {/* Следующий шаг — один, крупный */}
      {data.nextStep && (
        <Card id="next-steps" className="scroll-mt-56 rounded-2xl border-primary/10 bg-gradient-to-r from-primary/[0.03] to-transparent">
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ArrowRight className="size-4 text-primary" /> Следующий шаг
            </h3>
            <div className="rounded-xl border bg-background p-4">
              <p className="text-base font-semibold">{data.nextStep.action}</p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" /> {data.nextStep.owner}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> {data.nextStep.deadline}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div id="sources" className="scroll-mt-56">
        <SourcesFooter sources={data.sources ?? []} hypotheses={[]} />
      </div>
    </div>
  );
}

// Разбираем «итог = X × Y» на наглядные части: слева крупный итог, справа формула.
function EconomicsFormula({ economics }: { economics: string }) {
  const eqIdx = economics.indexOf("=");
  const result = eqIdx > 0 ? economics.slice(0, eqIdx).trim() : null;
  const formula = eqIdx > 0 ? economics.slice(eqIdx + 1).trim() : economics;
  const parts = formula.split(/(?<=\S)\s*[×*]\s*(?=\S)/);

  return (
    <Card className="rounded-2xl border-amber-200/50 bg-amber-50/20 dark:border-amber-900/30 dark:bg-amber-950/10">
      <CardContent className="p-4">
        <h3 className="mb-2 text-sm font-semibold">Экономика</h3>
        <div className="flex flex-wrap items-center gap-2">
          {result && (
            <>
              <span className="text-base font-bold text-amber-800 dark:text-amber-200">{result}</span>
              <Equal className="size-4 text-muted-foreground" />
            </>
          )}
          {parts.map((part, idx) => (
            <span key={idx} className="flex items-center gap-2">
              {idx > 0 && <span className="text-muted-foreground">×</span>}
              <span className="rounded-lg border bg-background px-2.5 py-1 font-mono text-xs leading-snug">
                {part.trim()}
              </span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
