"use client";

import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  MessageSquare,
  Pause,
  Target,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MeetingOutput, NextStep } from "@/lib/schemas/structured-output";
import { SourcesFooter } from "./sources-footer";
import { VisualsSection } from "./visuals-section";
import { SberActionPanel } from "./sber-action-panel";

export function MeetingDashboard({ data }: { data: MeetingOutput }) {
  return (
    <div className="space-y-5">
      {/* Hero — цель встречи */}
      <Card id="decision" className="scroll-mt-56 overflow-hidden rounded-2xl border-primary/10">
        <CardContent className="p-0">
          <div className="border-b bg-gradient-to-br from-primary/[0.03] to-transparent p-5">
            <div className="mb-2 flex items-center gap-2">
              <Target className="size-4 text-primary" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Цель встречи
              </p>
            </div>
            <p className="text-lg font-semibold leading-snug">{data.meetingGoal}</p>
          </div>
          <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <MiniBlock label="Главный тезис" value={data.mainThesis} />
            <MiniBlock label="Что предлагаем" value={data.proposal} />
            <MiniBlock label="Что оставляем" value={data.leaveAfter || data.artifact} />
          </div>
        </CardContent>
      </Card>

      <div id="sber-actions" className="scroll-mt-56">
        <SberActionPanel actions={data.sberActions ?? []} />
      </div>

      <div id="visuals" className="scroll-mt-56">
        <VisualsSection visuals={data.visuals ?? []} />
      </div>

      {/* Сценарий встречи */}
      {data.agenda?.length > 0 && (
        <div id="agenda" className="scroll-mt-56 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Clock className="size-4" /> Сценарий встречи
          </h3>
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="space-y-0">
                {data.agenda.map((block, idx) => (
                  <div
                    key={`${block.id ?? "agenda"}-${idx}`}
                    className={`grid gap-3 py-3 sm:grid-cols-[72px_1fr_1fr_1fr_1fr] ${idx > 0 ? "border-t" : ""}`}
                  >
                    <div className="flex items-start">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {block.time}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">
                        Тема
                      </p>
                      <p className="text-sm leading-snug">{block.topic}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">
                        Сбер говорит
                      </p>
                      <p className="text-sm leading-snug">{block.sberSays}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">
                        Спрашиваем ЛПР
                      </p>
                      <p className="text-sm leading-snug">{block.askLpr}</p>
                    </div>
                    <div className="rounded-lg bg-primary/[0.04] px-2 py-1">
                      <p className="text-[10px] font-medium uppercase text-primary/80">
                        Фиксируем
                      </p>
                      <p className="text-sm font-medium leading-snug">{block.fixDecision}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Возражения */}
      {data.objections?.length > 0 && (
        <div id="objections" className="scroll-mt-56 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <MessageSquare className="size-4" /> Возражения и ответы
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.objections.map((obj, idx) => (
              <Card key={`${obj.id ?? "obj"}-${idx}`} className="rounded-xl">
                <CardContent className="p-3">
                  <p className="mb-1.5 text-sm font-medium leading-tight text-destructive/80">
                    «{obj.objection}»
                  </p>
                  <p className="mb-1.5 text-sm leading-snug">{obj.response}</p>
                  <p className="text-[11px] italic text-muted-foreground">
                    Нужен факт: {obj.factNeeded}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* После встречи — три исхода */}
      {((data.ifYes?.length ?? 0) + (data.ifPause?.length ?? 0) + (data.ifNo?.length ?? 0)) > 0 && (
        <div id="follow-up" className="scroll-mt-56 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <ArrowRight className="size-4" /> После встречи
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <OutcomeCard
              icon={<CheckCircle2 className="size-4 text-emerald-600" />}
              title="Если согласились"
              steps={data.ifYes ?? []}
              color="border-emerald-200 dark:border-emerald-900"
            />
            <OutcomeCard
              icon={<Pause className="size-4 text-amber-600" />}
              title="Если взяли паузу"
              steps={data.ifPause ?? []}
              color="border-amber-200 dark:border-amber-900"
            />
            <OutcomeCard
              icon={<XCircle className="size-4 text-destructive" />}
              title="Если отказали"
              steps={data.ifNo ?? []}
              color="border-destructive/20"
            />
          </div>
        </div>
      )}

      <div id="sources" className="scroll-mt-56">
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} />
      </div>
    </div>
  );
}

function MiniBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm leading-snug">{value}</p>
    </div>
  );
}

function OutcomeCard({
  icon,
  title,
  steps,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  steps: NextStep[];
  color: string;
}) {
  return (
    <Card className={`rounded-xl border-2 ${color}`}>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <p className="text-sm font-semibold">{title}</p>
          </div>
          {steps.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {steps.length}
            </Badge>
          )}
        </div>
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Не определено</p>
        ) : (
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={`${step.id ?? "step"}-${idx}`} className="rounded-lg bg-muted/30 px-2.5 py-2">
                <p className="text-xs font-medium leading-snug">{step.action}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5">
                    <User className="size-2.5" /> {step.owner}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <CalendarDays className="size-2.5" /> {step.deadline}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
