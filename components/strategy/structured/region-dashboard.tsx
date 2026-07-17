"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Compass,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitCompareArrows,
  HelpCircle,
  Landmark,
  Lightbulb,
  MapPin,
  Minus,
  Route,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type {
  RegionAnalysisOutput,
  RegionClaim,
  RegionStrategyRealityGap,
} from "@/lib/schemas/structured-output";
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

// Единый заголовок блока — тот же визуальный язык, что и у синтез-карточек сверху.
function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  count,
}: {
  icon: typeof Building2;
  title: string;
  subtitle?: string;
  count?: number;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold leading-tight">
          {title}
          {typeof count === "number" && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </h3>
        {subtitle && <p className="text-[11px] leading-tight text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

// Шаблонная «вода» в ограничениях отрасли (дублируется на каждой отрасли) — не несёт смысла.
function isBoilerplateLimitation(value: string | undefined | null) {
  if (!value?.trim()) return true;
  return /дефицитн(?:ая|ой|ый|ым)\s+бюджетн|бюджетн(?:ая|ой)\s+рамк|запуск\s+новых\s+инициатив\s+ограничен|ограничивает\s+финансирование\s+новых\s+проектов/i.test(value);
}

function meaningfulLimitations(list: string[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const lim of list ?? []) {
    if (isEmptyAnalysisText(lim) || isBoilerplateLimitation(lim)) continue;
    const key = lim.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lim.trim());
  }
  return result;
}

// Гипотезы приходят с висячими пояснениями в скобках — чистим до законченной формулировки.
function cleanHypothesis(value: string): string {
  return cleanDisplayText(value)
    .replace(/\s*\([^)]*(?:логичес|вытека|предполож|гипотез|интерес|официальн)[^)]*\)/gi, "")
    .replace(/[\s,;:–—-]+$/g, "")
    .trim();
}

function initials(name: string | undefined): string {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// «Приоритет (правовая основа)» → короткий заголовок + мелкая подпись-основание.
function splitBasis(item: string): { title: string; basis?: string } {
  const m = item.match(/^([\s\S]*?)\s*\(([^)]+)\)\s*$/);
  if (m && m[1].trim().length > 4) return { title: m[1].trim(), basis: m[2].trim() };
  return { title: item.trim() };
}

// Порядок «классических» блоков по умолчанию, если план не задал свой.
const DEFAULT_CLASSIC_ORDER = ["budget", "priorities", "scenarios", "industries", "stakeholders", "competition"];

export function RegionDashboard({ data }: { data: RegionAnalysisOutput }) {
  // Адаптивная композиция: порядок блоков из плана; недостающие дописываем в хвост.
  const planned = (data.sectionOrder ?? []).filter((k) => DEFAULT_CLASSIC_ORDER.includes(k));
  const classicOrder: string[] = [];
  for (const key of [...planned, ...DEFAULT_CLASSIC_ORDER]) {
    if (!classicOrder.includes(key)) classicOrder.push(key);
  }
  return (
    <div className="space-y-5">
      {/* Hero: Карточка региона */}
      <RegionHero summary={data.regionSummary} />

      {/* Тип региона + фокус анализа (адаптивная композиция) */}
      <ArchetypeBanner archetype={data.regionArchetype} focusAngle={data.focusAngle} />

      {/* Ключевой тезис анализа */}
      {data.coreThesis && <CoreThesisSection thesis={data.coreThesis} />}

      {/* Выводы из фактов: цифра → следствие → решение */}
      {data.claims && data.claims.length > 0 && (
        <div id="insights" className="scroll-mt-56">
          <ClaimsSection claims={data.claims} />
        </div>
      )}

      {/* Стратегия vs факт */}
      {data.strategyRealityGap && data.strategyRealityGap.length > 0 && (
        <div id="reality-gap" className="scroll-mt-56">
          <RealityGapSection gaps={data.strategyRealityGap} />
        </div>
      )}

      {/* Классические блоки — порядок адаптируется под тип региона */}
      {classicOrder.map((key) => renderClassicSection(key, data))}

      {/* Источники */}
      <div id="sources" className="scroll-mt-56">
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} dataGaps={data.dataGaps ?? []} />
      </div>
    </div>
  );
}

function ArchetypeBanner({ archetype, focusAngle }: { archetype?: string; focusAngle?: string }) {
  if (!archetype?.trim() && !focusAngle?.trim()) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-2.5">
      {archetype?.trim() && (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/[0.12] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/20">
          <Compass className="size-3.5" /> {archetype}
        </span>
      )}
      {focusAngle?.trim() && <p className="min-w-0 flex-1 text-xs font-medium leading-snug">{focusAngle}</p>}
    </div>
  );
}

// Рендер «классического» блока по ключу. Visuals и keyPlayers идут спутниками
// бюджета и отраслей соответственно, чтобы держаться рядом со своими данными.
function renderClassicSection(key: string, data: RegionAnalysisOutput): ReactNode {
  switch (key) {
    case "budget":
      return (
        <Fragment key="budget">
          <div id="budget" className="scroll-mt-56">
            <BudgetSection landscape={data.budgetLandscape} />
          </div>
          {data.visuals && data.visuals.length > 0 && (
            <div id="visuals" className="scroll-mt-56">
              <VisualsSection visuals={data.visuals} />
            </div>
          )}
        </Fragment>
      );
    case "priorities":
      return (
        <div key="priorities" id="priorities" className="scroll-mt-56">
          <PrioritiesSection priorities={data.strategicPriorities} />
        </div>
      );
    case "scenarios":
      return (
        <div key="scenarios" id="scenarios" className="scroll-mt-56">
          <ScenariosSection scenarios={data.regionalScenarios} />
        </div>
      );
    case "industries":
      return (
        <Fragment key="industries">
          <div id="industries" className="scroll-mt-56">
            <IndustrySection items={data.industryBreakdown} />
          </div>
          {data.keyPlayers && data.keyPlayers.length > 0 && (
            <div id="key-players" className="scroll-mt-56">
              <KeyPlayersSection players={data.keyPlayers} />
            </div>
          )}
        </Fragment>
      );
    case "stakeholders":
      return (
        <div key="stakeholders" id="stakeholders" className="scroll-mt-56">
          <StakeholderSection stakeholders={data.stakeholderMap} />
        </div>
      );
    case "competition":
      return (
        <div key="competition" id="competition" className="scroll-mt-56">
          <CompetitionSection competitors={data.competitiveLandscape} />
        </div>
      );
    default:
      return null;
  }
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
      <CardContent className="p-4 sm:p-5">
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

// ── Слой «Выводы из фактов»: число → следствие → решение ─────────────────────
// Цветовая семантика направления метрики: рост/снижение/стабильно.
type DirectionTone = {
  Icon: typeof TrendingUp;
  glyph: string;
  value: string;      // цвет крупного числа
  chipBg: string;     // фон значка направления
  chipRing: string;   // обводка карточки/значка
  spine: string;      // цвет вертикальной «шины» слева
};

function directionTone(direction: RegionClaim["direction"]): DirectionTone {
  if (direction === "up") {
    return {
      Icon: TrendingUp,
      glyph: "↑",
      value: "text-emerald-600 dark:text-emerald-400",
      chipBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      chipRing: "ring-emerald-500/20",
      spine: "bg-emerald-500",
    };
  }
  if (direction === "down") {
    return {
      Icon: TrendingDown,
      glyph: "↓",
      value: "text-rose-600 dark:text-rose-400",
      chipBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      chipRing: "ring-rose-500/20",
      spine: "bg-rose-500",
    };
  }
  return {
    Icon: Minus,
    glyph: "→",
    value: "text-slate-600 dark:text-slate-300",
    chipBg: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    chipRing: "ring-slate-400/20",
    spine: "bg-slate-400",
  };
}

function confidenceLabel(confidence: RegionClaim["confidence"]): string {
  if (confidence === "high") return "высокая";
  if (confidence === "medium") return "средняя";
  if (confidence === "low") return "низкая";
  return "";
}

function confidenceBadgeClass(confidence: RegionClaim["confidence"]): string {
  if (confidence === "high") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20";
  if (confidence === "medium") return "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20";
  if (confidence === "low") return "bg-muted text-muted-foreground ring-border";
  return "bg-muted text-muted-foreground ring-border";
}

// Форматируем число компактно: большие значения через разделители, дробные — с 1 знаком.
function formatMetric(value: number): string {
  if (!Number.isInteger(value) && Math.abs(value) < 1000) return value.toFixed(1);
  return value.toLocaleString("ru-RU");
}

function ClaimsSection({ claims }: { claims: NonNullable<RegionAnalysisOutput["claims"]> }) {
  if (!claims?.length) return null;
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Zap className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Выводы из фактов</h3>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Цифра → следствие → управленческое решение
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          {claims.map((claim, idx) => (
            <ClaimCard key={claim.id} claim={claim} index={idx} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ClaimCard({ claim, index }: { claim: RegionClaim; index: number }) {
  const tone = directionTone(claim.direction);
  const DirIcon = tone.Icon;
  const hasValue = typeof claim.metricValue === "number";
  return (
    <div
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-muted/25 shadow-sm ring-1 ring-transparent transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/15 motion-reduce:transform-none animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500 motion-reduce:animate-none"
    >
      {/* Цветная «шина» слева кодирует направление метрики */}
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.spine}`} aria-hidden />
      <div className="p-3.5 pl-4 sm:p-4 sm:pl-5">
        {/* Верх: крупная метрика + значок направления + уверенность */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${tone.chipBg} ${tone.chipRing}`}>
              <DirIcon className="size-4" />
            </span>
            <div className="min-w-0">
              {hasValue ? (
                <p className={`flex items-baseline gap-1 text-2xl font-bold leading-none tracking-tight tabular-nums sm:text-[28px] ${tone.value}`}>
                  <span aria-hidden className="text-xl leading-none">{tone.glyph}</span>
                  {formatMetric(claim.metricValue as number)}
                </p>
              ) : (
                <p className={`text-lg font-bold leading-none tracking-tight ${tone.value}`}>
                  <span aria-hidden>{tone.glyph} </span>
                  {claim.metric}
                </p>
              )}
              {hasValue && (
                <p className="mt-1 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
                  {claim.metric}
                </p>
              )}
            </div>
          </div>
          {claim.confidence && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${confidenceBadgeClass(claim.confidence)}`}>
              {confidenceLabel(claim.confidence)}
            </span>
          )}
        </div>

        {/* Поток: следствие → решение. На широких экранах — в ряд со стрелкой. */}
        <div className="mt-3.5 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1.15fr] sm:gap-0">
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 sm:rounded-r-none">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Следствие</p>
            <p className="text-xs leading-snug text-muted-foreground">{claim.implication}</p>
          </div>
          <div className="flex items-center justify-center py-0.5 sm:px-1" aria-hidden>
            <span className="flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transform-none">
              <ArrowRight className="size-3.5 max-sm:rotate-90" />
            </span>
          </div>
          <div className="rounded-xl bg-primary/[0.06] px-3 py-2.5 ring-1 ring-primary/15 sm:rounded-l-none">
            <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary/80">
              <Target className="size-3" /> Решение
            </p>
            <p className="text-xs font-medium leading-snug">{claim.decision}</p>
          </div>
        </div>

        {claim.sourceUrl && (
          <a
            href={claim.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3" />
            {claim.source || "Источник"}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Слой «Стратегия vs факт»: расходящийся двусторонний визуал ───────────────
function RealityGapSection({ gaps }: { gaps: NonNullable<RegionAnalysisOutput["strategyRealityGap"]> }) {
  if (!gaps?.length) return null;
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GitCompareArrows className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Стратегия и факт</h3>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Где замысел расходится с реальностью
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          {gaps.map((gap, idx) => (
            <GapRow key={`${gap.id ?? "gap"}-${idx}`} gap={gap} index={idx} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GapRow({ gap, index }: { gap: RegionStrategyRealityGap; index: number }) {
  return (
    <div
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:shadow-md animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500 motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/25 px-4 py-2">
        <p className="text-sm font-semibold leading-snug">{gap.dimension}</p>
        {gap.gapMagnitude && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-400">
            <TriangleAlert className="size-3" />
            {gap.gapMagnitude}
          </span>
        )}
      </div>
      {/* Две расходящиеся стороны: замысел (эмеральд) ← разрыв → факт (роза) */}
      <div className="grid items-stretch sm:grid-cols-[1fr_auto_1fr]">
        <div className="border-b p-3.5 sm:border-b-0 sm:border-r">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            <Target className="size-3" /> Замысел
          </p>
          <p className="text-xs leading-snug">{gap.strategyIntent}</p>
        </div>
        {/* Мотив расхождения: две встречно направленные стрелки */}
        <div
          className="flex items-center justify-center gap-1 bg-gradient-to-b from-emerald-500/[0.05] via-amber-500/[0.06] to-rose-500/[0.05] px-3 py-1.5 sm:flex-col sm:py-3"
          aria-hidden
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ArrowRight className="size-3 rotate-180 transition-transform duration-300 group-hover:-translate-x-0.5 motion-reduce:transform-none max-sm:-rotate-90 max-sm:group-hover:-translate-y-0.5" />
          </span>
          <span className="h-4 w-px bg-border sm:h-px sm:w-4" />
          <span className="flex size-5 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <ArrowRight className="size-3 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transform-none max-sm:rotate-90 max-sm:group-hover:translate-y-0.5" />
          </span>
        </div>
        <div className="p-3.5">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            <TriangleAlert className="size-3" /> Факт
          </p>
          <p className="text-xs leading-snug">{gap.actualFact}</p>
        </div>
      </div>
      {gap.source && (
        <div className="border-t bg-muted/10 px-4 py-1.5">
          {gap.sourceUrl ? (
            <a
              href={gap.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
            >
              <ExternalLink className="size-3" />
              {gap.source}
            </a>
          ) : (
            <p className="text-[10px] text-muted-foreground">{gap.source}</p>
          )}
        </div>
      )}
    </div>
  );
}

function IndustrySection({ items }: { items: RegionAnalysisOutput["industryBreakdown"] }) {
  const rows = (items ?? [])
    .map((item) => ({ item, lims: meaningfulLimitations(item.limitations) }))
    .filter(({ item, lims }) =>
      (item.keyEnterprises?.length ?? 0) > 0 || Boolean(item.currentDigitalState?.trim()) || lims.length > 0,
    );
  if (!rows.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Building2} title="Отраслевая структура" subtitle="Опорные отрасли и их ключевые предприятия" />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {rows.map(({ item, lims }) => (
            <div key={item.id} className="flex flex-col rounded-2xl border bg-gradient-to-br from-card to-muted/20 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{item.name}</p>
                {(item.keyEnterprises?.length ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full bg-primary/[0.08] px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {item.keyEnterprises.length} орг.
                  </span>
                )}
              </div>
              {(item.keyEnterprises?.length ?? 0) > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {item.keyEnterprises.slice(0, 4).map((e, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-snug">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/40" aria-hidden />
                      <span>
                        <span className="font-medium">{e.name}</span>
                        {e.description && <span className="text-muted-foreground"> — {e.description}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {lims.length > 0 && (
                <div className="mt-auto space-y-1 border-t pt-2.5">
                  {lims.slice(0, 2).map((lim, i) => (
                    <p key={i} className="flex gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {lim}
                    </p>
                  ))}
                </div>
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
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Building2} title="Крупные организации и операторы" subtitle="Кто формирует экономику региона" count={players.length} />
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

function BudgetCompareRow({ label, value, pct, tone, unit = "млрд ₽" }: { label: string; value: number; pct: number; tone: "income" | "expense"; unit?: string }) {
  const bar = tone === "income" ? "from-emerald-500 to-emerald-400/70" : "from-rose-500 to-rose-400/70";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums">
          {value.toLocaleString("ru-RU")} <span className="text-[10px] font-medium text-muted-foreground">{unit}</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full bg-gradient-to-r ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Извлекаем числовые доходы/расходы для пропорционального бара. Приоритет — структурные
// поля totalIncomeValue/totalExpenseValue; если их нет, парсим строку totalBudget
// (детерминированный фискальный контур вида «Доходы X млрд ₽; расходы Y млрд ₽; …»).
// Числа не выдумываем: если распарсить не удалось — возвращаем undefined и остаётся текстовый фолбэк.
function extractBudgetFigures(landscape: NonNullable<RegionAnalysisOutput["budgetLandscape"]>): {
  income?: number;
  expense?: number;
  unit: string;
} {
  const defaultUnit = "млрд ₽";
  if (hasNum(landscape.totalIncomeValue) || hasNum(landscape.totalExpenseValue)) {
    return {
      income: hasNum(landscape.totalIncomeValue) ? landscape.totalIncomeValue : undefined,
      expense: hasNum(landscape.totalExpenseValue) ? landscape.totalExpenseValue : undefined,
      unit: defaultUnit,
    };
  }
  const text = landscape.totalBudget?.trim();
  if (!text) return { unit: defaultUnit };
  const income = parseRubValue(text, /доход/i);
  const expense = parseRubValue(text, /расход/i);
  return { income, expense, unit: defaultUnit };
}

// Достаёт число после ключевого слова (доход/расход), поддерживая ru-разделители
// («552,2 млрд», «1 234,5 млрд», «566 млрд»). Возвращает undefined, если не нашли.
function parseRubValue(text: string, keyword: RegExp): number | undefined {
  const anchor = text.search(keyword);
  if (anchor < 0) return undefined;
  const tail = text.slice(anchor);
  // Нормализуем разделители тысяч (пробелы, неразрывные пробелы) и берём первое
  // число с денежной единицей: «552,2 млрд ₽», «1 234,5 млрд», «566 млрд».
  const normalized = tail.replace(/[\u00a0\u202f\u2009]/g, " ");
  const match = normalized.match(/(\d[\d\s.]*?)(?:,(\d+))?\s*(?:млрд|млн|трлн|₽|руб)/i);
  if (!match) return undefined;
  const intPart = match[1].replace(/[\s.]/g, "");
  if (!intPart) return undefined;
  const num = Number(match[2] ? `${intPart}.${match[2]}` : intPart);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function BudgetSection({ landscape }: { landscape: RegionAnalysisOutput["budgetLandscape"] }) {
  if (!landscape) return null;
  const figures = extractBudgetFigures(landscape);
  const income = figures.income;
  const expense = figures.expense;
  const hasCompare = hasNum(income) && hasNum(expense);
  const deficit = hasCompare ? expense - income : undefined;
  // Строка вида «Доходы … ; расходы …» дублирует пропорциональный бар — не выводим её плоским текстом.
  const totalBudgetText = landscape.totalBudget?.trim() ?? "";
  const totalBudgetIsFiscalLine = /доход/i.test(totalBudgetText) && /расход/i.test(totalBudgetText);
  const showTotalBudgetTile = Boolean(totalBudgetText) && !(hasCompare && totalBudgetIsFiscalLine);
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Landmark} title="Бюджет и государственные программы" subtitle="Куда идут деньги региона" />
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {showTotalBudgetTile && (
            <div className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Landmark className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Общий бюджет</p>
                <p className="mt-0.5 text-lg font-bold leading-none tracking-tight">{landscape.totalBudget}</p>
              </div>
            </div>
          )}
          {hasNum(income) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Доходы</p>
                <p className="mt-0.5 text-lg font-bold leading-none tracking-tight tabular-nums">
                  {income.toLocaleString("ru-RU")}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">{figures.unit}</span>
                </p>
              </div>
            </div>
          )}
          {hasNum(deficit) && deficit > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Дефицит</p>
                <p className="mt-0.5 text-lg font-bold leading-none tracking-tight tabular-nums">
                  {deficit.toLocaleString("ru-RU")}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">{figures.unit}</span>
                </p>
              </div>
            </div>
          )}
        </div>
        {hasCompare && (() => {
          const inc = income as number;
          const exp = expense as number;
          const max = Math.max(inc, exp, 1);
          const gap = inc - exp;
          // Ширина сегмента пропорциональна значению относительно максимума из доходов/расходов.
          // Клампим только нижнюю границу, чтобы бар оставался видимым, но масштаб реально отражал соотношение.
          const incPct = Math.max(6, Math.min(100, Math.round((inc / max) * 100)));
          const expPct = Math.max(6, Math.min(100, Math.round((exp / max) * 100)));
          return (
            <div className="mb-3 rounded-xl border bg-muted/10 p-3.5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Доходы и расходы</p>
              <div className="space-y-2.5">
                <BudgetCompareRow label="Доходы" value={inc} unit={figures.unit} pct={incPct} tone="income" />
                <BudgetCompareRow label="Расходы" value={exp} unit={figures.unit} pct={expPct} tone="expense" />
              </div>
              <p className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${gap >= 0 ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/12 text-amber-700 dark:text-amber-400"}`}>
                {gap >= 0 ? "Профицит" : "Дефицит"} {Math.abs(gap).toLocaleString("ru-RU")} {figures.unit}
              </p>
            </div>
          );
        })()}
        {(() => {
          const expenses = (landscape.breakdown ?? [])
            .filter((b) => b.kind === "expense" && hasNum(b.value))
            .sort((a, b) => (b.value as number) - (a.value as number));
          if (expenses.length < 2) return null;
          const max = Math.max(...expenses.map((e) => e.value as number), 1);
          const totalExp = hasNum(landscape.totalExpenseValue) ? (landscape.totalExpenseValue as number) : undefined;
          return (
            <div className="mb-3 rounded-xl border bg-muted/10 p-3.5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Структура расходов</p>
              <div className="space-y-3">
                {expenses.map((e) => {
                  const value = e.value as number;
                  const pct = totalExp ? Math.round((value / totalExp) * 100) : undefined;
                  const barPct = totalExp
                    ? Math.max(4, Math.round((value / totalExp) * 100))
                    : Math.max(4, Math.round((value / max) * 100));
                  return (
                    <div key={e.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-xs font-medium leading-snug">{e.name}</span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {value.toLocaleString("ru-RU")} {e.unit ?? "млрд ₽"}
                          {typeof pct === "number" && (
                            <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">{pct}%</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400/70"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {landscape.keyPrograms?.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Программы и национальные проекты</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {landscape.keyPrograms.slice(0, 6).map((prog) => (
                <div key={prog.id} className="flex items-start gap-2 rounded-xl border bg-muted/10 p-2.5">
                  <Landmark className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug">{prog.name}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                      {[prog.owner, prog.budget, prog.status].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
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
  const confirmed = (priorities.confirmed ?? []).filter((x) => !isEmptyAnalysisText(x));
  const hypothesized = (priorities.hypothesized ?? []).map(cleanHypothesis).filter((x) => x.length > 12);
  const roadmap = priorities.roadmap ?? [];
  if (!confirmed.length && !hypothesized.length && !roadmap.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Target} title="Стратегические приоритеты" subtitle="Что закреплено официально и куда движется регион" />
        {confirmed.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {confirmed.map((item, i) => {
              const { title, basis } = splitBasis(item);
              return (
                <div key={i} className="flex items-start gap-2 rounded-xl border bg-emerald-500/[0.03] p-2.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug">{title}</p>
                    {basis && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{basis}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {hypothesized.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <HelpCircle className="size-3.5" /> Вероятно в приоритете, но официально не закреплено
            </p>
            <ul className="space-y-1">
              {hypothesized.slice(0, 3).map((item, i) => (
                <li key={i} className="text-xs leading-snug text-muted-foreground">• {item}</li>
              ))}
            </ul>
          </div>
        )}
        {roadmap.length > 0 && (
          <div className="mt-4 border-t pt-3.5">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Горизонт 5 лет</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {roadmap.map((item) => (
                <div key={item.id} className="rounded-xl border bg-muted/10 p-2.5">
                  <span className="inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {item.period}
                  </span>
                  <p className="mt-2 text-xs font-semibold leading-snug">{item.title}</p>
                  {item.linkedProgram && (
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{item.linkedProgram}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {priorities.source && (
          <p className="mt-3 text-[10px] leading-snug text-muted-foreground">Источник: {priorities.source}</p>
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
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Users} title="Руководители и ведомства" subtitle="Кто принимает решения в регионе" count={visible.length} />
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((s) => (
            <StakeholderCard key={s.id} stakeholder={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StakeholderCard({ stakeholder: s }: { stakeholder: RegionAnalysisOutput["stakeholderMap"][number] }) {
  const chips = [
    s.managedBudget ? { label: "Ресурс", value: s.managedBudget } : null,
    s.engagementPrinciple ? { label: "Линия", value: s.engagementPrinciple } : null,
  ].filter((x): x is { label: string; value: string } => Boolean(x));
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-shadow duration-300 hover:shadow-md">
      {/* Заголовок-баннер: крупный акцент на персоне */}
      <div className="flex items-center gap-3 border-b bg-gradient-to-br from-primary/[0.10] via-primary/[0.04] to-transparent p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-base font-bold text-primary ring-1 ring-primary/25">
          {initials(s.name)}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-tight tracking-tight">{s.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {s.role && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{s.role}</span>}
            {s.department && <span className="text-[10px] leading-snug text-muted-foreground">{s.department}</span>}
          </div>
        </div>
      </div>
      {/* Тело: сначала — что для него важно (действие для Сбера), затем факты вторым планом */}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {s.managementInterest && (
          <div className="rounded-xl bg-primary/[0.05] px-3 py-2.5 ring-1 ring-primary/10">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary/80">
              <Target className="size-3" /> Что для него важно
            </p>
            <p className="mt-1 text-xs font-medium leading-snug">{s.managementInterest}</p>
          </div>
        )}
        {s.achievements && (
          <div className="border-l-2 border-emerald-500/40 pl-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Результаты</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.achievements}</p>
          </div>
        )}
        {s.recentNews && (
          <div className="border-l-2 border-border pl-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Последние события</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.recentNews}</p>
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {chips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px] leading-snug">
                <span className="font-semibold text-foreground">{c.label}:</span>
                <span className="text-muted-foreground">{c.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScenariosSection({ scenarios }: { scenarios?: RegionAnalysisOutput["regionalScenarios"] }) {
  if (!scenarios?.length) return null;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Route} title="Сценарии развития" subtitle="Как может развиваться регион и на что смотреть" />
        <div className="grid gap-3 lg:grid-cols-2">
          {scenarios.map((scenario, idx) => (
            <ScenarioCard key={scenario.id} scenario={scenario} index={idx} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ScenarioCard({
  scenario,
  index,
}: {
  scenario: NonNullable<RegionAnalysisOutput["regionalScenarios"]>[number];
  index: number;
}) {
  const tone =
    scenario.probability === "high"
      ? { bar: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" }
      : scenario.probability === "medium"
        ? { bar: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20" }
        : { bar: "bg-slate-400", chip: "bg-muted text-muted-foreground ring-border" };
  const trigger = cleanDisplayText(scenario.trigger);
  const budget = cleanDisplayText(scenario.budgetImplication);
  const industry = cleanDisplayText(scenario.industryImpact);
  const moves = (scenario.regionMoves ?? []).map(cleanDisplayText).filter(Boolean).slice(0, 3);
  const signals = (scenario.earlySignals ?? []).map(cleanDisplayText).filter(Boolean).slice(0, 3);
  return (
    <div
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500 motion-reduce:animate-none"
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} aria-hidden />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">{scenario.title}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${tone.chip}`}>
            {probabilityLabel(scenario.probability)}
          </span>
        </div>
        {scenario.horizon && (
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{scenario.horizon}</p>
        )}
        {trigger && (
          <div className="mt-2.5 rounded-xl bg-muted/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Триггер</p>
            <p className="mt-0.5 text-xs leading-snug">{trigger}</p>
          </div>
        )}
        {(budget || industry) && (
          <div className="mt-2.5 grid gap-2">
            {budget && <ScenarioFact icon={Landmark} label="Бюджет" value={budget} />}
            {industry && <ScenarioFact icon={Building2} label="Отрасли" value={industry} />}
          </div>
        )}
        {moves.length > 0 && (
          <div className="mt-2.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ходы региона</p>
            <ul className="space-y-1">
              {moves.map((m, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-snug">
                  <ArrowRight className="mt-0.5 size-3 shrink-0 text-primary/60" /> {m}
                </li>
              ))}
            </ul>
          </div>
        )}
        {signals.length > 0 && (
          <p className="mt-auto rounded-xl bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Следить:</span> {signals.join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}

function ScenarioFact({ icon: Icon, label, value }: { icon: typeof Landmark; label: string; value: string }) {
  return (
    <div className="flex gap-2 rounded-xl border bg-muted/10 px-2.5 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug">{value}</p>
      </div>
    </div>
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

function CompetitionSection({ competitors }: { competitors: RegionAnalysisOutput["competitiveLandscape"] }) {
  const visible = (competitors ?? []).filter((item) => !isFederalInfrastructureAlternative(item));
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader icon={Building2} title="Поставщики и альтернативы" subtitle="Кто ещё работает с регионом" />
        {!visible.length ? (
          <p className="rounded-xl border border-dashed bg-muted/20 px-3 py-5 text-center text-xs leading-snug text-muted-foreground">
            Региональные поставщики не подтверждены открытыми источниками.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visible.map((c) => (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${
                      c.threatLevel === "high" ? "bg-red-500" : c.threatLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{c.vendor}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{[c.product, c.where].filter(Boolean).join(" · ")}</p>
                    {c.evidence && <p className="mt-1.5 text-[11px] leading-snug">{c.evidence}</p>}
                    {c.sberCounterPosition && (
                      <p className="mt-1 text-[11px] leading-snug text-primary">Позиция Сбера: {c.sberCounterPosition}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
