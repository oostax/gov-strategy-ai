"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Filter as FilterIcon,
  Landmark,
  Lightbulb,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Undo2,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AskLadder,
  LprDossier,
  LprTile,
  MeetingOutcome,
  MeetingOutput,
  MeetingParticipant,
  MeetingThesis,
  MinistryItem,
  MinistryPortrait,
  MinistryStat,
  NextStep,
  Objection,
  Source,
  SourceTier,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { SourcesFooter } from "./sources-footer";
import { VisualsSection } from "./visuals-section";
import { SberActionPanel } from "./sber-action-panel";
import { assessAgenda } from "@/lib/quality/meeting-output-quality";

// ── Правки готового блока кнопками (волна 8.5 + остаток) ──────────────────────

/** Виды блоков встречи, для которых доступны кнопки-правки (== kind бэкенда). */
type EditableBlockKind =
  | "ministry"
  | "dossier"
  | "participants"
  | "theses"
  | "objections"
  | "sber"
  | "agenda"
  | "after";

/** Режимы кнопочных правок (остаётся отдельно от «undo» — тот не идёт в LLM). */
type EditMode = "rebuild" | "expand" | "shorten" | "recheck";

/** Сколько миллисекунд после апдейта блока держим маркер «Обновлено». */
const UPDATE_MARKER_TTL_MS = 4000;

/**
 * Контекст правок: sessionId + колбэк обновления материала + метка последнего
 * обновлённого блока (для точечного UI-фидбека — маркер «Обновлено» и мягкий
 * скролл к секции, без перерисовки/скачка всего дашборда). Прокидывается из
 * страницы сессии. Если контекста нет (напр. предпросмотр/экспорт) — кнопки не
 * рендерятся, дашборд остаётся чисто презентационным.
 */
const MeetingEditContext = createContext<{
  sessionId?: string;
  onUpdated?: (output: TypedOutput) => void;
  /** Какой блок обновился последним и когда (Date.now()) — для маркера/скролла. */
  lastUpdate?: { kind: EditableBlockKind; at: number } | null;
  /** Сообщает дашборду, что этот блок только что обновился (для lastUpdate). */
  notifyUpdated?: (kind: EditableBlockKind) => void;
} | null>(null);

const EDIT_ACTIONS: {
  mode: EditMode;
  label: string;
  Icon: typeof RefreshCw;
  variant: "outline" | "ghost";
  // Реализовано end-to-end (true) либо помечено как TODO (false).
  ready: boolean;
}[] = [
  { mode: "rebuild", label: "Пересобрать", Icon: RefreshCw, variant: "outline", ready: true },
  { mode: "expand", label: "Расширить", Icon: Maximize2, variant: "ghost", ready: true },
  { mode: "shorten", label: "Сократить", Icon: Minimize2, variant: "ghost", ready: true },
  { mode: "recheck", label: "Перепроверить", Icon: ShieldCheck, variant: "ghost", ready: true },
];

/**
 * Компактный ряд кнопок-действий над секцией встречи. «Пересобрать/Расширить/
 * Сократить/Перепроверить» работают end-to-end: POST /api/generate/block с
 * kind этой секции, состояние загрузки, по готовности обновляет материал через
 * onUpdated. «Отменить» восстанавливает предыдущую версию блока БЕЗ вызова
 * LLM (mode="undo") — активна только когда есть версия для отмены
 * (versionsCount из ответа последней операции над этим блоком).
 */
function BlockActionsRow({ blockKind }: { blockKind: EditableBlockKind }) {
  const ctx = useContext(MeetingEditContext);
  // "instruction" — отдельная метка загрузки для чат-правки: та тоже шлёт
  // mode="rebuild" на бэкенд, но визуально должна крутить именно кнопку
  // отправки инструкции, а не общую кнопку «Пересобрать» из EDIT_ACTIONS.
  const [pending, setPending] = useState<EditMode | "undo" | "instruction" | null>(null);
  const [versionsCount, setVersionsCount] = useState(0);
  const [instruction, setInstruction] = useState("");

  // Без sessionId (нет контекста правок) кнопки не показываем.
  if (!ctx?.sessionId) return null;
  const { sessionId, onUpdated, notifyUpdated } = ctx;

  async function callBlockEndpoint(body: Record<string, unknown>) {
    const res = await fetch("/api/generate/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, blockKind, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      output?: TypedOutput;
      versionsCount?: number;
      error?: { message?: string } | string;
    };
    if (!res.ok || data.status !== "ready" || !data.output) {
      const msg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || "Не удалось обновить блок";
      throw new Error(msg);
    }
    return data;
  }

  async function runEdit(mode: EditMode) {
    if (pending) return;
    setPending(mode);
    try {
      const data = await callBlockEndpoint({ mode });
      onUpdated?.(data.output as TypedOutput);
      notifyUpdated?.(blockKind);
      if (typeof data.versionsCount === "number") setVersionsCount(data.versionsCount);
      const verb =
        mode === "expand"
          ? "расширён"
          : mode === "shorten"
            ? "сокращён"
            : mode === "recheck"
              ? "перепроверен"
              : "пересобран";
      toast.success(`Блок ${verb}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка обновления блока");
    } finally {
      setPending(null);
    }
  }

  async function runUndo() {
    if (pending) return;
    setPending("undo");
    try {
      const data = await callBlockEndpoint({ mode: "undo" });
      onUpdated?.(data.output as TypedOutput);
      notifyUpdated?.(blockKind);
      if (typeof data.versionsCount === "number") setVersionsCount(data.versionsCount);
      toast.success("Возвращена предыдущая версия блока");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Нет предыдущей версии для отмены");
    } finally {
      setPending(null);
    }
  }

  async function runInstruction() {
    const trimmed = instruction.trim();
    if (!trimmed || pending) return;
    setPending("instruction");
    try {
      const data = await callBlockEndpoint({ mode: "rebuild", instruction: trimmed });
      onUpdated?.(data.output as TypedOutput);
      notifyUpdated?.(blockKind);
      if (typeof data.versionsCount === "number") setVersionsCount(data.versionsCount);
      setInstruction("");
      toast.success("Правка применена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось применить правку");
    } finally {
      setPending(null);
    }
  }

  const disabled = pending !== null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {EDIT_ACTIONS.map(({ mode, label, Icon, variant, ready }) => {
          const isPending = pending === mode;
          return (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={variant}
              disabled={disabled}
              aria-busy={isPending}
              title={ready ? label : `${label} (скоро)`}
              onClick={() => runEdit(mode)}
            >
              {isPending ? <Loader2 className="animate-spin" /> : <Icon />}
              {label}
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || versionsCount === 0}
          aria-busy={pending === "undo"}
          title={versionsCount > 0 ? "Отменить последнюю правку блока" : "Нет предыдущей версии"}
          onClick={runUndo}
        >
          {pending === "undo" ? <Loader2 className="animate-spin" /> : <Undo2 />}
          Отменить
        </Button>
      </div>
      <div
        className="flex w-full items-center gap-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        <Input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              runInstruction();
            }
          }}
          placeholder="Уточните правку блока"
          disabled={disabled}
          maxLength={500}
          className="h-8 min-w-[220px] text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !instruction.trim()}
          aria-busy={pending === "instruction"}
          title="Применить инструкцию к блоку"
          onClick={runInstruction}
        >
          {pending === "instruction" ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Обёртка секции с рядом кнопок-правок в правом верхнем углу. Кнопки позициони-
 * руются абсолютно, чтобы не менять внутреннюю вёрстку карточек секций.
 * Точечный UI-фидбек (остаток волны 8.5): если этот блок обновился последним —
 * показывает ненавязчивый маркер «Обновлено» и мягко скроллит к секции, БЕЗ
 * перерисовки/скачка остального дашборда (сама секция не перемонтируется —
 * меняются только пропсы children, приходящие от родителя).
 */
function EditableSection({
  blockKind,
  children,
}: {
  blockKind: EditableBlockKind;
  children: ReactNode;
}) {
  const ctx = useContext(MeetingEditContext);
  const sectionRef = useRef<HTMLDivElement>(null);
  const lastUpdate = ctx?.lastUpdate;
  const isTarget = Boolean(lastUpdate && lastUpdate.kind === blockKind);
  // Явный state маркера: устанавливается ТОЛЬКО из эффекта (асинхронно, через
  // таймеры) — не при рендере (Date.now() при рендере запрещён правилами
  // чистоты компонентов) и не синхронно в теле эффекта.
  const [showMarker, setShowMarker] = useState(false);

  useEffect(() => {
    if (!isTarget) return;
    // Мягкий скролл к обновлённой секции — руководитель не теряет контекст,
    // даже если объём блока (expand/shorten) сдвинул содержимое ниже/выше.
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // setState откладываем на следующий тик — сам эффект не вызывает setState
    // синхронно в своём теле.
    const showTimer = setTimeout(() => setShowMarker(true), 0);
    const hideTimer = setTimeout(() => setShowMarker(false), UPDATE_MARKER_TTL_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [lastUpdate?.kind, lastUpdate?.at, isTarget]);

  if (!ctx?.sessionId) return <>{children}</>;
  return (
    <div ref={sectionRef} className="relative">
      {showMarker && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          <Sparkles className="size-3" /> Обновлено
        </div>
      )}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex justify-end">
        <div className="pointer-events-auto rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur">
          <BlockActionsRow blockKind={blockKind} />
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Тиерная модель честности: маленькие бейджи источника ─────────────────────
const TIER_META: Record<
  SourceTier,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  fact: {
    label: "Факт",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  hypothesis: {
    label: "Гипотеза",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: Lightbulb,
  },
  crm: {
    label: "Из CRM",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
    Icon: Database,
  },
  ask: {
    label: "Спросить",
    className: "border-dashed border-border bg-muted text-muted-foreground",
    Icon: MessageSquare,
  },
};

function TierBadge({ tier, label }: { tier: SourceTier; label?: string }) {
  const meta = TIER_META[tier] ?? TIER_META.hypothesis;
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${meta.className}`}
    >
      <Icon className="size-3" /> {label ?? meta.label}
    </span>
  );
}

function SourceChip({ source }: { source?: Source }) {
  if (!source?.title && !source?.url) return null;
  const label = source.title || (source.url ? hostOf(source.url) : "источник");
  if (!source.url) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <ExternalLink className="size-3" /> {label}
      </span>
    );
  }
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
    >
      <ExternalLink className="size-3" /> {label}
    </a>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

// Единый заголовок секции — тот же язык, что и в анализе региона.
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

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

// Порядок секций встречи по умолчанию (совпадает с id реестра material-plan).
// Используется, если у документа нет sectionOrder (старые сессии / без плана).
const DEFAULT_MEETING_ORDER = [
  "ministry",
  "dossier",
  "participants",
  "theses",
  "sber",
  "agenda",
  "objections",
  "after",
  "sources",
];

export function MeetingDashboard({
  data,
  sessionId,
  onUpdated,
}: {
  data: MeetingOutput;
  /** Сессия для правок блоков кнопками (волна 8.5). Без неё кнопки скрыты. */
  sessionId?: string;
  /** Колбэк с обновлённым материалом после правки одного блока. */
  onUpdated?: (output: TypedOutput) => void;
}) {
  // Точечный UI-фидбек после правки блока (остаток волны 8.5): какая секция
  // обновилась последней. Не влияет на данные материала — только на маркер
  // «Обновлено» и мягкий скролл внутри EditableSection этого блока.
  const [lastUpdate, setLastUpdate] = useState<{ kind: EditableBlockKind; at: number } | null>(
    null,
  );
  const notifyUpdated = (kind: EditableBlockKind) => setLastUpdate({ kind, at: Date.now() });

  const portrait = data.ministryPortrait;
  const hasPortrait =
    portrait &&
    (portrait.budgetWindow ||
      (portrait.stats?.length ?? 0) > 0 ||
      (portrait.initiatives?.length ?? 0) > 0 ||
      (portrait.incumbents?.length ?? 0) > 0);
  const dossier = data.lprDossier;
  const hasDossier =
    dossier && (dossier.known || dossier.motive || dossier.relationship || dossier.ask);
  const participants = (data.participants ?? []).filter(
    (p) => nonEmpty(p.role) && nonEmpty(p.whatMatters),
  );
  const theses = (data.theses ?? []).filter((t) => nonEmpty(t.text));
  const agenda = (data.agenda ?? []).filter((b) => nonEmpty(b.topic) || nonEmpty(b.sberSays));
  const objections = (data.objections ?? []).filter((o) => nonEmpty(o.objection));
  const hasAfter = hasAfterContent(data);

  // Секции по id реестра: рендерятся в порядке плана (data.sectionOrder), с
  // пропуском отключённых/пустых. Fallback — DEFAULT_MEETING_ORDER.
  // Каждая секция-блок обёрнута в EditableSection (ряд кнопок-правок, волна 8.5);
  // sources не блок (нет генератора) — без кнопок.
  const sectionById: Record<string, ReactNode> = {
    ministry: hasPortrait ? (
      <div key="ministry" id="ministry" className="scroll-mt-56">
        <EditableSection blockKind="ministry">
          <MinistryPortraitSection portrait={portrait} />
        </EditableSection>
      </div>
    ) : null,
    dossier: hasDossier ? (
      <div key="dossier" id="lpr" className="scroll-mt-56">
        <EditableSection blockKind="dossier">
          <LprSection dossier={dossier} />
        </EditableSection>
      </div>
    ) : null,
    participants: participants.length > 0 ? (
      <div key="participants" id="players" className="scroll-mt-56">
        <EditableSection blockKind="participants">
          <ParticipantsSection participants={participants} />
        </EditableSection>
      </div>
    ) : null,
    theses: theses.length > 0 ? (
      <div key="theses" id="theses" className="scroll-mt-56">
        <EditableSection blockKind="theses">
          <ThesesSection theses={theses} />
        </EditableSection>
      </div>
    ) : null,
    sber: (data.sberActions?.length ?? 0) > 0 ? (
      <div key="sber" id="sber-actions" className="scroll-mt-56">
        <EditableSection blockKind="sber">
          <SberActionPanel actions={data.sberActions ?? []} />
        </EditableSection>
      </div>
    ) : null,
    agenda: agenda.length > 0 ? (
      <div key="agenda" id="agenda" className="scroll-mt-56">
        <EditableSection blockKind="agenda">
          <AgendaSection agenda={agenda} />
        </EditableSection>
      </div>
    ) : null,
    objections: objections.length > 0 ? (
      <div key="objections" id="objections" className="scroll-mt-56">
        <EditableSection blockKind="objections">
          <ObjectionsSection objections={objections} />
        </EditableSection>
      </div>
    ) : null,
    after: hasAfter ? (
      <div key="after" id="follow-up" className="scroll-mt-56">
        <EditableSection blockKind="after">
          <AfterMeetingSection data={data} />
        </EditableSection>
      </div>
    ) : null,
    sources: (
      <div key="sources" id="sources" className="scroll-mt-56 space-y-3">
        <TierCounters data={data} />
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} />
      </div>
    ),
  };

  // Если план задан — рендерим ТОЛЬКО перечисленные секции в их порядке;
  // недостающие в плане (напр. sources для совместимости) дописываем в хвост.
  const planned = (data.sectionOrder ?? []).filter((k) => k in sectionById);
  const order: string[] = [];
  const push = (k: string) => {
    if (!order.includes(k)) order.push(k);
  };
  if (planned.length > 0) {
    planned.forEach(push);
    // Источники всегда показываем, даже если не были явно в плане.
    push("sources");
  } else {
    DEFAULT_MEETING_ORDER.forEach(push);
  }

  return (
    <MeetingEditContext.Provider value={{ sessionId, onUpdated, lastUpdate, notifyUpdated }}>
      <div className="space-y-5">
        {/* Hero: цель + лестница запросов + тезис/предложение/артефакт */}
        <div id="decision" className="scroll-mt-56">
          <MeetingHero data={data} />
        </div>

        {/* Легенда тиеров источников */}
        <TierLegend />

        {/* Визуалы — обрамление, вне управляемого планом порядка */}
        <div id="visuals" className="scroll-mt-56">
          <VisualsSection visuals={data.visuals ?? []} />
        </div>

        {/* Секции по плану материала (порядок + пропуск отключённых/пустых) */}
        {order.map((key) => sectionById[key]).filter(Boolean)}
      </div>
    </MeetingEditContext.Provider>
  );
}

/** Есть ли контент в блоке «После встречи» (совпадает с логикой AfterMeetingSection). */
function hasAfterContent(data: MeetingOutput): boolean {
  const after = data.afterMeeting;
  const yesSteps = after?.outcomes?.ifYes?.steps ?? data.ifYes ?? [];
  const pauseSteps = after?.outcomes?.ifPause?.steps ?? data.ifPause ?? [];
  const noSteps = after?.outcomes?.ifNo?.steps ?? data.ifNo ?? [];
  const first48h = (after?.first48h ?? []).filter((s) => nonEmpty(s.action));
  const hasSteps = [yesSteps, pauseSteps, noSteps].some(
    (steps) => steps.some((s) => nonEmpty(s.action)),
  );
  const hasTrigger = [
    after?.outcomes?.ifYes?.triggerSignal,
    after?.outcomes?.ifPause?.triggerSignal,
    after?.outcomes?.ifNo?.triggerSignal,
  ].some((t) => nonEmpty(t));
  return hasSteps || hasTrigger || first48h.length > 0;
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function MeetingHero({ data }: { data: MeetingOutput }) {
  const ladder = data.askLadder;
  const hasLadder = ladder && (nonEmpty(ladder.max) || nonEmpty(ladder.target) || nonEmpty(ladder.min));
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10 shadow-sm">
      <CardContent className="p-0">
        <div className="border-b bg-gradient-to-br from-primary/[0.03] to-transparent p-5">
          <div className="mb-2 flex items-center gap-2">
            <Target className="size-4 text-primary" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Цель встречи
            </p>
          </div>
          <p className="text-lg font-semibold leading-snug tracking-tight">{data.meetingGoal}</p>
        </div>

        {hasLadder && <AskLadderRow ladder={ladder} />}

        <div className="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MiniBlock label="Главный тезис" value={data.mainThesis} />
          <MiniBlock label="Что предлагаем" value={data.proposal} />
          <MiniBlock label="Что оставляем" value={data.leaveAfter || data.artifact} />
        </div>
      </CardContent>
    </Card>
  );
}

function AskLadderRow({ ladder }: { ladder: AskLadder }) {
  const steps: { key: string; label: string; value?: string; tone: "max" | "target" | "min"; width: string }[] = [
    { key: "max", label: "Максимум", value: ladder.max, tone: "max", width: "100%" },
    { key: "target", label: "Цель", value: ladder.target, tone: "target", width: "82%" },
    { key: "min", label: "Минимум", value: ladder.min, tone: "min", width: "64%" },
  ];
  const visible = steps.filter((s) => nonEmpty(s.value));
  if (!visible.length) return null;
  // Воронка запросов: полосы сужаются max → цель → минимум (что реально забираем).
  return (
    <div className="p-4">
      <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <FilterIcon className="size-3" /> Воронка запросов — от амбиции к тому, что забираем точно
      </p>
      <div className="space-y-1.5">
        {visible.map((s, idx) => {
          const tone =
            s.tone === "max"
              ? { bar: "border-emerald-500/30 bg-emerald-500/[0.07]", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }
              : s.tone === "min"
                ? { bar: "border-amber-500/30 bg-amber-500/[0.07]", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
                : { bar: "border-primary/25 bg-primary/[0.05]", badge: "bg-primary/10 text-primary" };
          return (
            <div key={s.key} className="mx-auto transition-all" style={{ width: s.width }}>
              <div className={`rounded-xl border ${tone.bar} px-3 py-2.5`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}>
                    {s.label}
                  </span>
                  {idx === visible.length - 1 && (
                    <span className="text-[10px] font-medium text-muted-foreground">заберём даже при осторожном ЛПР</span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] font-medium leading-snug">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniBlock({ label, value }: { label: string; value: string }) {
  if (!nonEmpty(value)) return null;
  return (
    <div className="p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm leading-snug">{value}</p>
    </div>
  );
}

// ── Легенда тиеров ────────────────────────────────────────────────────────────
function TierLegend() {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-wrap items-center gap-x-3.5 gap-y-2 p-3.5">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Каждый факт помечен источником:
        </span>
        <TierBadge tier="fact" label="Факт · источник" />
        <TierBadge tier="hypothesis" />
        <TierBadge tier="crm" label="Из карточки региона / CRM" />
        <TierBadge tier="ask" label="Спросить на встрече" />
      </CardContent>
    </Card>
  );
}

// ── ЯДРО: Портрет ведомства и повестки ────────────────────────────────────────
function MinistryPortraitSection({ portrait }: { portrait: MinistryPortrait }) {
  const stats = (portrait.stats ?? []).filter((s) => nonEmpty(s.value) || nonEmpty(s.label));
  const initiatives = (portrait.initiatives ?? []).filter((i) => nonEmpty(i.title));
  const incumbents = (portrait.incumbents ?? []).filter((i) => nonEmpty(i.title));
  const bw = portrait.budgetWindow;
  const hasBudget = bw && (nonEmpty(bw.signal) || nonEmpty(bw.tension) || nonEmpty(bw.decision));
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={Landmark}
          title="Портрет ведомства и повестки"
          subtitle="Ядро · факты из открытых источников"
        />

        {hasBudget && <BudgetWindowBlock window={bw} />}

        {stats.length > 0 && (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((stat, idx) => (
              <StatCard key={stat.id ?? idx} stat={stat} />
            ))}
          </div>
        )}

        {(initiatives.length > 0 || incumbents.length > 0) && (
          <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
            {initiatives.length > 0 && (
              <MinistryItemList
                title="Что они уже делают (зацепки)"
                items={initiatives}
                accent="primary"
              />
            )}
            {incumbents.length > 0 && (
              <MinistryItemList
                title="Что уже внедрено = конкуренты / точки интеграции"
                items={incumbents}
                accent="amber"
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetWindowBlock({ window: bw }: { window: NonNullable<MinistryPortrait["budgetWindow"]> }) {
  const sources = (bw.sources ?? []).filter((s) => s.url || s.title);
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b bg-muted/25 px-3.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Бюджетное окно
        </p>
        <TierBadge tier="fact" />
      </div>
      {/* 3-колоночный блок «сигнал / напряжение / вывод» — как в анализе региона */}
      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <WindowCell label="Сигнал" value={bw.signal} />
        <WindowCell label="Напряжение" value={bw.tension} tone="warn" />
        <WindowCell label="Вывод для встречи" value={bw.decision} tone="primary" />
      </div>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t bg-muted/10 px-3.5 py-2">
          {sources.map((s, i) => (
            <SourceChip key={i} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function WindowCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "primary";
}) {
  if (!nonEmpty(value)) return null;
  const toneClass =
    tone === "primary"
      ? "bg-primary/[0.04]"
      : tone === "warn"
        ? "bg-amber-500/[0.05]"
        : "bg-transparent";
  return (
    <div className={`p-3.5 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs leading-relaxed">{value}</p>
    </div>
  );
}

function StatCard({ stat }: { stat: MinistryStat }) {
  const warn = stat.tier === "fact" && /дефицит|риск|нагрузк/i.test(`${stat.label} ${stat.caption}`);
  return (
    <div className={`rounded-xl border p-3.5 ${warn ? "border-amber-500/25 bg-amber-500/[0.05]" : "bg-muted/15"}`}>
      <p className={`text-xl font-bold leading-tight tracking-tight ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {stat.value}
      </p>
      {nonEmpty(stat.label) && (
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {stat.label}
        </p>
      )}
      {nonEmpty(stat.caption) && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{stat.caption}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <TierBadge tier={stat.tier} />
        <SourceChip source={stat.source} />
      </div>
    </div>
  );
}

function MinistryItemList({
  title,
  items,
  accent,
}: {
  title: string;
  items: MinistryItem[];
  accent: "primary" | "amber";
}) {
  return (
    <div className="rounded-xl border bg-muted/10 p-3.5">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-2.5">
        {items.map((item, idx) => (
          <div key={item.id ?? idx} className="flex gap-2">
            <span
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                accent === "amber" ? "bg-amber-500/60" : "bg-primary/50"
              }`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-xs leading-snug">
                <span className="font-semibold">{item.title}</span>
                {nonEmpty(item.detail) && <span className="text-muted-foreground"> — {item.detail}</span>}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <TierBadge tier={item.tier} />
                <SourceChip source={item.source} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ЛПР: тиерный слой ─────────────────────────────────────────────────────────
function LprSection({ dossier }: { dossier: LprDossier }) {
  const tiles: { label: string; tile?: LprTile }[] = [
    { label: "Известно", tile: dossier.known },
    { label: "Мотив / зона решений", tile: dossier.motive },
    { label: "Отношение к Сберу", tile: dossier.relationship },
    { label: "Добрать на встрече", tile: dossier.ask },
  ];
  const visible = tiles.filter((t) => t.tile && nonEmpty(t.tile.text));
  return (
    <Card className="overflow-hidden rounded-2xl border-primary/10">
      <CardContent className="p-0">
        <div className="flex items-center gap-3.5 border-b bg-gradient-to-br from-primary/[0.06] to-transparent p-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-base font-bold text-primary ring-1 ring-primary/25">
            {initials(dossier.name) || <User className="size-5" />}
          </span>
          <div className="min-w-0">
            {nonEmpty(dossier.name) ? (
              <p className="text-[15px] font-bold leading-tight tracking-tight">{dossier.name}</p>
            ) : (
              <p className="text-[15px] font-bold leading-tight tracking-tight text-muted-foreground">
                ЛПР · уточнить ФИО
              </p>
            )}
            {nonEmpty(dossier.role) && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{dossier.role}</p>
            )}
          </div>
        </div>
        <div className="p-4">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {visible.map((t) => (
              <LprTileCard key={t.label} label={t.label} tile={t.tile as LprTile} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LprTileCard({ label, tile }: { label: string; tile: LprTile }) {
  const bg =
    tile.tier === "crm"
      ? "border-violet-500/25 bg-violet-500/[0.05]"
      : tile.tier === "ask"
        ? "border-dashed bg-muted/20"
        : "bg-muted/15";
  return (
    <div className={`flex flex-col rounded-xl border p-3 ${bg}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <TierBadge tier={tile.tier} />
      </div>
      <p className="text-xs leading-snug">{tile.text}</p>
      {tile.source && (
        <div className="mt-2">
          <SourceChip source={tile.source} />
        </div>
      )}
    </div>
  );
}

// ── Карта участников ──────────────────────────────────────────────────────────
const STANCE_META: Record<
  MeetingParticipant["stance"],
  { label: string; dot: string }
> = {
  ally: { label: "союзник", dot: "bg-emerald-500" },
  skeptic: { label: "скептик", dot: "bg-rose-500" },
  neutral: { label: "нейтрал", dot: "bg-slate-400" },
};

/** Влияние участника выводим структурно из роли (не выдуманный факт, а эвристика
 * по типу должности): первые лица и держатели ресурса — высокое, прочие — среднее. */
function participantInfluence(p: MeetingParticipant): "high" | "mid" {
  const r = `${p.role} ${p.name ?? ""}`.toLowerCase();
  if (/лпр|министр|губернатор|глава|руководител|директор|первое лицо|держател|бюджет|техпривратник|курат/.test(r)) {
    return "high";
  }
  return "mid";
}

function ParticipantMatrix({ participants }: { participants: MeetingParticipant[] }) {
  const cols: MeetingParticipant["stance"][] = ["skeptic", "neutral", "ally"];
  const rows: Array<{ key: "high" | "mid"; label: string }> = [
    { key: "high", label: "Высокое влияние" },
    { key: "mid", label: "Среднее влияние" },
  ];
  const cell = (inf: "high" | "mid", stance: MeetingParticipant["stance"]) =>
    participants.filter((p) => participantInfluence(p) === inf && p.stance === stance);
  return (
    <div className="mb-4 overflow-hidden rounded-xl border">
      {/* Заголовки колонок: позиция */}
      <div className="grid grid-cols-[92px_repeat(3,1fr)] border-b bg-muted/25 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div className="px-2 py-1.5">Влияние ↓ / Позиция →</div>
        {cols.map((c) => (
          <div key={c} className="flex items-center gap-1.5 border-l px-2 py-1.5">
            <span className={`size-2 rounded-full ${STANCE_META[c].dot}`} aria-hidden />
            {STANCE_META[c].label}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[92px_repeat(3,1fr)] border-b last:border-b-0">
          <div className="flex items-center bg-muted/15 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {row.label}
          </div>
          {cols.map((c) => {
            const people = cell(row.key, c);
            return (
              <div key={c} className="min-h-[52px] space-y-1 border-l p-1.5">
                {people.map((p, i) => (
                  <div
                    key={p.id ?? i}
                    className="rounded-md border bg-card px-1.5 py-1 text-[11px] font-medium leading-tight"
                    title={p.whatMatters}
                  >
                    {nonEmpty(p.name) ? p.name : p.role}
                    {nonEmpty(p.name) && (
                      <span className="block text-[9.5px] font-normal text-muted-foreground">{p.role}</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ParticipantsSection({ participants }: { participants: MeetingParticipant[] }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={Users}
          title="Карта участников встречи"
          subtitle="Матрица влияние × позиция + детали по каждому"
          count={participants.length}
        />
        <ParticipantMatrix participants={participants} />
        <div className="grid gap-2.5 lg:grid-cols-3">
          {participants.map((p, idx) => {
            const stance = STANCE_META[p.stance] ?? STANCE_META.neutral;
            return (
              <div key={p.id ?? idx} className="rounded-xl border p-3.5">
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${stance.dot}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight">
                      {nonEmpty(p.name) ? p.name : p.role}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {nonEmpty(p.name) ? `${p.role} · ${stance.label}` : stance.label}
                    </p>
                  </div>
                  <TierBadge tier={p.tier} />
                </div>
                <p className="mt-2 text-xs leading-snug">{p.whatMatters}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Тезисы под повестку ЛПР ───────────────────────────────────────────────────
function ThesesSection({ theses }: { theses: MeetingThesis[] }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={Lightbulb}
          title="Тезисы под повестку ЛПР"
          subtitle="Каждый привязан к конкретному факту"
          count={theses.length}
        />
        <div className="grid gap-2.5 lg:grid-cols-3">
          {theses.map((thesis, idx) => (
            <div key={thesis.id ?? idx} className="flex flex-col rounded-xl border border-l-[3px] border-l-primary p-3.5">
              <p className="text-[13px] font-semibold leading-snug">{thesis.text}</p>
              {nonEmpty(thesis.tiedTo) && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Target className="mt-0.5 size-3 shrink-0" /> Привязан к: {thesis.tiedTo}
                </p>
              )}
              {nonEmpty(thesis.evidence) && (
                <p className="mt-2 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                  {thesis.evidence}
                </p>
              )}
              <div className="mt-2">
                <TierBadge tier={thesis.tier} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Сценарий встречи ──────────────────────────────────────────────────────────
function AgendaSection({ agenda }: { agenda: MeetingOutput["agenda"] }) {
  const quality = assessAgenda(agenda);
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={Clock}
          title="Сценарий встречи"
          subtitle={quality.ready
            ? "Блоки по времени · обязательные поля заполнены"
            : `Заполнено ${quality.complete} из ${quality.total} · требуется пересборка`}
          count={agenda.length}
        />
        {/* Mobile: каждый блок — вертикальная карточка (без обрезки по ширине).
            sm+/lg+: табличный грид с колонками, как раньше. */}
        <div className="overflow-hidden rounded-xl border">
          {agenda.map((block, idx) => (
            <div
              key={block.id ?? idx}
              className={`flex flex-col sm:grid sm:grid-cols-[84px_1.3fr_1.3fr_1.3fr_1fr] ${idx > 0 ? "border-t" : ""}`}
            >
              <div className="border-b p-3 sm:border-r sm:border-b-0">
                <Badge variant="secondary" className="font-mono text-[11px]">
                  {block.time}
                </Badge>
              </div>
              <AgendaCell label="Тема" value={block.topic} />
              <AgendaCell label="Сбер говорит" value={block.sberSays} />
              <AgendaCell label="Спрашиваем ЛПР" value={block.askLpr} />
              <AgendaCell label="Фиксируем" value={block.fixDecision} fix last />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AgendaCell({
  label,
  value,
  fix,
  last,
}: {
  label: string;
  value: string;
  fix?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`p-3 sm:border-r sm:border-b-0 ${last ? "sm:border-r-0" : "border-b sm:border-b-0"} ${fix ? "bg-primary/[0.04]" : ""}`}
    >
      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${fix ? "text-primary/80" : "text-muted-foreground"}`}>
        {label}
      </p>
      <p className={`text-xs leading-snug ${fix ? "font-medium" : ""}`}>{nonEmpty(value) ? value : "—"}</p>
    </div>
  );
}

// ── Возражения (углублённые) ──────────────────────────────────────────────────
function ObjectionsSection({ objections }: { objections: Objection[] }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={MessageSquare}
          title="Возражения и как снимать"
          subtitle="Возражение → истинная причина → ответ → факт → запасной ход"
          count={objections.length}
        />
        <div className="grid gap-2.5 lg:grid-cols-2">
          {objections.map((obj, idx) => (
            <ObjectionCard key={obj.id ?? idx} objection={obj} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectionCard({ objection: obj }: { objection: Objection }) {
  return (
    <div className="flex flex-col rounded-xl border p-3.5">
      <p className="text-[13px] font-semibold leading-snug text-rose-600 dark:text-rose-400">
        «{obj.objection}»
      </p>
      {nonEmpty(obj.trueReason) && (
        <div className="mt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Истинная причина</p>
          <p className="mt-0.5 text-xs leading-snug">{obj.trueReason}</p>
        </div>
      )}
      {nonEmpty(obj.response) && (
        <div className="mt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ответ</p>
          <p className="mt-0.5 text-xs leading-snug">{obj.response}</p>
        </div>
      )}
      {(nonEmpty(obj.factNeeded) || nonEmpty(obj.fallback)) && (
        <div className="mt-2.5 space-y-1 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] leading-snug">
          {nonEmpty(obj.factNeeded) && (
            <p>
              <span className="font-semibold">Нужен факт:</span> {obj.factNeeded}
            </p>
          )}
          {nonEmpty(obj.fallback) && (
            <p>
              <span className="font-semibold">Запасной ход:</span> {obj.fallback}
            </p>
          )}
        </div>
      )}
      {(obj.tier || obj.specific) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {obj.tier && <TierBadge tier={obj.tier} />}
          {obj.specific && (
            <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
              <User className="size-3" /> Специфично ЛПР
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── После встречи ─────────────────────────────────────────────────────────────
function AfterMeetingSection({ data }: { data: MeetingOutput }) {
  const after = data.afterMeeting;
  // Совместимость: если новых outcomes нет — строим из плоских ifYes/ifPause/ifNo.
  const yesSteps = after?.outcomes?.ifYes?.steps ?? data.ifYes ?? [];
  const pauseSteps = after?.outcomes?.ifPause?.steps ?? data.ifPause ?? [];
  const noSteps = after?.outcomes?.ifNo?.steps ?? data.ifNo ?? [];
  const first48h = (after?.first48h ?? []).filter((s) => nonEmpty(s.action));

  const outcomes: {
    title: string;
    icon: ReactNode;
    tone: string;
    outcome?: MeetingOutcome;
    steps: NextStep[];
  }[] = [
    {
      title: "Если согласились",
      icon: <CheckCircle2 className="size-4 text-emerald-600" />,
      tone: "border-emerald-500/30",
      outcome: after?.outcomes?.ifYes,
      steps: yesSteps,
    },
    {
      title: "Если взяли паузу",
      icon: <Pause className="size-4 text-amber-600" />,
      tone: "border-amber-500/30",
      outcome: after?.outcomes?.ifPause,
      steps: pauseSteps,
    },
    {
      title: "Если отказали",
      icon: <XCircle className="size-4 text-rose-600" />,
      tone: "border-rose-500/30",
      outcome: after?.outcomes?.ifNo,
      steps: noSteps,
    },
  ];

  const hasAny = outcomes.some((o) => o.steps.length > 0 || nonEmpty(o.outcome?.triggerSignal)) || first48h.length > 0;
  if (!hasAny) return null;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <SectionHeader
          icon={ArrowRight}
          title="После встречи"
          subtitle="Триггер исхода · шаги · что зафиксировать · первые 48 часов"
        />
        <div className="grid gap-2.5 md:grid-cols-3">
          {outcomes.map((o) => (
            <OutcomeCard key={o.title} title={o.title} icon={o.icon} tone={o.tone} outcome={o.outcome} steps={o.steps} />
          ))}
        </div>
        {first48h.length > 0 && (
          <div className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.03] p-3.5">
            <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
              <Clock className="size-3.5" /> Первые 48 часов
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {first48h.map((step, idx) => (
                <StepItem key={step.id ?? idx} step={step} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeCard({
  title,
  icon,
  tone,
  outcome,
  steps,
}: {
  title: string;
  icon: ReactNode;
  tone: string;
  outcome?: MeetingOutcome;
  steps: NextStep[];
}) {
  const filledSteps = steps.filter((s) => nonEmpty(s.action));
  return (
    <div className={`flex flex-col rounded-xl border-2 p-3.5 ${tone}`}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-[13px] font-semibold">{title}</p>
      </div>
      {nonEmpty(outcome?.triggerSignal) && (
        <div className="mb-2.5 rounded-lg bg-muted/40 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Как понять</p>
          <p className="mt-0.5 text-[11px] leading-snug">{outcome?.triggerSignal}</p>
        </div>
      )}
      {filledSteps.length > 0 ? (
        <div className="space-y-2">
          {filledSteps.map((step, idx) => (
            <StepItem key={step.id ?? idx} step={step} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Шаги уточняются</p>
      )}
      {nonEmpty(outcome?.whatToCapture) && (
        <div className="mt-2.5 flex items-start gap-1.5 border-t pt-2.5 text-[11px] leading-snug text-muted-foreground">
          <Bookmark className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-semibold text-foreground">Зафиксировать:</span> {outcome?.whatToCapture}
          </span>
        </div>
      )}
    </div>
  );
}

function StepItem({ step }: { step: NextStep }) {
  return (
    <div className="rounded-lg bg-muted/30 px-2.5 py-2">
      <p className="text-xs font-medium leading-snug">{step.action}</p>
      <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
        {nonEmpty(step.owner) && (
          <span className="inline-flex items-center gap-0.5">
            <User className="size-2.5" /> {step.owner}
          </span>
        )}
        {nonEmpty(step.deadline) && (
          <span className="inline-flex items-center gap-0.5">
            <CalendarDays className="size-2.5" /> {step.deadline}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Счётчики по тиерам ────────────────────────────────────────────────────────
function TierCounters({ data }: { data: MeetingOutput }) {
  const counts: Record<SourceTier, number> = { fact: 0, hypothesis: 0, crm: 0, ask: 0 };
  const bump = (tier?: SourceTier) => {
    if (tier && tier in counts) counts[tier] += 1;
  };

  const portrait = data.ministryPortrait;
  portrait?.stats?.forEach((s) => bump(s.tier));
  portrait?.initiatives?.forEach((i) => bump(i.tier));
  portrait?.incumbents?.forEach((i) => bump(i.tier));
  if (portrait?.budgetWindow) counts.fact += 1;

  const dossier = data.lprDossier;
  [dossier?.known, dossier?.motive, dossier?.relationship, dossier?.ask].forEach((t) => bump(t?.tier));

  data.participants?.forEach((p) => bump(p.tier));
  data.theses?.forEach((t) => bump(t.tier));
  data.objections?.forEach((o) => bump(o.tier));

  const total = counts.fact + counts.hypothesis + counts.crm + counts.ask;
  if (total === 0) return null;

  const order: { tier: SourceTier; label: (n: number) => string }[] = [
    { tier: "fact", label: (n) => `Факт · со ссылкой: ${n}` },
    { tier: "hypothesis", label: (n) => `Гипотеза: ${n}` },
    { tier: "crm", label: (n) => `Из CRM: ${n}` },
    { tier: "ask", label: (n) => `Спросить: ${n}` },
  ];

  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-wrap items-center gap-2 p-3.5">
        <span className="mr-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <BadgeCheck className="size-3.5" /> Баланс источников:
        </span>
        {order
          .filter((o) => counts[o.tier] > 0)
          .map((o) => (
            <TierBadge key={o.tier} tier={o.tier} label={o.label(counts[o.tier])} />
          ))}
      </CardContent>
    </Card>
  );
}
