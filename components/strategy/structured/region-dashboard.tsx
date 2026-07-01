"use client";

import { useState, type ReactNode } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Landmark,
  Lightbulb,
  MapPin,
  Route,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { RegionAnalysisOutput } from "@/lib/schemas/structured-output";
import { SourcesFooter } from "./sources-footer";
import { VisualsSection } from "./visuals-section";

// Показываем блок только если в нём есть содержание — никакой воды и пустых заголовков.
const hasNum = (n: unknown): n is number => Number.isFinite(n);

function isEmptyAnalysisText(value: string | undefined | null) {
  if (!value?.trim()) return true;
  return /в (?:представленных )?источниках нет|нет (?:конкретных |прямых )?(?:данных|сведений|упоминаний)|не содержит данных|не содержит сведений|без детализации|не раскрыт|требует уточнения|не найдено/i.test(value);
}

function cleanDisplayText(value: string | undefined | null) {
  return (value ?? "")
    .replace(/\s*\((?:гипотеза|например|одобренн)[^)]+\)/gi, "")
    .replace(/\bгипотеза,\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function DetailsToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
      >
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {open ? "Свернуть" : "Подробнее"}
      </button>
      {open && <div className="mt-2 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">{children}</div>}
    </div>
  );
}

function isFederalStakeholder(role: string | undefined, department: string | undefined) {
  const text = `${role ?? ""} ${department ?? ""}`;
  return /правительств[ао]\s+рф|российской федерации|федеральн(?:ый|ого|ая|ой)|госдум|совет федерации|сенатор|министр\s+рф|вице[-\s]?премьер/i.test(text);
}

function hasFederalContext(stakeholder: RegionAnalysisOutput["stakeholderMap"][number]) {
  const role = stakeholder.role ?? "";
  const details = `${stakeholder.achievements ?? ""} ${stakeholder.recentNews ?? ""}`;
  if (/губернатор/i.test(role)) return false;
  const normalized = details.toLowerCase().replace(/[‐‑‒–—-]/g, " ");
  return /премьер\s+министр|правительств[ао]\s+рф|заместител[ья]\s+председателя\s+правительства\s+рф|вице\s+премьер/.test(normalized) && /рф|российской федерации/.test(normalized);
}

function hasFullPersonName(name: string | undefined) {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).length >= 3;
}

function isFederalInfrastructureAlternative(value: { vendor?: string; product?: string; where?: string; evidence?: string; incumbentPosition?: string }) {
  const text = `${value.vendor ?? ""} ${value.product ?? ""} ${value.where ?? ""} ${value.evidence ?? ""} ${value.incumbentPosition ?? ""}`.toLowerCase();
  return /сертификат\s+минцифр|минцифр[аы]\s+россии|единая информационная система|(?:^|\s)еис(?:\s|$)|zakupki\.gov\.ru|независимый регистратор/.test(text);
}

export function RegionDashboard({ data }: { data: RegionAnalysisOutput }) {
  return (
    <div className="space-y-5">
      {/* Hero: Карточка региона */}
      <RegionHero summary={data.regionSummary} />

      {/* Ключевой тезис анализа */}
      {data.coreThesis && <CoreThesisSection thesis={data.coreThesis} />}

      {/* Отраслевая структура */}
      <div id="industries" className="scroll-mt-56">
        <IndustrySection items={data.industryBreakdown} />
      </div>

      {/* Ключевые игроки региона */}
      {data.keyPlayers && data.keyPlayers.length > 0 && (
        <div id="key-players" className="scroll-mt-56">
          <KeyPlayersSection players={data.keyPlayers} />
        </div>
      )}

      {/* Бюджетный ландшафт */}
      <div id="budget" className="scroll-mt-56">
        <BudgetSection landscape={data.budgetLandscape} />
      </div>

      {/* Стратегические приоритеты */}
      <div id="priorities" className="scroll-mt-56">
        <PrioritiesSection priorities={data.strategicPriorities} />
      </div>

      <div id="scenarios" className="scroll-mt-56">
        <ScenariosSection scenarios={data.regionalScenarios} />
      </div>

      {/* Инфографика из реальных чисел (доли ВРП, структура бюджета) */}
      {data.visuals && data.visuals.length > 0 && (
        <div id="visuals" className="scroll-mt-56">
          <VisualsSection visuals={data.visuals} />
        </div>
      )}

      <div id="stakeholders" className="scroll-mt-56">
        <StakeholderSection stakeholders={data.stakeholderMap} />
      </div>

      <div id="competition" className="scroll-mt-56">
        <CompetitionSection competitors={data.competitiveLandscape} checks={data.hypotheses ?? []} />
      </div>

      {/* Источники */}
      <div id="sources" className="scroll-mt-56">
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} dataGaps={data.dataGaps ?? []} />
      </div>
    </div>
  );
}

function RegionHero({ summary }: { summary: RegionAnalysisOutput["regionSummary"] }) {
  const hasPopulation = Boolean(summary.population?.trim()) && !/нужно снять|уточн|неизвестн/i.test(summary.population);
  const hasBudget = Boolean(summary.budgetTotal?.trim()) && !/нужно снять|уточн|неизвестн/i.test(summary.budgetTotal);
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
        {(hasPopulation || hasBudget) && (
          <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {hasPopulation && <MiniBlock icon={<Users className="size-4 text-blue-600" />} label="Население" value={summary.population} />}
            {hasBudget && <MiniBlock icon={<Landmark className="size-4 text-emerald-600" />} label="Бюджет" value={summary.budgetTotal} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniBlock({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium leading-snug">{value}</p>
      </div>
    </div>
  );
}

function CoreThesisSection({ thesis }: { thesis: NonNullable<RegionAnalysisOutput["coreThesis"]> }) {
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Lightbulb className="size-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ключевой вывод</p>
            <p className="mt-1 text-base font-semibold leading-snug">{thesis.headline}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-3">
          <ThesisCell label="Сигнал" value={thesis.surfaceSignal} />
          <ThesisCell label="Напряжение" value={thesis.hiddenReality} tone="warn" />
          <ThesisCell label="Вывод для решения" value={thesis.soWhat} tone="primary" />
        </div>
        {thesis.evidence && thesis.evidence.length > 0 && (
          <DetailsToggle>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {thesis.evidence.map((e, i) => (
                <p key={i} className="rounded-lg bg-muted/30 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">{e}</p>
              ))}
            </div>
          </DetailsToggle>
        )}
      </CardContent>
    </Card>
  );
}

function ThesisCell({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warn" | "primary" }) {
  if (!value) return null;
  const toneClass = tone === "primary"
    ? "border-primary/20 bg-primary/[0.04]"
    : tone === "warn"
      ? "border-amber-500/20 bg-amber-500/[0.04]"
      : "bg-muted/20";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs leading-snug">{value}</p>
    </div>
  );
}

function IndustrySection({ items }: { items: RegionAnalysisOutput["industryBreakdown"] }) {
  const visibleItems = (items ?? []).filter((item) =>
    item.keyEnterprises?.length > 0 ||
    Boolean(item.currentDigitalState?.trim()) ||
    item.limitations?.some((lim) => !isEmptyAnalysisText(lim) && !/дефицитн(?:ая|ой)\s+бюджетн(?:ая|ой)\s+рамк|запуск\s+новых\s+инициатив\s+ограничен/i.test(lim)),
  );
  if (!visibleItems.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" />
          Отраслевая структура
        </h3>
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <div key={item.id} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{item.name}</p>
                <div className="flex gap-1">
                  {item.keyEnterprises?.length > 0 && (
                    <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      организаций: {item.keyEnterprises.length}
                    </span>
                  )}
                  {item.limitations?.filter((lim) => !isEmptyAnalysisText(lim)).length > 0 && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      ограничений: {item.limitations.filter((lim) => !isEmptyAnalysisText(lim)).length}
                    </span>
                  )}
                </div>
              </div>
              {item.keyEnterprises && item.keyEnterprises.length > 0 && (
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {item.keyEnterprises.slice(0, 2).map((e, i) => (
                    <div key={i} className="rounded-lg bg-background/70 px-2.5 py-2 text-xs">
                      <span className="font-medium">{e.name}</span>
                      {e.description && <span className="text-muted-foreground"> — {e.description}</span>}
                    </div>
                  ))}
                </div>
              )}
              {(item.keyEnterprises?.length > 2 || item.limitations?.some((lim) => !isEmptyAnalysisText(lim))) && (
                <DetailsToggle>
                  {item.keyEnterprises?.slice(2).map((e, i) => (
                    <div key={`e-${i}`} className="rounded-lg bg-background/70 px-2.5 py-2 text-xs">
                      <span className="font-medium">{e.name}</span>
                      {e.description && <span className="text-muted-foreground"> — {e.description}</span>}
                    </div>
                  ))}
                  {item.limitations?.filter((lim) => !isEmptyAnalysisText(lim)).map((lim, i) => (
                    <p key={`l-${i}`} className="rounded-lg bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{lim}</p>
                  ))}
                </DetailsToggle>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function KeyPlayersSection({ players }: { players: NonNullable<RegionAnalysisOutput["keyPlayers"]> }) {
  if (!players?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" />
          Крупные организации и операторы ({players.length})
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {players.map((p) => (
            <div key={p.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{p.name}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    p.role === "dominant"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : p.role === "challenger"
                        ? "bg-amber-500/10 text-amber-600"
                        : p.role === "distressed"
                          ? "bg-red-500/10 text-red-600"
                          : "bg-blue-500/10 text-blue-600"
                  }`}
                >
                  {roleLabel(p.role)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.sector}</p>
              {p.financials?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.financials.map((f, i) => (
                    <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {f.label}: <span className="font-medium text-foreground">{f.value}</span>
                    </span>
                  ))}
                </div>
              )}
              {p.sberAngle && <p className="mt-2 text-[11px] text-primary/80">Значение для анализа: {p.sberAngle}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    dominant: "крупный оператор",
    challenger: "растущий участник",
    distressed: "зона риска",
    emerging: "новое направление",
  };
  return labels[role] || role;
}

function BudgetSection({ landscape }: { landscape: RegionAnalysisOutput["budgetLandscape"] }) {
  if (!landscape) return null;
  const deficit = hasNum(landscape.totalIncomeValue) && hasNum(landscape.totalExpenseValue)
    ? landscape.totalExpenseValue - landscape.totalIncomeValue
    : undefined;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Landmark className="size-4 text-muted-foreground" />
          Бюджет и государственные программы
        </h3>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {landscape.totalBudget && (
            <div className="rounded-xl bg-muted/30 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Общий бюджет</p>
              <p className="mt-1 text-lg font-bold">{landscape.totalBudget}</p>
            </div>
          )}
          {hasNum(landscape.totalIncomeValue) && (
            <div className="rounded-xl bg-muted/30 p-3">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Доходы</p>
              <p className="mt-1 text-lg font-bold">{landscape.totalIncomeValue.toLocaleString("ru-RU")} млрд ₽</p>
            </div>
          )}
          {hasNum(deficit) && deficit > 0 && (
            <div className="rounded-xl bg-amber-500/[0.06] p-3">
              <p className="text-[11px] font-semibold uppercase text-amber-700">Дефицит</p>
              <p className="mt-1 text-lg font-bold">{deficit.toLocaleString("ru-RU")} млрд ₽</p>
            </div>
          )}
        </div>
        {(() => {
          const expenses = (landscape.breakdown ?? [])
            .filter((b) => b.kind === "expense" && hasNum(b.value))
            .sort((a, b) => (b.value as number) - (a.value as number));
          if (expenses.length < 2) return null;
          const max = Math.max(...expenses.map((e) => e.value as number), 1);
          return (
            <div className="mb-3 rounded-xl border bg-muted/10 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Структура расходов:</p>
              <div className="space-y-1.5">
                {expenses.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-[11px]">{e.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${Math.max(3, Math.round(((e.value as number) / max) * 100))}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[11px] font-medium tabular-nums">
                      {(e.value as number).toLocaleString("ru-RU")} {e.unit ?? "млрд ₽"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {landscape.keyPrograms?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Государственные программы и национальные проекты</p>
            {landscape.keyPrograms.slice(0, 3).map((prog) => (
              <div key={prog.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                <Landmark className="mt-0.5 size-3 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{prog.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {prog.owner} · {prog.budget} · {prog.status}
                  </p>
                </div>
              </div>
            ))}
            {landscape.keyPrograms.length > 3 && (
              <DetailsToggle>
                {landscape.keyPrograms.slice(3).map((prog) => (
                  <div key={prog.id} className="rounded-lg border p-2">
                    <p className="text-xs font-medium">{prog.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {[prog.owner, prog.budget, prog.status].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))}
              </DetailsToggle>
            )}
          </div>
        )}
        {landscape.dataNeeded && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700">{landscape.dataNeeded}</p>
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
            <div className="grid gap-2 sm:grid-cols-2">
              {priorities.confirmed.slice(0, 4).map((item, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl border bg-emerald-500/[0.03] p-2.5 text-xs">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                  {item}
                </div>
              ))}
            </div>
            {priorities.confirmed.length > 4 && (
              <DetailsToggle>
                <ul className="space-y-1">
                  {priorities.confirmed.slice(4).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </DetailsToggle>
            )}
          </div>
        )}
        {priorities.hypothesized?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-amber-600">Требует подтверждения:</p>
            <ul className="space-y-1">
              {priorities.hypothesized.slice(0, 2).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <HelpCircle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {priorities.roadmap && priorities.roadmap.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Горизонт 5 лет</p>
            <div className="grid gap-2 lg:grid-cols-4">
              {priorities.roadmap.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-xl border bg-muted/10 p-2.5">
                  <span className="inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {item.period}
                  </span>
                  <div className="mt-2 min-w-0">
                    <p className="text-xs font-semibold leading-snug">{item.title}</p>
                    {item.linkedProgram && (
                      <p className="text-[10px] text-muted-foreground">Связь: {item.linkedProgram}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {priorities.roadmap.length > 4 && (
              <DetailsToggle>
                {priorities.roadmap.slice(4).map((item) => (
                  <div key={item.id} className="flex gap-3 text-muted-foreground">
                    <span className="mt-0.5 shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                      {item.period}
                    </span>
                    <p className="text-xs leading-snug">{item.title}</p>
                  </div>
                ))}
              </DetailsToggle>
            )}
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
  const visible = (stakeholders ?? []).filter((stakeholder) =>
    hasFullPersonName(stakeholder.name) &&
    !isFederalStakeholder(stakeholder.role, stakeholder.department) &&
    !hasFederalContext(stakeholder),
  );
  if (!visible.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-muted-foreground" />
          Руководители и ведомства ({visible.length})
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((s) => (
            <div key={s.id} className="rounded-xl border p-3">
              <p className="text-sm font-medium">{s.name || s.role || s.department}</p>
              <p className="text-[11px] text-muted-foreground">{s.role}, {s.department}</p>
              {s.managementInterest && <p className="mt-2 text-xs">{s.managementInterest}</p>}
              {(s.achievements || s.recentNews || s.managedBudget || s.engagementPrinciple) && (
                <DetailsToggle>
                  {s.achievements && <p className="text-xs"><span className="font-medium">Результаты:</span> {s.achievements}</p>}
                  {s.recentNews && <p className="text-xs text-muted-foreground/80"><span className="font-medium text-foreground">События:</span> {s.recentNews}</p>}
                  {s.managedBudget && <p className="text-xs text-muted-foreground/80"><span className="font-medium text-foreground">Ресурс:</span> {s.managedBudget}</p>}
                  {s.engagementPrinciple && <p className="text-xs text-muted-foreground/80"><span className="font-medium text-foreground">Линия взаимодействия:</span> {s.engagementPrinciple}</p>}
                </DetailsToggle>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ScenariosSection({ scenarios }: { scenarios?: RegionAnalysisOutput["regionalScenarios"] }) {
  if (!scenarios?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Route className="size-4 text-muted-foreground" />
          Сценарии развития
        </h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="relative overflow-hidden rounded-xl border bg-muted/10 p-3">
              <div className={`absolute inset-x-0 top-0 h-1 ${
                scenario.probability === "high" ? "bg-emerald-500" : scenario.probability === "medium" ? "bg-amber-500" : "bg-muted-foreground/40"
              }`} />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{scenario.title}</p>
                <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {scenario.horizon} · {probabilityLabel(scenario.probability)}
                </span>
              </div>
              {cleanDisplayText(scenario.trigger) && <p className="mt-2 text-xs"><span className="font-medium">Триггер:</span> {cleanDisplayText(scenario.trigger)}</p>}
              {(scenario.budgetImplication || scenario.industryImpact || scenario.regionMoves?.length || scenario.earlySignals?.length) && (
                <DetailsToggle>
                  {scenario.budgetImplication && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Бюджет:</span> {cleanDisplayText(scenario.budgetImplication)}
                    </p>
                  )}
                  {scenario.industryImpact && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Отрасли:</span> {cleanDisplayText(scenario.industryImpact)}
                    </p>
                  )}
                  {scenario.regionMoves?.length > 0 && (
                    <ul className="space-y-1">
                      {scenario.regionMoves.map(cleanDisplayText).filter(Boolean).slice(0, 3).map((move, index) => (
                        <li key={index} className="text-[11px] text-muted-foreground">• {move}</li>
                      ))}
                    </ul>
                  )}
                  {scenario.earlySignals?.length > 0 && (
                    <p className="text-[11px] text-amber-700">
                      Следить: {scenario.earlySignals.map(cleanDisplayText).filter(Boolean).slice(0, 3).join("; ")}
                    </p>
                  )}
                </DetailsToggle>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function probabilityLabel(value: string) {
  const labels: Record<string, string> = {
    high: "высокая вероятность",
    medium: "средняя вероятность",
    low: "низкая вероятность",
  };
  return labels[value] || value;
}

function CompetitionSection({ competitors, checks }: { competitors: RegionAnalysisOutput["competitiveLandscape"]; checks: string[] }) {
  const visible = (competitors ?? []).filter((item) => !isFederalInfrastructureAlternative(item));
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" />
          Поставщики и инфраструктурные альтернативы
        </h3>
        {!visible.length && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="text-sm font-medium">Региональные поставщики пока не подтверждены открытыми источниками</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              В материал не добавлены федеральные порталы, агрегаторы тендеров и неподтверждённые компании. Для анализа конкуренции нужны карточки контрактов, региональные закупки или официальный аудит внедрений.
            </p>
            {checks.length > 0 && (
              <DetailsToggle>
                {checks.slice(0, 4).map((item, index) => (
                  <p key={index} className="rounded-lg bg-background/70 px-2.5 py-2 text-[11px] text-muted-foreground">{item}</p>
                ))}
              </DetailsToggle>
            )}
          </div>
        )}
        <div className="space-y-2">
          {visible.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-xl border p-3">
              <span
                className={`mt-0.5 size-2 shrink-0 rounded-full ${
                  c.threatLevel === "high" ? "bg-red-500" : c.threatLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.vendor}</p>
                <p className="text-xs text-muted-foreground">{c.product} · {c.where}</p>
                {(c.stage || c.evidence || c.incumbentPosition || c.sberCounterPosition) && (
                  <DetailsToggle>
                    {c.stage && <p className="text-[11px] text-muted-foreground">Статус: {c.stage}</p>}
                    {c.evidence && <p className="text-[11px]">Факт: {c.evidence}</p>}
                    {c.incumbentPosition && <p className="text-[11px] text-muted-foreground">Где закреплён: {c.incumbentPosition}</p>}
                    {c.sberCounterPosition && <p className="text-[11px] text-primary">Позиция Сбера: {c.sberCounterPosition}</p>}
                  </DetailsToggle>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
