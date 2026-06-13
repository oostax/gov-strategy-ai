"use client";

import {
  Building2,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  HelpCircle,
  Landmark,
  MapPin,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { RegionAnalysisOutput } from "@/lib/schemas/structured-output";
import { RisksPanel } from "./risks-panel";
import { NextStepsBar } from "./next-steps-bar";
import { SourcesFooter } from "./sources-footer";

export function RegionDashboard({ data }: { data: RegionAnalysisOutput }) {
  return (
    <div className="space-y-5">
      {/* Hero: Карточка региона */}
      <RegionHero summary={data.regionSummary} />

      {/* Отраслевая структура */}
      <div id="industries" className="scroll-mt-56">
        <IndustrySection items={data.industryBreakdown} />
      </div>

      {/* Бюджетный ландшафт */}
      <div id="budget" className="scroll-mt-56">
        <BudgetSection landscape={data.budgetLandscape} />
      </div>

      {/* Стратегические приоритеты */}
      <div id="priorities" className="scroll-mt-56">
        <PrioritiesSection priorities={data.strategicPriorities} />
      </div>

      {/* Карта ЛПР */}
      <div id="stakeholders" className="scroll-mt-56">
        <StakeholderSection stakeholders={data.stakeholderMap} />
      </div>

      {/* Конкурентный ландшафт */}
      <div id="competition" className="scroll-mt-56">
        <CompetitionSection competitors={data.competitiveLandscape} />
      </div>

      {/* Точки входа */}
      <div id="entry-points" className="scroll-mt-56">
        <EntryPointsSection entryPoints={data.entryPoints} />
      </div>

      {/* Информационные пробелы */}
      <div id="data-gaps" className="scroll-mt-56">
        <DataGapsSection gaps={data.dataGaps} />
      </div>

      {/* Риски */}
      <div id="risks" className="scroll-mt-56">
        <RisksPanel risks={data.risks ?? []} />
      </div>

      {/* Следующие шаги */}
      <div id="next-steps" className="scroll-mt-56">
        <NextStepsBar steps={data.nextSteps ?? []} />
      </div>

      {/* Источники */}
      <div id="sources" className="scroll-mt-56">
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} />
      </div>
    </div>
  );
}

function RegionHero({ summary }: { summary: RegionAnalysisOutput["regionSummary"] }) {
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10 shadow-sm">
      <CardContent className="p-0">
        <div className="space-y-3 border-b bg-gradient-to-br from-primary/[0.03] to-transparent p-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            {summary.federalDistrict}
          </div>
          <p className="text-lg font-semibold leading-snug tracking-tight">{summary.name}</p>
          <p className="text-sm text-muted-foreground">{summary.oneLiner}</p>
        </div>
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MiniBlock icon={<Users className="size-4 text-blue-600" />} label="Население" value={summary.population} />
          <MiniBlock icon={<Landmark className="size-4 text-emerald-600" />} label="Бюджет" value={summary.budgetTotal} />
          <MiniBlock icon={<Zap className="size-4 text-amber-600" />} label="Цифровая зрелость" value={summary.digitalMaturity} />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniBlock({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm leading-snug">{value}</p>
      </div>
    </div>
  );
}

function IndustrySection({ items }: { items: RegionAnalysisOutput["industryBreakdown"] }) {
  if (!items?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" />
          Отраслевая структура
        </h3>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{item.name}</p>
                {item.shareInGDP && item.shareInGDP !== "нужно снять" && (
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {item.shareInGDP}
                  </span>
                )}
              </div>
              {item.keyPlayers && (
                <p className="mt-1 text-xs text-muted-foreground">Ключевые игроки: {item.keyPlayers}</p>
              )}
              {item.currentDigitalState && (
                <p className="mt-1 text-xs text-muted-foreground">Цифра: {item.currentDigitalState}</p>
              )}
              {item.painPoints?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.painPoints.map((pain, i) => (
                    <span key={i} className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                      {pain}
                    </span>
                  ))}
                </div>
              )}
              {item.sberRelevance && (
                <p className="mt-2 text-xs text-primary/80">Релевантность для Сбера: {item.sberRelevance}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetSection({ landscape }: { landscape: RegionAnalysisOutput["budgetLandscape"] }) {
  if (!landscape) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Landmark className="size-4 text-muted-foreground" />
          Бюджетный ландшафт
        </h3>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {landscape.totalBudget && (
            <div className="rounded-xl bg-muted/30 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Общий бюджет</p>
              <p className="mt-1 text-lg font-bold">{landscape.totalBudget}</p>
            </div>
          )}
          {landscape.itShare && (
            <div className="rounded-xl bg-muted/30 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Доля ИТ</p>
              <p className="mt-1 text-lg font-bold">{landscape.itShare}</p>
            </div>
          )}
        </div>
        {landscape.keyPrograms?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Ключевые программы:</p>
            {landscape.keyPrograms.map((prog) => (
              <div key={prog.id} className="flex items-start gap-2 rounded-lg border p-2">
                <Target className="mt-0.5 size-3 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{prog.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {prog.owner} · {prog.budget} · {prog.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        {landscape.dataNeeded && (
          <p className="mt-3 text-xs text-amber-600">⚠ {landscape.dataNeeded}</p>
        )}
      </CardContent>
    </Card>
  );
}

function PrioritiesSection({ priorities }: { priorities: RegionAnalysisOutput["strategicPriorities"] }) {
  if (!priorities) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Zap className="size-4 text-muted-foreground" />
          Стратегические приоритеты
        </h3>
        {priorities.confirmed?.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-xs font-semibold text-emerald-600">Подтверждены:</p>
            <ul className="space-y-1">
              {priorities.confirmed.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {priorities.hypothesized?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-amber-600">Предположительно (требует проверки):</p>
            <ul className="space-y-1">
              {priorities.hypothesized.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <HelpCircle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {priorities.source && (
          <p className="mt-2 text-[10px] text-muted-foreground">Источник: {priorities.source}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StakeholderSection({ stakeholders }: { stakeholders: RegionAnalysisOutput["stakeholderMap"] }) {
  if (!stakeholders?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-muted-foreground" />
          Карта ЛПР ({stakeholders.length})
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {stakeholders.map((s) => (
            <div key={s.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{s.name}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    s.relationshipToSber === "warm"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : s.relationshipToSber === "hot"
                        ? "bg-red-500/10 text-red-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.relationshipToSber}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{s.role}, {s.department}</p>
              {s.motivation && <p className="mt-1 text-xs">Мотив: {s.motivation}</p>}
              {s.pain && <p className="mt-1 text-xs text-destructive/80">Боль: {s.pain}</p>}
              {s.howToEngage && <p className="mt-1 text-[11px] text-primary/80">Заход: {s.howToEngage}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CompetitionSection({ competitors }: { competitors: RegionAnalysisOutput["competitiveLandscape"] }) {
  if (!competitors?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" />
          Конкурентный ландшафт
        </h3>
        <div className="space-y-2">
          {competitors.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-xl border p-3">
              <span
                className={`mt-0.5 size-2 shrink-0 rounded-full ${
                  c.threatLevel === "high" ? "bg-red-500" : c.threatLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.vendor}</p>
                <p className="text-xs text-muted-foreground">{c.product} · {c.where}</p>
                <p className="text-[11px] text-muted-foreground">Статус: {c.stage}</p>
                {c.sberAdvantage && <p className="mt-1 text-[11px] text-primary/80">Преимущество Сбера: {c.sberAdvantage}</p>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EntryPointsSection({ entryPoints }: { entryPoints: RegionAnalysisOutput["entryPoints"] }) {
  if (!entryPoints?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Target className="size-4 text-muted-foreground" />
          Точки входа
        </h3>
        <div className="space-y-2">
          {entryPoints.map((ep) => (
            <div key={ep.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{ep.regionNeed}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    ep.confidence === "high"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : ep.confidence === "medium"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ep.confidence}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Способность Сбера: {ep.sberCapability}</p>
              <p className="mt-1 text-xs text-muted-foreground">ЛПР: {ep.stakeholder}</p>
              <p className="mt-1 text-xs font-medium text-primary">Первый шаг: {ep.firstAction}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DataGapsSection({ gaps }: { gaps: RegionAnalysisOutput["dataGaps"] }) {
  if (!gaps?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4 text-muted-foreground" />
          Информационные пробелы
        </h3>
        <div className="space-y-2">
          {gaps.map((gap) => (
            <div key={gap.id} className="flex items-start gap-2 rounded-lg border p-2">
              <HelpCircle className="mt-0.5 size-3 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <p className="text-xs font-medium">{gap.question}</p>
                <p className="text-[10px] text-muted-foreground">Как узнать: {gap.howToGet}</p>
                <p className="text-[10px] text-muted-foreground">Владелец: {gap.owner}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
