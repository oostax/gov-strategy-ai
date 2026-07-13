"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  GaugeCircle,
  GripVertical,
  Lightbulb,
  Loader2,
  Map as MapIcon,
  MapPin,
  Mic,
  Pencil,
  Send,
  Sparkles,
  Square,
  Target,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  taskFocusPlaceholder,
  taskLabels,
  taskOutputDescription,
  taskWhenToUse,
  type CreateSessionInput,
  type DetailLevel,
  type TaskType,
  type UrgencyLevel,
} from "@/lib/schemas/session";
import {
  blocksForTask,
  defaultEnabledIds,
  VOLUME_LABEL,
  type MaterialBlock,
} from "@/lib/schemas/material-plan";
import { cn } from "@/lib/utils";
import { searchRegions } from "@/lib/data/russian-regions";
import { getStepsForTask, useSessionForm } from "@/components/session/use-session-form";
import { useRegions } from "@/components/session/use-regions";
import { useVoiceInput } from "@/components/session/use-voice-input";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";

const taskIcon: Record<TaskType, React.ComponentType<{ className?: string }>> = {
  meeting_preparation: UsersRound,
  meeting_followup: ClipboardCheck,
  executive_brief: BriefcaseBusiness,
  sber_region_strategy: Building2,
  region_strategy: MapIcon,
  strategic_bets: Target,
  scenario_analysis: BarChart3,
};

const taskOrder: TaskType[] = [
  "meeting_preparation",
  "meeting_followup",
  "executive_brief",
  "sber_region_strategy",
  "region_strategy",
  "strategic_bets",
  "scenario_analysis",
];

/** Человекочитаемые метки полей для сообщений о невалидной форме. */
const FIELD_LABELS: Record<string, string> = {
  userRole: "роль",
  taskType: "тип материала",
  audience: "аудитория результата",
  horizon: "горизонт",
  region: "регион",
  focusTopic: "задача (что подготовить)",
  detailLevel: "объём",
  outputFormat: "формат",
  urgency: "срочность",
  deliveryFormat: "формат доставки",
};

/**
 * onInvalid для form.handleSubmit: без него провал zod-валидации молча гасит
 * сабмит — «кнопка ничего не делает». Показываем, какое поле мешает сборке.
 */
function reportInvalidPlan(errors: Record<string, { message?: string } | undefined>) {
  const keys = Object.keys(errors);
  if (keys.length === 0) {
    toast.error("Не удалось собрать материал — проверьте заполнение формы.");
    return;
  }
  const first = keys[0];
  const label = FIELD_LABELS[first] ?? first;
  const message = errors[first]?.message;
  toast.error(`Не удалось собрать: проверьте «${label}»${message ? ` — ${message}` : ""}.`);
}

// ── Точка входа: переключатель «диалог / ручная форма» ──────────────────────

export default function NewSessionPage() {
  const [mode, setMode] = useState<"chat" | "form">("chat");
  const session = useSessionForm();

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        {mode === "chat" ? (
          <ChatFlow session={session} onManual={() => setMode("form")} />
        ) : (
          <StepForm session={session} onChat={() => setMode("chat")} />
        )}
      </div>
    </AppShell>
  );
}

type SessionApi = ReturnType<typeof useSessionForm>;

// ── Диалоговый режим ─────────────────────────────────────────────────────────

/**
 * Контекстный уточняющий вопрос, сгенерированный ИИ-классификатором под
 * конкретный бриф. Приходит из /api/sessions/classify (suggestion.clarifications).
 * `options` — 2-4 готовых варианта (быстрые кнопки); если их нет — свободный ввод.
 */
type Clarification = { question: string; options?: string[] };

/**
 * Фазы потока. «План материала» — не отдельная фаза, а состояние `clarify`,
 * в котором динамические вопросы исчерпаны (clarifyIndex >= clarifications.length).
 * Так мы избегаем синхронного setState в эффекте: фаза плана выводится, а не хранится.
 */
type Phase = "brief" | "recognizing" | "clarify";

/** Реплика в ленте — вопрос ассистента (закрытый) или ответ пользователя. */
type Turn =
  | { role: "assistant"; text: string }
  | { role: "user"; text: string };

// ── Интерактивный план материала: состояние (порядок + вкл/выкл + объём) ─────

/**
 * Состояние «Плана материала»: единый источник для UI и submit.
 *  - `order` — ВСЕ id блоков типа в текущем (перетаскиваемом) порядке;
 *  - `enabled` — множество включённых id (core всегда включены);
 *  - `volume` — объём (синхронизирован с detailLevel формы).
 * При смене типа задачи — сброс к дефолту типа. При смене объёма —
 * пересчёт включённости НЕ-core блоков (порядок пользователя сохраняется).
 */
type PlanState = {
  taskType: TaskType;
  order: string[];
  enabled: Set<string>;
  volume: DetailLevel;
};

function defaultPlanState(taskType: TaskType, volume: DetailLevel): PlanState {
  return {
    taskType,
    order: blocksForTask(taskType).map((block) => block.id),
    enabled: new Set(defaultEnabledIds(taskType, volume)),
    volume,
  };
}

function normalizePlanState(
  state: PlanState,
  taskType: TaskType,
  volume: DetailLevel,
): PlanState {
  if (state.taskType !== taskType) return defaultPlanState(taskType, volume);
  if (state.volume === volume) return state;
  return {
    ...state,
    volume,
    enabled: new Set(defaultEnabledIds(taskType, volume)),
  };
}

function useMaterialPlan(taskType: TaskType, volume: DetailLevel) {
  const [storedState, setState] = useState<PlanState>(() => defaultPlanState(taskType, volume));
  // Смена типа/объёма выводится чисто во время render. Реальное состояние
  // фиксируется при следующем пользовательском действии без каскадного effect.
  const state = normalizePlanState(storedState, taskType, volume);

  const toggle = useCallback(
    (block: MaterialBlock) => {
      if (block.core) return; // core-блоки нельзя выключить
      setState((prev) => {
        const base = normalizePlanState(prev, taskType, volume);
        const enabled = new Set(base.enabled);
        if (enabled.has(block.id)) enabled.delete(block.id);
        else enabled.add(block.id);
        return { ...base, enabled };
      });
    },
    [taskType, volume],
  );

  // Перестановка: перемещает блок с позиции from на позицию to (drag&drop).
  const move = useCallback((from: number, to: number) => {
    setState((prev) => {
      const base = normalizePlanState(prev, taskType, volume);
      if (from === to || from < 0 || to < 0) return base;
      const order = [...base.order];
      if (from >= order.length || to >= order.length) return base;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...base, order };
    });
  }, [taskType, volume]);

  /** Итог для submit: включённые id в текущем порядке. */
  const enabledOrdered = state.order.filter((id) => state.enabled.has(id));

  return { state, toggle, move, enabledOrdered };
}

/**
 * Честная готовность данных: считаем из известного (заполнен ли профиль региона
 * в БД, известен ли ЛПР для встречи, задан ли фокус). Возвращает % и причины.
 */
function computeReadiness(input: {
  isMeeting: boolean;
  hasRegion: boolean;
  hasRegionProfile: boolean;
  hasMeetingWith: boolean;
  hasMeetingGoal: boolean;
  hasMeetingContext: boolean;
  hasFocus: boolean;
  urgency: UrgencyLevel;
}): { percent: number; reasons: string[]; tone: "low" | "mid" | "high" } {
  const {
    isMeeting,
    hasRegion,
    hasRegionProfile,
    hasMeetingWith,
    hasMeetingGoal,
    hasMeetingContext,
    hasFocus,
    urgency,
  } = input;
  // Вес каждого балла связан с реальным входом. Никакой стартовой «готовности 40%»:
  // единственные базовые 10% — возможность собрать открытые источники.
  let score = 10;
  const reasons: string[] = [];

  if (hasFocus) score += 20;
  else reasons.push("не задан фокус материала");

  if (hasRegion) score += 10;
  else reasons.push("не указан регион");

  if (hasRegionProfile) score += 25;
  else if (hasRegion) reasons.push("нет подтверждённой карточки региона");

  if (isMeeting) {
    if (hasMeetingWith) score += 10;
    else reasons.push("не определён ЛПР или его роль");
    if (hasMeetingGoal) score += 15;
    else reasons.push("не зафиксирован целевой исход встречи");
    if (hasMeetingContext) score += 10;
    else reasons.push("нет истории взаимодействия или исходной базы");
  } else {
    score += 35;
  }

  if (urgency === "2_hours") reasons.push("срок сжатый — 2 часа");
  else if (urgency === "today") reasons.push("срок сжатый — сегодня");

  const percent = Math.max(0, Math.min(100, score));
  const tone = percent >= 80 ? "high" : percent >= 55 ? "mid" : "low";
  return { percent, reasons: reasons.slice(0, 4), tone };
}

/**
 * Угол подачи — краткая строка из фокуса/типа/срочности. Простое правило,
 * без выдумывания фактов: описывает, как система будет подавать материал.
 */
function computeAngle(input: {
  taskType: TaskType;
  isMeeting: boolean;
  hasRegionProfile: boolean;
  hasRegion: boolean;
  urgency: UrgencyLevel;
}): string {
  const { taskType, isMeeting, hasRegionProfile, hasRegion, urgency } = input;
  const tight = urgency === "2_hours" || urgency === "today";
  if (isMeeting) {
    if (tight) return "Сжатый сценарий: тезисы и ключевые решения без углублённого разбора";
    return "От повестки ЛПР: тезисы, привязанные к его задачам и фактам";
  }
  if (taskType === "region_strategy" || taskType === "sber_region_strategy") {
    if (hasRegion && !hasRegionProfile)
      return "Аналитический срез из открытых источников: спорные места помечаются гипотезами";
    return "Аналитический срез: отрасли, бюджет и приоритеты региона на 5 лет";
  }
  if (taskType === "executive_brief") return "Одна страница: позиция → обоснование → решение для ВП";
  if (taskType === "strategic_bets") return "Выбор направления: ставки с матрицей эффект × реализуемость";
  if (taskType === "scenario_analysis") return "Сценарии и позиция Сбера в каждом при смене условий";
  return "От управленческого решения к доказательствам";
}

export function ChatFlow({
  session,
  onManual,
}: {
  session: SessionApi;
  onManual: () => void;
}) {
  const {
    form,
    loading,
    taskType,
    detailLevel,
    urgency,
    region,
    regionId,
    isMeeting,
    submit,
    applySuggestion,
  } = session;

  const { regions } = useRegions();

  const [phase, setPhase] = useState<Phase>("brief");
  const [briefText, setBriefText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  // Динамические уточнения от ИИ и указатель на текущий вопрос.
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [clarifyIndex, setClarifyIndex] = useState(0);
  const [recognized, setRecognized] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const voice = useVoiceInput((transcript) => {
    // Голос дописывается в активное поле ввода — бриф либо текущий ответ.
    if (phase === "brief") {
      setBriefText((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript));
    } else {
      setAnswerText((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript));
    }
  });

  // Текущий уточняющий вопрос — из динамического списка ИИ, по указателю.
  const currentClarification =
    phase === "clarify" && clarifyIndex < clarifications.length
      ? clarifications[clarifyIndex]
      : null;

  // «План материала» — производное состояние, а не отдельная фаза: показываем,
  // когда динамические вопросы исчерпаны. Это исключает setState в эффекте.
  const atPlan = phase === "clarify" && clarifyIndex >= clarifications.length;

  // Автоскролл ленты вниз при изменениях.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, phase, clarifyIndex, recognized]);

  const selectedRegionProfile = regions.find((r) => r.id === regionId || r.name === region);
  const emptyRegionCard = Boolean(region) && !selectedRegionProfile;

  // Интерактивный план материала (порядок + вкл/выкл + объём). Объём тянется
  // из detailLevel формы — единый контрол живёт внутри карточки плана.
  const plan = useMaterialPlan(taskType, detailLevel);

  // Собирает materialPlan из текущего состояния плана и кладёт в форму ДО отправки.
  const submitWithPlan = useCallback(() => {
    form.setValue(
      "materialPlan",
      { blocks: plan.enabledOrdered, volume: plan.state.volume },
      { shouldValidate: false },
    );
    return form.handleSubmit(submit, reportInvalidPlan)();
  }, [form, plan.enabledOrdered, plan.state.volume, submit]);

  async function handleBrief() {
    const phrase = briefText.trim();
    if (phrase.length < 3) return;
    setTurns((prev) => [...prev, { role: "user", text: phrase }]);
    setPhase("recognizing");
    try {
      const response = await fetch("/api/sessions/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const data = (await response.json()) as {
        suggestion?: Record<string, unknown> & { clarifications?: Clarification[] };
        clarifications?: Clarification[];
        error?: string;
      };
      if (!response.ok || !data.suggestion) throw new Error(data.error || "Ошибка");
      // Динамические вопросы от ИИ (поддерживаем оба варианта размещения в ответе);
      // вынимаем их до applySuggestion, чтобы не писать не-схемное поле в форму.
      const { clarifications: rawClarifications, ...suggestionFields } = data.suggestion;
      const raw = rawClarifications ?? data.clarifications ?? [];
      applySuggestion(suggestionFields as Partial<CreateSessionInput>);
      // Если классификатор не выделил задачу — используем сам бриф как фокус.
      if (!suggestionFields.focusTopic) {
        form.setValue("focusTopic", phrase, { shouldValidate: false });
      }
      setClarifications(Array.isArray(raw) ? raw.slice(0, 2) : []);
      setClarifyIndex(0);
      setRecognized(true);
      setPhase("clarify");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
      // Возвращаем бриф пользователю, чтобы можно было повторить.
      setTurns((prev) => prev.slice(0, -1));
      setBriefText(phrase);
      setPhase("brief");
    }
  }

  function pushUserTurn(text: string) {
    setTurns((prev) => [...prev, { role: "user", text }]);
  }

  // Дописывает ответ на уточнение в фокус задачи (для встреч — в контекст),
  // чтобы он реально влиял на генерацию. Затем сдвигает указатель вопросов.
  function appendClarificationAnswer(value: string) {
    const v = value.trim();
    if (!v) return;
    const field = isMeeting ? "meetingContext" : "focusTopic";
    const existing = form.getValues(field)?.trim();
    form.setValue(field, existing ? `${existing}\n${v}` : v, { shouldValidate: false });
    pushUserTurn(v);
    setAnswerText("");
    setClarifyIndex((i) => i + 1);
  }

  function skipClarification() {
    setAnswerText("");
    setClarifyIndex((i) => i + 1);
  }

  const voiceBusy = voice.state !== "idle";

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Главная
        </Link>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" /> Диалог с ИИ-штабом
        </span>
      </div>

      <div>
        <h1 className="text-lg font-semibold leading-tight">Создание сессии</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Опишите задачу — тип, регион и настройки предложу сам, уточню только то,
          чего не хватает.
        </p>
      </div>

      {/* Лента диалога */}
      <div className="space-y-4">
        {/* 1. Первый вопрос — постоянно виден как открытие диалога. Универсально:
            подходит под любой из 7 типов задач, не только встречу. */}
        <AssistantBubble>
          Опишите задачу: регион, тема и что нужно — подготовка встречи, анализ
          региона, позиция для ВП, стратегия, сценарии.
        </AssistantBubble>

        {/* История реплик */}
        {turns.map((turn, i) =>
          turn.role === "assistant" ? (
            <AssistantBubble key={i}>{turn.text}</AssistantBubble>
          ) : (
            <UserBubble key={i}>{turn.text}</UserBubble>
          ),
        )}

        {/* 2. Состояние распознавания */}
        {phase === "recognizing" && (
          <div className="flex items-center gap-2.5 pl-11 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Разбираю задачу…
          </div>
        )}

        {/* 3. Карточка «Понял так» с редактируемыми чипами */}
        {recognized && (
          <RecognitionCard
            session={session}
            regions={regions}
          />
        )}

        {/* 3b. Честная плашка про пустую карточку региона */}
        {recognized && emptyRegionCard && (
          <div className="ml-11 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            Карточка региона «{region}» пустая — часть материала будет гипотезой.
            Данные не выдумываются: спорные места будут помечены.
          </div>
        )}

        {/* 4. Текущий уточняющий вопрос (динамический, от ИИ) + элементы ответа.
            Ключ по индексу — чтобы поле ввода сбрасывалось между вопросами. */}
        {currentClarification && (
          <ClarifyPrompt
            key={clarifyIndex}
            clarification={currentClarification}
            answerText={answerText}
            setAnswerText={setAnswerText}
            voice={voice}
            voiceBusy={voiceBusy}
            onAnswer={appendClarificationAnswer}
            onSkip={skipClarification}
          />
        )}

        {/* 5. План материала + финальная кнопка */}
        {atPlan && (
          <div className="ml-11 space-y-4">
            <AssistantBubbleInline>
              Готово. Вот что соберу под эту задачу — включайте, выключайте и
              меняйте порядок блоков; объём — ниже.
            </AssistantBubbleInline>
            <MaterialPlanCard
              taskType={taskType}
              plan={plan}
              onVolume={(v) => form.setValue("detailLevel", v, { shouldValidate: false })}
              readiness={computeReadiness({
                isMeeting,
                hasRegion: Boolean(region),
                hasRegionProfile: Boolean(selectedRegionProfile),
                hasMeetingWith: Boolean(form.watch("meetingWith")?.trim()),
                hasMeetingGoal: Boolean(form.watch("meetingGoal")?.trim()),
                hasMeetingContext: Boolean(form.watch("meetingContext")?.trim()),
                hasFocus: Boolean(form.watch("focusTopic")?.trim()),
                urgency,
              })}
              angle={computeAngle({
                taskType,
                isMeeting,
                hasRegion: Boolean(region),
                hasRegionProfile: Boolean(selectedRegionProfile),
                urgency,
              })}
            />
            <Button
              type="button"
              size="lg"
              disabled={loading || plan.enabledOrdered.length === 0}
              onClick={submitWithPlan}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Собрать материал
            </Button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Ввод брифа — единственное обязательное действие. Показан на старте. */}
      {phase === "brief" && (
        <div className="rounded-2xl border p-4">
          <Textarea
            placeholder="Например: нужен анализ Татарстана — бюджет, отрасли и приоритеты; или: позиция для ВП по переходу на отечественное ПО"
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleBrief();
              }
            }}
            rows={3}
            className="mb-3 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2">
            <MicButton voice={voice} />
            <Button
              type="button"
              disabled={briefText.trim().length < 3}
              onClick={handleBrief}
            >
              <Send className="size-4" /> Отправить
            </Button>
          </div>
        </div>
      )}

      {/* Запасной путь — ручная форма */}
      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={onManual}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Заполнить вручную
        </button>
      </div>
    </div>
  );
}

// ── Пузыри диалога ───────────────────────────────────────────────────────────

function AssistantAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <Sparkles className="size-4" />
    </span>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

/** Пузырь ассистента без аватара — для вложенных блоков (уже под отступом). */
function AssistantBubbleInline({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
      {children}
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
        {children}
      </div>
    </div>
  );
}

// ── Микрофон (push-to-talk) ──────────────────────────────────────────────────

function MicButton({ voice }: { voice: ReturnType<typeof useVoiceInput> }) {
  if (!voice.supported) return <span className="text-xs text-muted-foreground">Голос недоступен</span>;
  if (voice.state === "recording") {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={voice.stop}>
        <Square className="size-3.5" /> Остановить
      </Button>
    );
  }
  if (voice.state === "transcribing") {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2 className="size-3.5 animate-spin" /> Распознаю…
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={voice.start}>
      <Mic className="size-3.5" /> Диктовать
    </Button>
  );
}

// ── «Понял так»: редактируемые чипы ──────────────────────────────────────────

type EditableField = "taskType" | "region" | "meetingWith";

/** Опции объёма — единый контрол живёт в карточке плана материала. */
const detailOptions: { value: DetailLevel; label: string }[] = [
  { value: "short", label: VOLUME_LABEL.short },
  { value: "medium", label: VOLUME_LABEL.medium },
  { value: "deep", label: VOLUME_LABEL.deep },
];

function RecognitionCard({
  session,
  regions,
}: {
  session: SessionApi;
  regions: ReturnType<typeof useRegions>["regions"];
}) {
  const { form, taskType, region, regionId, isMeeting, selectRegion } = session;
  const meetingWith = form.watch("meetingWith");
  const [editing, setEditing] = useState<EditableField | null>(null);

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="w-full max-w-[85%] rounded-2xl rounded-tl-md border bg-card p-3.5">
        <p className="mb-2.5 text-sm">Понял так — поправьте одним касанием:</p>
        <div className="flex flex-wrap gap-2">
          {/* Тип */}
          <Chip
            label="Тип"
            value={taskLabels[taskType]}
            open={editing === "taskType"}
            onToggle={() => setEditing(editing === "taskType" ? null : "taskType")}
          >
            <div className="flex flex-col gap-1">
              {taskOrder.map((value) => {
                const Icon = taskIcon[value];
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      form.setValue("taskType", value, { shouldValidate: false });
                      setEditing(null);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted",
                      taskType === value && "bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{taskLabels[value]}</span>
                  </button>
                );
              })}
            </div>
          </Chip>

          {/* Регион */}
          <Chip
            label="Регион"
            value={region || "не указан"}
            muted={!region}
            open={editing === "region"}
            onToggle={() => setEditing(editing === "region" ? null : "region")}
          >
            <RegionPicker
              region={region}
              regionId={regionId}
              regions={regions}
              onPick={(name, id) => {
                selectRegion(name, id);
                setEditing(null);
              }}
            />
          </Chip>

          {/* ЛПР — только для встреч */}
          {isMeeting && (
            <Chip
              label="ЛПР"
              value={meetingWith || "не указан"}
              muted={!meetingWith}
              open={editing === "meetingWith"}
              onToggle={() => setEditing(editing === "meetingWith" ? null : "meetingWith")}
            >
              <InlineTextEdit
                initial={meetingWith ?? ""}
                placeholder="ФИО и должность или роль"
                onSubmit={(v) => {
                  form.setValue("meetingWith", v, { shouldValidate: false });
                  setEditing(null);
                }}
              />
            </Chip>
          )}
          {/* Объём вынесен в единый контрол внутри «Плана материала» ниже. */}
        </div>
      </div>
    </div>
  );
}

/**
 * Чип с инлайн-правкой: тап по чипу раскрывает поповер с редактором.
 * Управляется снаружи (open/onToggle), чтобы одновременно был раскрыт один.
 */
function Chip({
  label,
  value,
  children,
  open,
  onToggle,
  muted,
  danger,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-sm font-medium transition",
          open
            ? "border-primary ring-1 ring-primary"
            : danger
              ? "border-amber-300 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
              : "bg-background hover:bg-muted/50",
        )}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={cn(muted && "text-muted-foreground")}>{value}</span>
        <Pencil className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 max-w-[80vw] overflow-auto rounded-xl border bg-popover p-1.5 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

/** Инлайн текстовый редактор с подтверждением по Enter/кнопке. */
function InlineTextEdit({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-1.5 p-1">
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }
        }}
      />
      <Button type="button" size="sm" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>
        <Check className="size-3.5" /> Готово
      </Button>
    </div>
  );
}

/** Пикер региона: инпут с автокомплитом searchRegions + популярные из БД. */
function RegionPicker({
  region,
  regionId,
  regions,
  onPick,
}: {
  region: string | undefined;
  regionId: string | undefined;
  regions: ReturnType<typeof useRegions>["regions"];
  onPick: (name: string, id?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const suggestions = query.trim().length >= 1 ? searchRegions(query, 8) : [];

  return (
    <div className="flex flex-col gap-1.5 p-1">
      <Input
        autoFocus
        autoComplete="off"
        value={query}
        placeholder="Название региона (89 субъектов)"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions[0]) {
            e.preventDefault();
            const dbMatch = regions.find((r) => r.name === suggestions[0]);
            onPick(suggestions[0], dbMatch?.id);
          }
        }}
      />
      {query.trim().length >= 1 ? (
        <div className="flex flex-col gap-0.5">
          {suggestions.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Ничего не найдено</p>
          )}
          {suggestions.map((name) => {
            const dbMatch = regions.find((r) => r.name === name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => onPick(name, dbMatch?.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted",
                  region === name && "bg-primary/10 text-primary",
                )}
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            С готовой карточкой
          </p>
          {regions.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.name, r.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted",
                (regionId === r.id || region === r.name) && "bg-primary/10 text-primary",
              )}
            >
              <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{r.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPick("Федеральный уровень")}
            className="rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted"
          >
            Федеральный уровень
          </button>
        </div>
      )}
    </div>
  );
}

// ── Уточняющий вопрос (динамический, от ИИ) ──────────────────────────────────

/**
 * Пузырь одного контекстного уточнения. Если у вопроса есть `options` —
 * показываем быстрые кнопки-варианты; в любом случае доступны свободный ввод,
 * голос и «Пропустить». Ответ передаётся наверх (дописывается в фокус задачи).
 */
function ClarifyPrompt({
  clarification,
  answerText,
  setAnswerText,
  voice,
  voiceBusy,
  onAnswer,
  onSkip,
}: {
  clarification: Clarification;
  answerText: string;
  setAnswerText: (v: string) => void;
  voice: ReturnType<typeof useVoiceInput>;
  voiceBusy: boolean;
  onAnswer: (v: string) => void;
  onSkip: () => void;
}) {
  const options = clarification.options ?? [];

  function submitText() {
    const v = answerText.trim();
    if (!v) return;
    onAnswer(v);
  }

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="w-full max-w-[85%] space-y-2.5">
        <div className="rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
          {clarification.question}
        </div>

        {/* Быстрые варианты ответа, если ИИ их предложил */}
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onAnswer(opt)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted/50"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Свободный ввод + голос + пропуск */}
        <div className="rounded-2xl border p-3">
          <Textarea
            placeholder={
              options.length > 0
                ? "Или ответьте своими словами"
                : "Ответьте своими словами или продиктуйте"
            }
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
            rows={2}
            className="mb-2.5 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MicButton voice={voice} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSkip}
                disabled={voiceBusy}
              >
                Пропустить
              </Button>
            </div>
            <Button type="button" size="sm" disabled={!answerText.trim()} onClick={submitText}>
              <Send className="size-3.5" /> Ответить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── План материала (диалоговый вариант, интерактивный) ───────────────────────

type Readiness = ReturnType<typeof computeReadiness>;
type PlanApi = ReturnType<typeof useMaterialPlan>;

/** Тег глубины блока под текущий объём (визуально и по смыслу различаются). */
function depthTag(block: MaterialBlock, volume: DetailLevel, enabled: boolean): string {
  if (!enabled) return "пропуск";
  if (block.core) {
    return volume === "deep" ? "полная" : volume === "short" ? "кратко" : "базовая";
  }
  return volume === "deep" ? "подробно" : volume === "short" ? "сжато" : "средне";
}

function MaterialPlanCard({
  taskType,
  plan,
  onVolume,
  readiness,
  angle,
}: {
  taskType: TaskType;
  plan: PlanApi;
  onVolume: (v: DetailLevel) => void;
  readiness: Readiness;
  angle: string;
}) {
  const { state, toggle, move } = plan;
  const registry = blocksForTask(taskType);
  const byId = new Map(registry.map((b) => [b.id, b] as const));
  // Блоки в текущем (перетаскиваемом) порядке.
  const ordered = state.order
    .map((id) => byId.get(id))
    .filter((b): b is MaterialBlock => Boolean(b));
  const enabledCount = ordered.filter((b) => state.enabled.has(b.id)).length;

  // Индекс перетаскиваемой строки (HTML5 DnD, без внешних библиотек).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function onDrop(target: number) {
    if (dragIndex !== null && dragIndex !== target) move(dragIndex, target);
    setDragIndex(null);
    setOverIndex(null);
  }

  const readyTone =
    readiness.tone === "high"
      ? { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", note: "основа подтверждена" }
      : readiness.tone === "mid"
        ? { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-500", note: "требуется проверка" }
        : { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-500", note: "не хватает входных данных" };

  return (
    <div className="overflow-hidden rounded-2xl border">
      {/* Заголовок */}
      <div className="flex items-baseline justify-between gap-2 border-b bg-muted/20 px-3.5 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          План материала · {taskLabels[taskType]}
        </p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {enabledCount} из {ordered.length} блоков
        </span>
      </div>

      <div className="space-y-3.5 p-3.5">
        {/* Индикатор готовности данных */}
        <div
          className={cn(
            "rounded-xl border p-3",
            readiness.tone === "high"
              ? "border-emerald-500/25 bg-emerald-500/[0.05]"
              : "border-amber-500/25 bg-amber-500/[0.06]",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", readyTone.text)}>
              <GaugeCircle className="size-4" /> Готовность входных данных
            </span>
            <span className={cn("text-xs font-semibold tabular-nums", readyTone.text)}>
              {readiness.percent}% · {readyTone.note}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className={cn("h-full rounded-full transition-all", readyTone.bar)} style={{ width: `${readiness.percent}%` }} />
          </div>
          {readiness.reasons.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {readiness.reasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded-md border border-amber-500/30 bg-background px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-500"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Угол подачи */}
        {angle && (
          <div className="flex items-start gap-2 rounded-xl border border-blue-500/25 bg-blue-500/[0.05] px-3 py-2 text-xs font-medium leading-snug text-blue-700 dark:text-blue-400">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Угол подачи:</span> {angle}
            </span>
          </div>
        )}

        {/* Строки блоков: ручка перетаскивания + название + тег глубины + тумблер */}
        <ul className="overflow-hidden rounded-xl border">
          {ordered.map((block, index) => {
            const on = state.enabled.has(block.id);
            const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
            return (
              <li
                key={block.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnter={() => setOverIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 transition",
                  index > 0 && "border-t",
                  !on && "bg-muted/40",
                  isOver && "bg-primary/[0.06]",
                  dragIndex === index && "opacity-60",
                )}
              >
                <span
                  className="shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing"
                  aria-hidden
                  title="Перетащите, чтобы изменить порядок"
                >
                  <GripVertical className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-[13px] font-medium leading-snug", !on && "text-muted-foreground")}>
                    {block.label}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {block.core && (
                      <span className="rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                        ядро
                      </span>
                    )}
                    {on
                      ? block.hint && <span className="truncate">{block.hint}</span>
                      : <span className="italic">исключён из материала</span>}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    on ? "text-muted-foreground" : "border-dashed text-muted-foreground/60",
                  )}
                >
                  {depthTag(block, state.volume, on)}
                </span>
                <ToggleSwitch
                  checked={on}
                  disabled={block.core}
                  onChange={() => toggle(block)}
                  label={block.label}
                />
              </li>
            );
          })}
        </ul>

        {/* Единый контрол объёма */}
        <div className="border-t pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Объём материала
          </p>
          <div className="flex gap-1.5">
            {detailOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onVolume(value)}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2 text-center text-xs font-semibold transition",
                  state.volume === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {state.volume === "short"
              ? "Коротко: только обязательные блоки, суть без деталей."
              : state.volume === "medium"
                ? "Средне: обязательные + ключевые ситуативные блоки."
                : "Глубоко: все блоки с максимальной проработкой."}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Компактный тумблер вкл/выкл (native button, доступный, без библиотек). */
function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${checked ? "включён" : "выключен"}`}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-[18px] rounded-full bg-background shadow-sm transition-all",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

// ── Ручной пошаговый режим (сохранён без изменения логики submit/валидации) ──

export function StepForm({
  session,
  onChat,
}: {
  session: SessionApi;
  onChat: () => void;
}) {
  const {
    form,
    step,
    steps,
    progress,
    loading,
    regionInput,
    setRegionInput,
    taskType,
    horizon,
    detailLevel,
    urgency,
    region,
    regionId,
    needsHorizon,
    isMeeting,
    submit,
    selectRegion,
    setStep,
    validateCurrentStep,
    applySuggestion,
  } = session;

  const { regions } = useRegions();
  const currentStep = steps[step];
  const isFollowup = taskType === "meeting_followup";

  // Force re-render workaround for Telegram WebView
  const [, forceUpdate] = useState(0);
  const [oneshotText, setOneshotText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const voice = useVoiceInput((transcript) => {
    setOneshotText((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript));
  });

  const goToStep = useCallback(
    (n: number) => {
      setStep(n);
      forceUpdate((v) => v + 1);
      window.scrollTo(0, 0);
    },
    [setStep],
  );

  // Переход «вперёд» по кнопке «Дальше»: сначала валидируем текущий шаг
  // (напр. обязательную «Задачу»), и только при успехе двигаемся дальше.
  async function goForward() {
    const valid = await validateCurrentStep();
    if (valid) goToStep(step + 1);
    else forceUpdate((v) => v + 1);
  }

  async function applyOneshot() {
    const phrase = oneshotText.trim();
    if (phrase.length < 3) return;
    setClassifying(true);
    try {
      const response = await fetch("/api/sessions/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const data = (await response.json()) as { suggestion?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.suggestion) throw new Error(data.error || "Ошибка");
      applySuggestion(data.suggestion as Partial<CreateSessionInput>);
      if (!data.suggestion.focusTopic) form.setValue("focusTopic", phrase, { shouldValidate: false });
      const suggestedTask = (data.suggestion.taskType as TaskType | undefined) || taskType;
      toast.success("Черновик подготовлен");
      goToStep(getStepsForTask(suggestedTask).length - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setClassifying(false);
    }
  }

  const selectedRegionProfile = regions.find((r) => r.id === regionId || r.name === region);

  // Интерактивный план материала (тот же контрол, что и в диалоге).
  const plan = useMaterialPlan(taskType, detailLevel);
  const submitWithPlan = useCallback(() => {
    form.setValue(
      "materialPlan",
      { blocks: plan.enabledOrdered, volume: plan.state.volume },
      { shouldValidate: false },
    );
    return form.handleSubmit(submit, reportInvalidPlan)();
  }, [form, plan.enabledOrdered, plan.state.volume, submit]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Главная
        </Link>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
          {step + 1} / {steps.length}
        </span>
      </div>

      {/* Progress */}
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Step title */}
      <h1 className="text-lg font-semibold">{currentStep}</h1>

      {/* Content */}
      <div>
        {/* STEP 0: Quick start */}
        {currentStep === "Быстрый старт" && (
          <div className="space-y-4">
            <div className="rounded-2xl border p-4">
              <Textarea
                placeholder="Опишите задачу одной фразой: завтра встреча с Минцифры Татарстана по платформе данных"
                value={oneshotText}
                onChange={(e) => setOneshotText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); applyOneshot(); } }}
                rows={3}
                className="mb-3 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="sm" onClick={voice.start} disabled={voice.state !== "idle"}>
                  <Mic className="size-3.5" /> {voice.state === "recording" ? "Запись..." : "Диктовать"}
                </Button>
                <Button type="button" size="sm" disabled={classifying || !oneshotText.trim()} onClick={applyOneshot}>
                  {classifying ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Подготовить черновик
                </Button>
              </div>
            </div>
            <button type="button" onClick={onChat} className="w-full rounded-xl border bg-background px-4 py-3 text-sm font-medium active:bg-muted">
              Вернуться к диалогу
            </button>
          </div>
        )}

        {/* STEP 1: What */}
        {currentStep === "Тип материала" && (
          <div className="space-y-1.5">
            {taskOrder.map((value) => {
              const Icon = taskIcon[value];
              const active = taskType === value;
              return (
                <button type="button" key={value} onClick={() => form.setValue("taskType", value, { shouldValidate: true })}
                  className={cn("flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition", active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold leading-tight", active && "text-primary-foreground")}>{taskLabels[value]}</p>
                    <p className={cn("mt-0.5 text-xs", active ? "text-primary-foreground/70" : "text-muted-foreground")}>{active ? taskOutputDescription[value] : taskWhenToUse[value]}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* STEP 2: Meeting or Task */}
        {(currentStep === "О встрече" || currentStep === "Задача") && (
          <div className="space-y-4">
            {isMeeting && (
              <>
                <Field label="С кем встреча">
                  <Input placeholder="Министр цифрового развития Татарстана" {...form.register("meetingWith")} />
                </Field>
                {!isFollowup && (
                  <Field label="Когда">
                    <Input placeholder="Завтра, 16 мая" {...form.register("meetingDate")} />
                  </Field>
                )}
                <Field label={isFollowup ? "Что договорились" : "Цель встречи"}>
                  <Input placeholder={isFollowup ? "Договорились о пилоте" : "Согласие на пилот"} {...form.register("meetingGoal")} />
                </Field>
              </>
            )}

            {/* Region */}
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Регион</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {regions.map((r) => (
                  <button type="button" key={r.id} onClick={() => selectRegion(r.name, r.id)}
                    className={cn("rounded-lg border px-2.5 py-1 text-xs transition", (regionId === r.id || region === r.name) ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}>
                    {r.name}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Input
                  placeholder="Или введите название региона (89 субъектов РФ)"
                  value={regionInput}
                  autoComplete="off"
                  onChange={(e) => {
                    setRegionInput(e.target.value);
                    form.setValue("region", e.target.value, { shouldValidate: false });
                    setRegionOpen(true);
                  }}
                  onFocus={() => setRegionOpen(true)}
                  onBlur={() => window.setTimeout(() => setRegionOpen(false), 150)}
                />
                {regionOpen && regionInput.trim().length >= 1 && (() => {
                  const suggestions = searchRegions(regionInput, 8);
                  if (suggestions.length === 0) return null;
                  if (suggestions.length === 1 && suggestions[0] === region) return null;
                  return (
                    <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
                      {suggestions.map((name) => {
                        const dbMatch = regions.find((r) => r.name === name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              selectRegion(name, dbMatch?.id);
                              setRegionOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted",
                              region === name && "bg-primary/10 text-primary",
                            )}
                          >
                            <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                            <span>{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              {selectedRegionProfile && (
                <div className="mt-2 rounded-xl border bg-muted/30 p-3 text-xs">
                  <p className="font-semibold">{selectedRegionProfile.name}</p>
                  <p className="text-muted-foreground">{selectedRegionProfile.stakeholders.length} ЛПР · {selectedRegionProfile.activeProjects.length} проектов Сбера</p>
                  <RegionDataHints profile={selectedRegionProfile} />
                </div>
              )}
            </div>

            {isMeeting && (
              <Field label="Контекст">
                <Textarea rows={2} placeholder="Что известно о ЛПР и повестке встречи" {...form.register("meetingContext")} />
              </Field>
            )}

            <Field label={isMeeting ? (isFollowup ? "Открытые вопросы" : "Повестка") : "Задача"} required>
              <Textarea rows={4} placeholder={taskFocusPlaceholder[taskType]} {...form.register("focusTopic")} />
              {form.formState.errors.focusTopic && <p className="mt-1 text-xs text-destructive">{form.formState.errors.focusTopic.message}</p>}
            </Field>
          </div>
        )}

        {/* STEP 3: Details */}
        {currentStep === "Детали" && (
          <div className="space-y-4">
            {/* Объём выбирается единым контролом внутри «Плана материала» ниже. */}

            {needsHorizon && (
              <Field label="Горизонт">
                <div className="grid grid-cols-4 gap-2">
                  {(["3_months", "12_months", "2028", "2030"] as const).map((v) => (
                    <button type="button" key={v} onClick={() => form.setValue("horizon", v, { shouldValidate: true })}
                      className={cn("rounded-xl border p-2 text-center text-xs font-semibold transition", horizon === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/50")}>
                      {v === "3_months" ? "3 мес" : v === "12_months" ? "12 мес" : v}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Название (необязательно)">
              <Input placeholder="Для списка сессий" maxLength={60} {...form.register("title")} />
            </Field>

            <div className="rounded-2xl border bg-muted/30 p-3.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Что агент подготовит
              </p>
              <SummaryRow label="Материал" value={taskLabels[taskType]} />
              {region && <SummaryRow label="Регион" value={region} />}
              <SummaryRow
                label="Задача"
                value={(form.watch("focusTopic") || "не указана").slice(0, 120)}
              />
              {isMeeting && form.watch("meetingWith") && (
                <SummaryRow label="Встреча с" value={form.watch("meetingWith") ?? ""} />
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="rounded-xl border bg-background px-3 py-2 text-xs font-medium active:bg-muted"
                >
                  Изменить тип
                </button>
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="rounded-xl border bg-background px-3 py-2 text-xs font-medium active:bg-muted"
                >
                  Изменить задачу
                </button>
              </div>
            </div>

            <MaterialPlanCard
              taskType={taskType}
              plan={plan}
              onVolume={(v) => form.setValue("detailLevel", v, { shouldValidate: false })}
              readiness={computeReadiness({
                isMeeting,
                hasRegion: Boolean(region),
                hasRegionProfile: Boolean(selectedRegionProfile),
                hasMeetingWith: Boolean(form.watch("meetingWith")?.trim()),
                hasMeetingGoal: Boolean(form.watch("meetingGoal")?.trim()),
                hasMeetingContext: Boolean(form.watch("meetingContext")?.trim()),
                hasFocus: Boolean(form.watch("focusTopic")?.trim()),
                urgency,
              })}
              angle={computeAngle({
                taskType,
                isMeeting,
                hasRegion: Boolean(region),
                hasRegionProfile: Boolean(selectedRegionProfile),
                urgency,
              })}
            />
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex gap-2">
          <button type="button" disabled={step === 0} onClick={() => { goToStep(Math.max(0, step - 1)); }}
            className="flex-1 rounded-xl border px-4 py-3 text-sm font-medium disabled:opacity-50 active:bg-muted">
            Назад
          </button>
          {step < steps.length - 1 ? (
            <button type="button" onClick={() => { goForward(); }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground active:bg-primary/90">
              Далее <ArrowRight className="size-4" />
            </button>
          ) : (
            <button type="button" disabled={loading || plan.enabledOrdered.length === 0} onClick={submitWithPlan}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50 active:bg-primary/90">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Создать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </p>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3 last:mb-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium leading-snug">{value}</span>
    </div>
  );
}

function RegionDataHints({
  profile,
}: {
  profile: {
    id: string;
    activeProjects: Array<{
      title?: string;
      amount?: string;
      sberOwner?: string;
      customerOwner?: string;
      notes?: string;
    }>;
    stakeholders: Array<{
      fullName?: string;
      motivation?: string;
      redFlags?: string;
    }>;
  };
}) {
  const projectGaps = profile.activeProjects
    .filter((project) => !project.amount || !project.sberOwner || !project.customerOwner || !project.notes)
    .slice(0, 2);
  const stakeholderGaps = profile.stakeholders
    .filter((person) => !person.motivation || !person.redFlags)
    .slice(0, 2);
  const gaps = [
    ...projectGaps.map((project) => `проект «${project.title || "без названия"}»: сумма, владельцы или статус`),
    ...stakeholderGaps.map((person) => `ЛПР ${person.fullName || "без ФИО"}: управленческий интерес и риск согласования`),
  ];

  if (!gaps.length) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900/40 dark:bg-amber-950/20">
      <p className="font-semibold text-amber-800 dark:text-amber-200">
        Для более точного материала дополните карточку региона
      </p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {gaps.map((gap) => (
          <li key={gap}>• {gap}</li>
        ))}
      </ul>
      <a
        href={`/regions/${profile.id}`}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-block font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
      >
        Дополнить данные региона
      </a>
    </div>
  );
}
