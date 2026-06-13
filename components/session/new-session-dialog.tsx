"use client";

import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  Globe,
  Loader2,
  Mail,
  Map,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  Mic,
  Presentation,
  Route,
  Send,
  Sparkles,
  Target,
  Timer,
  User,
  UsersRound,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  constraintOptions,
  deliveryFormatLabels,
  deliveryFormatSubLabels,
  deliveryFormats,
  horizons,
  taskFocusPlaceholder,
  taskLabels,
  taskOutputDescription,
  taskWhenToUse,
  urgencyLabels,
  urgencyLevels,
  urgencySubLabels,
  type CreateSessionInput,
  type DeliveryFormat,
  type TaskType,
  type UrgencyLevel,
} from "@/lib/schemas/session";
import { cn } from "@/lib/utils";
import { getStepsForTask, useSessionForm } from "./use-session-form";
import { useRegions } from "./use-regions";
import { useVoiceInput } from "./use-voice-input";
import { toast } from "sonner";

// ── Константы ─────────────────────────────────────────────────────────────────

const horizonOptions: Array<{ value: (typeof horizons)[number]; label: string; sub: string }> = [
  { value: "3_months", label: "3 месяца", sub: "Оперативный" },
  { value: "12_months", label: "12 месяцев", sub: "Годовой" },
  { value: "2028", label: "до 2028", sub: "Среднесрочный" },
  { value: "2030", label: "до 2030", sub: "Долгосрочный" },
];

const detailOptions = [
  { value: "short" as const, label: "Коротко", sub: "1 экран, выводы" },
  { value: "medium" as const, label: "Средне", sub: "Выводы + план" },
  { value: "deep" as const, label: "Глубоко", sub: "Полный анализ" },
];

const taskIcon: Record<TaskType, React.ComponentType<{ className?: string }>> = {
  meeting_preparation: UsersRound,
  meeting_followup: ClipboardCheck,
  executive_brief: BriefcaseBusiness,
  sber_region_strategy: Building2,
  region_strategy: Map,
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

const urgencyIcon: Record<UrgencyLevel, React.ComponentType<{ className?: string }>> = {
  "2_hours": Timer,
  today: Gauge,
  "24h": CalendarClock,
  week: Route,
  flex: Sparkles,
};

const deliveryIcon: Record<DeliveryFormat, React.ComponentType<{ className?: string }>> = {
  workspace: FileText,
  docx: FileText,
  pptx: Presentation,
  email: Mail,
  messenger: MessagesSquare,
};

// Быстрые шаблоны, которые заполняют форму и переводят на шаг 2
const quickTemplates: Array<{
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  patch: Partial<CreateSessionInput>;
}> = [
  {
    id: "gov-meet",
    icon: UsersRound,
    title: "Встреча с ЛПР",
    sub: "Досье, тезисы, сценарий",
    patch: { taskType: "meeting_preparation", urgency: "24h", detailLevel: "medium" },
  },
  {
    id: "vp",
    icon: BriefcaseBusiness,
    title: "Позиция для ВП",
    sub: "Одна страница, решение сверху",
    patch: { taskType: "executive_brief", urgency: "today", detailLevel: "short", deliveryFormat: "email" },
  },
  {
    id: "region",
    icon: Map,
    title: "Первый заход в регион",
    sub: "ЛПР, боли, точка входа",
    patch: { taskType: "region_strategy", urgency: "week", detailLevel: "deep" },
  },
];

// ── Компонент ─────────────────────────────────────────────────────────────────

export function NewSessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    deliveryFormat,
    region,
    regionId,
    selectedConstraints,
    needsHorizon,
    isMeeting,
    submit,
    toggleConstraint,
    selectRegion,
    goNext,
    goBack,
    goToStep,
    setStep,
    applySuggestion,
  } = useSessionForm(() => onOpenChange(false));

  const { regions } = useRegions();
  const currentStep = steps[step];
  const isFollowup = taskType === "meeting_followup";

  // ── Голос + One-shot ───────────────────────────────────────────────────
  const [oneshotText, setOneshotText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const voice = useVoiceInput((transcript) => {
    setOneshotText((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript));
  });

  async function applyOneshot() {
    const phrase = oneshotText.trim();
    if (phrase.length < 3) {
      toast.error("Опишите задачу одной-двумя фразами");
      return;
    }
    setClassifying(true);
    try {
      const response = await fetch("/api/sessions/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const data = (await response.json()) as {
        suggestion?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !data.suggestion) {
        throw new Error(data.error || "Сервис классификации не ответил");
      }
      applySuggestion(data.suggestion as Partial<CreateSessionInput>);
      // Если не указан focusTopic, используем саму фразу
      if (!data.suggestion.focusTopic) {
        form.setValue("focusTopic", phrase, { shouldValidate: false });
      }
      const suggestedTask = (data.suggestion.taskType as TaskType | undefined) || taskType;
      toast.success("Черновик подготовлен · проверьте и запустите");
      setStep(getStepsForTask(suggestedTask).length - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка распознавания задачи");
    } finally {
      setClassifying(false);
    }
  }

  function applyTemplate(patch: Partial<CreateSessionInput>) {
    applySuggestion(patch);
    toast.success(`Шаблон применён · ${taskLabels[(patch.taskType as TaskType) || taskType]}`);
    setStep(1);
  }

  // Контекст региона (для чип-виджета)
  const selectedRegionProfile = regions.find(
    (r) => r.id === regionId || r.name === region,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={true}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* ── Шапка ── */}
        <div className="border-b bg-card px-5 pb-3 pt-4">
          <div className="mb-3 flex items-center gap-3 pr-8">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Новая сессия</p>
              <h2 className="text-sm font-semibold leading-tight">{currentStep}</h2>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
              {step + 1} / {steps.length}
            </span>
          </div>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Быстрая навигация по шагам: клик возвращает к уже пройденному */}
          <div className="flex gap-1.5">
            {steps.map((name, idx) => (
              <button
                key={name}
                type="button"
                onClick={() => goToStep(idx)}
                className={cn(
                  "flex-1 truncate rounded-md px-2 py-1 text-[11px] font-medium transition",
                  idx === step
                    ? "bg-foreground text-background"
                    : idx < step
                      ? "bg-muted text-foreground/80 hover:bg-muted/70"
                      : "bg-transparent text-muted-foreground",
                )}
              >
                {idx + 1}. {name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Контент ── */}
        <div className="flex-1 overflow-y-auto">
          <form
            onSubmit={form.handleSubmit(submit)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && step < steps.length - 1) e.preventDefault();
            }}
          >
            <div className="p-5">
              {/* ══════════════════════════════════════════════════
                  ШАГ 0: Быстрый старт
              ══════════════════════════════════════════════════ */}
              {currentStep === "Быстрый старт" && (
                <div className="space-y-5">
                  {/* Крупное поле и микрофон */}
                  <div>
                    <SectionTitle
                      title="Опишите задачу одной фразой"
                      sub="Система подготовит черновик сессии. При необходимости скорректируйте параметры перед запуском."
                    />
                    <div className="relative rounded-2xl border bg-background p-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
                      <Textarea
                        placeholder="Например: завтра в 10 встреча с Миннигуловым по платформе данных ЖКХ, нужна краткая записка с экономикой"
                        value={oneshotText}
                        onChange={(e) => setOneshotText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            applyOneshot();
                          }
                        }}
                        className="min-h-24 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                        rows={4}
                      />
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <VoiceButton
                          state={voice.state}
                          supported={voice.supported}
                          onStart={voice.start}
                          onStop={voice.stop}
                          onCancel={voice.cancel}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={classifying || !oneshotText.trim()}
                          onClick={applyOneshot}
                        >
                          {classifying ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Wand2 className="size-4" />
                          )}
                          Подготовить черновик
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Шаблоны */}
                  <div>
                    <SectionTitle title="Или выберите шаблон" />
                    <div className="grid gap-1.5">
                      {quickTemplates.map((tpl) => (
                        <button
                          type="button"
                          key={tpl.id}
                          onClick={() => applyTemplate(tpl.patch)}
                          className="group flex items-center gap-3 rounded-xl border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted/50"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                            <tpl.icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-tight">{tpl.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{tpl.sub}</p>
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="w-full rounded-xl border border-dashed py-3 text-sm text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                    onClick={() => setStep(1)}
                  >
                    Пропустить и заполнить вручную
                  </button>
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                  ШАГ 1: Тип материала
              ══════════════════════════════════════════════════ */}
              {currentStep === "Тип материала" && (
                <div className="space-y-1.5">
                  {taskOrder.map((value) => {
                    const Icon = taskIcon[value];
                    const active = taskType === value;
                    return (
                      <button
                        type="button"
                        key={value}
                        onClick={() => form.setValue("taskType", value, { shouldValidate: true })}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "bg-background hover:bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg",
                            active
                              ? "bg-primary-foreground/15 text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-sm font-semibold leading-tight",
                              active ? "text-primary-foreground" : "text-foreground",
                            )}
                          >
                            {taskLabels[value]}
                          </p>
                          <p
                            className={cn(
                              "mt-0.5 text-xs leading-tight",
                              active ? "text-primary-foreground/70" : "text-muted-foreground",
                            )}
                          >
                            {active ? taskOutputDescription[value] : taskWhenToUse[value]}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                  ШАГ 2а: О встрече
              ══════════════════════════════════════════════════ */}
              {currentStep === "О встрече" && isMeeting && (
                <div className="space-y-5">
                  <div>
                    <FieldLabel icon={<User className="size-3.5" />} title="С кем встреча" />
                    <Input
                      placeholder="Министр цифрового развития Татарстана"
                      {...form.register("meetingWith")}
                    />
                    <FieldHint>ФИО, должность и ведомство — агент учтёт роль и приоритеты ЛПР</FieldHint>
                  </div>

                  {!isFollowup && (
                    <div>
                      <FieldLabel
                        icon={<CalendarClock className="size-3.5" />}
                        title="Когда встреча"
                      />
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {["Сегодня", "Завтра", "Через 3 дня", "На следующей неделе"].map((label) => (
                          <button
                            type="button"
                            key={label}
                            onClick={() => form.setValue("meetingDate", label, { shouldValidate: false })}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs transition",
                              form.watch("meetingDate") === label
                                ? "border-primary bg-primary text-primary-foreground"
                                : "bg-background hover:bg-muted/50",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <Input placeholder="Или укажите другую дату" {...form.register("meetingDate")} />
                    </div>
                  )}

                  <div>
                    <FieldLabel
                      icon={<Target className="size-3.5" />}
                      title={isFollowup ? "Что договорились" : "Что хотим получить"}
                    />
                    <Input
                      placeholder={
                        isFollowup
                          ? "Договорились о пилоте, следующий шаг — КП до 20 мая"
                          : "Согласие на пилот системы аналитики данных ЖКХ"
                      }
                      {...form.register("meetingGoal")}
                    />
                    <FieldHint>
                      {isFollowup
                        ? "Главный итог встречи одной фразой"
                        : "Конкретное решение — не «обсудить», а «получить»"}
                    </FieldHint>
                  </div>

                  <RegionPicker
                    regions={regions}
                    region={region ?? ""}
                    regionId={regionId ?? ""}
                    regionInput={regionInput}
                    setRegionInput={setRegionInput}
                    onPick={(r) => selectRegion(r.name, r.id)}
                    onFree={(value) => {
                      form.setValue("region", value, { shouldValidate: false });
                      form.setValue("regionId", "", { shouldValidate: false });
                    }}
                    selectedProfile={selectedRegionProfile}
                  />

                  <div>
                    <FieldLabel
                      icon={<MessageSquareText className="size-3.5" />}
                      title={isFollowup ? "Что обсуждали" : "Что уже знаете"}
                    />
                    <Textarea
                      rows={3}
                      placeholder={
                        isFollowup
                          ? "Обсуждали платформу данных ЖКХ, он попросил показать кейсы из других регионов..."
                          : "Ранее обсуждали платформу данных, он скептически относится к ИИ, фокус на сокращении бюджета..."
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) e.stopPropagation();
                      }}
                      {...form.register("meetingContext")}
                    />
                    <FieldHint>
                      {isFollowup
                        ? "Ключевые моменты встречи — агент структурирует итоги"
                        : "Про ЛПР, региональную повестку или текущие проекты Сбера"}
                    </FieldHint>
                  </div>

                  <div>
                    <FieldLabel
                      icon={<Target className="size-3.5" />}
                      title={isFollowup ? "Открытые вопросы и следующие шаги" : "Повестка встречи"}
                      required
                    />
                    <Textarea
                      rows={3}
                      placeholder={taskFocusPlaceholder[taskType]}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) e.stopPropagation();
                      }}
                      {...form.register("focusTopic")}
                    />
                    {form.formState.errors.focusTopic && (
                      <p className="mt-1 text-xs text-destructive">
                        {form.formState.errors.focusTopic.message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                  ШАГ 2б: Задача
              ══════════════════════════════════════════════════ */}
              {currentStep === "Задача" && !isMeeting && (
                <div className="space-y-5">
                  <RegionPicker
                    regions={regions}
                    region={region ?? ""}
                    regionId={regionId ?? ""}
                    regionInput={regionInput}
                    setRegionInput={setRegionInput}
                    onPick={(r) => selectRegion(r.name, r.id)}
                    onFree={(value) => {
                      form.setValue("region", value, { shouldValidate: false });
                      form.setValue("regionId", "", { shouldValidate: false });
                    }}
                    selectedProfile={selectedRegionProfile}
                    allowEmpty
                  />

                  <div>
                    <FieldLabel icon={<Target className="size-3.5" />} title="Задача" required />
                    <Textarea
                      rows={6}
                      placeholder={taskFocusPlaceholder[taskType]}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) e.stopPropagation();
                      }}
                      {...form.register("focusTopic")}
                    />
                    {form.formState.errors.focusTopic && (
                      <p className="mt-1 text-xs text-destructive">
                        {form.formState.errors.focusTopic.message}
                      </p>
                    )}
                    <FieldHint>Чем конкретнее — тем точнее материал</FieldHint>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                  ШАГ 3: Детали
              ══════════════════════════════════════════════════ */}
              {currentStep === "Детали" && (
                <div className="space-y-5">
                  {/* Срочность — визуально крупная */}
                  <div>
                    <FieldLabel icon={<Timer className="size-3.5" />} title="Срочность" />
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                      {urgencyLevels.map((value) => {
                        const Icon = urgencyIcon[value];
                        const active = urgency === value;
                        return (
                          <button
                            type="button"
                            key={value}
                            onClick={() =>
                              form.setValue("urgency", value, { shouldValidate: false })
                            }
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition",
                              active
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "bg-background hover:bg-muted/50",
                            )}
                          >
                            <Icon className="size-3.5" />
                            <span className="text-xs font-semibold leading-tight">
                              {urgencyLabels[value]}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] leading-tight",
                                active ? "text-primary-foreground/70" : "text-muted-foreground",
                              )}
                            >
                              {urgencySubLabels[value]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Формат сдачи */}
                  <div>
                    <FieldLabel icon={<Send className="size-3.5" />} title="Формат сдачи" />
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                      {deliveryFormats.map((value) => {
                        const Icon = deliveryIcon[value];
                        const active = deliveryFormat === value;
                        return (
                          <button
                            type="button"
                            key={value}
                            onClick={() =>
                              form.setValue("deliveryFormat", value, { shouldValidate: false })
                            }
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition",
                              active
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "bg-background hover:bg-muted/50",
                            )}
                          >
                            <Icon className="size-3.5" />
                            <span className="text-xs font-semibold leading-tight">
                              {deliveryFormatLabels[value]}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] leading-tight",
                                active ? "text-primary-foreground/70" : "text-muted-foreground",
                              )}
                            >
                              {deliveryFormatSubLabels[value]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Горизонт — только где нужен */}
                  {needsHorizon && (
                    <div>
                      <FieldLabel icon={<Route className="size-3.5" />} title="Горизонт планирования" />
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {horizonOptions.map((opt) => (
                          <ToggleCard
                            key={opt.value}
                            active={horizon === opt.value}
                            title={opt.label}
                            sub={opt.sub}
                            onClick={() =>
                              form.setValue("horizon", opt.value, { shouldValidate: true })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Объём */}
                  <div>
                    <FieldLabel icon={<BarChart3 className="size-3.5" />} title="Объём материала" />
                    <div className="grid grid-cols-3 gap-2">
                      {detailOptions.map((opt) => (
                        <ToggleCard
                          key={opt.value}
                          active={detailLevel === opt.value}
                          title={opt.label}
                          sub={opt.sub}
                          onClick={() =>
                            form.setValue("detailLevel", opt.value, { shouldValidate: true })
                          }
                        />
                      ))}
                    </div>
                  </div>

                  {/* Название */}
                  <div>
                    <FieldLabel
                      icon={<CalendarClock className="size-3.5" />}
                      title="Название (необязательно)"
                    />
                    <Input
                      placeholder={
                        isMeeting
                          ? "Встреча с Минцифры Татарстана"
                          : "Например: Стратегия по ЦЭ на 2026"
                      }
                      maxLength={60}
                      {...form.register("title")}
                    />
                    <FieldHint>Используется в списке сессий. Если не указано — подставляется из задачи.</FieldHint>
                  </div>

                  {/* Доп. блоки */}
                  <div>
                    <FieldLabel icon={<BookOpen className="size-3.5" />} title="Добавить в материал" />
                    <div className="space-y-1.5">
                      {constraintOptions.map((item) => {
                        const checked = selectedConstraints?.includes(item) ?? false;
                        return (
                          <button
                            type="button"
                            key={item}
                            onClick={() => toggleConstraint(item)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                              checked ? "border-primary/30 bg-primary/5" : "hover:bg-muted/50",
                            )}
                          >
                            <Checkbox checked={checked} className="shrink-0" />
                            <span className={cn("text-sm", checked && "font-medium")}>{item}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Поделиться */}
                  <ShareField form={form} />

                  {/* Резюме */}
                  <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3.5">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Что агент подготовит
                    </p>
                    <SummaryRow label="Материал" value={taskLabels[taskType]} />
                    {region && <SummaryRow label="Регион" value={region} />}
                    <SummaryRow
                      label="Задача"
                      value={(form.watch("focusTopic") || "не указана").slice(0, 120)}
                    />
                    <SummaryRow label="Срочность" value={urgencyLabels[urgency]} />
                    <SummaryRow label="Формат" value={deliveryFormatLabels[deliveryFormat]} />
                    {needsHorizon && (
                      <SummaryRow
                        label="Горизонт"
                        value={horizonOptions.find((h) => h.value === horizon)?.label ?? horizon}
                      />
                    )}
                    <SummaryRow
                      label="Объём"
                      value={detailOptions.find((d) => d.value === detailLevel)?.label ?? detailLevel}
                    />
                    {isMeeting && form.watch("meetingWith") && (
                      <SummaryRow label="Встреча с" value={form.watch("meetingWith") ?? ""} />
                    )}
                    {isMeeting && !isFollowup && form.watch("meetingDate") && (
                      <SummaryRow label="Когда" value={form.watch("meetingDate") ?? ""} />
                    )}
                    {selectedConstraints && selectedConstraints.length > 0 && (
                      <SummaryRow label="Доп. блоки" value={`${selectedConstraints.length} выбрано`} />
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                        Изменить тип
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setStep(2)}>
                        Изменить задачу
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Навигация ── */}
            <div className="sticky bottom-0 border-t bg-popover px-5 py-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={step === 0}
                  onClick={goBack}
                >
                  Назад
                </Button>
                {step < steps.length - 1 ? (
                  <Button type="button" className="flex-1" onClick={goNext}>
                    Далее <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={loading}
                    className="flex-1"
                    onClick={form.handleSubmit(submit)}
                  >
                    {loading ? (
                      <Sparkles className="size-4 animate-pulse" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    Создать сессию
                  </Button>
                )}
              </div>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Вспомогательные компоненты ───────────────────────────────────────────────

function FieldLabel({
  icon,
  title,
  required,
}: {
  icon: React.ReactNode;
  title: string;
  required?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {required && <span className="ml-0.5 text-xs text-destructive">*</span>}
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>;
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ToggleCard({
  active,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition hover:shadow-sm",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "bg-background hover:bg-muted/50",
      )}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span
        className={cn(
          "text-xs leading-tight",
          active ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {sub}
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium">{value}</span>
    </div>
  );
}

// ── Voice button ─────────────────────────────────────────────────────────────

function VoiceButton({
  state,
  supported,
  onStart,
  onStop,
  onCancel,
}: {
  state: "idle" | "recording" | "transcribing";
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  if (!supported) {
    return (
      <span className="text-xs text-muted-foreground">
        Голосовой ввод недоступен в этом браузере
      </span>
    );
  }
  if (state === "transcribing") {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Распознавание...
      </span>
    );
  }
  if (state === "recording") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-destructive/60" />
            <span className="relative inline-flex size-2 rounded-full bg-destructive" />
          </span>
          Запись...
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-3.5" /> Отмена
        </Button>
        <Button type="button" size="sm" onClick={onStop}>
          <CheckCircle2 className="size-3.5" /> Готово
        </Button>
      </div>
    );
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={onStart}>
      <Mic className="size-3.5" /> Диктовать
    </Button>
  );
}

// ── Region picker с контекстом Сбера ────────────────────────────────────────

function RegionPicker({
  regions,
  region,
  regionId,
  regionInput,
  setRegionInput,
  onPick,
  onFree,
  selectedProfile,
  allowEmpty = false,
}: {
  regions: Array<{ id: string; name: string; activeProjects?: unknown[]; digitalMaturity?: number; sberNote?: string }>;
  region: string;
  regionId: string;
  regionInput: string;
  setRegionInput: (value: string) => void;
  onPick: (region: { id: string; name: string }) => void;
  onFree: (value: string) => void;
  selectedProfile?: {
    id: string;
    name: string;
    activeProjects: Array<{
      title?: string;
      amount?: string;
      sberOwner?: string;
      customerOwner?: string;
      notes?: string;
    }>;
    stakeholders: Array<{
      fullName?: string;
      role?: string;
      motivation?: string;
      redFlags?: string;
    }>;
    digitalMaturity?: number;
    sberNote?: string;
  };
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <FieldLabel icon={<Globe className="size-3.5" />} title="Регион" />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {regions.map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => onPick({ id: r.id, name: r.name })}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs transition",
              (regionId && regionId === r.id) || region === r.name
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted/50",
            )}
          >
            {r.name}
          </button>
        ))}
      </div>
      <Input
        placeholder="Или введите регион..."
        value={regionInput}
        onChange={(e) => {
          setRegionInput(e.target.value);
          onFree(e.target.value);
        }}
      />
      {/* Подсказка: если введён текст, которого нет в справочнике */}
      {regionInput.trim().length > 2 &&
        !regions.some(
          (r) =>
            r.name.toLowerCase() === regionInput.trim().toLowerCase() ||
            r.id === regionId,
        ) && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Регион «{regionInput.trim()}» не найден в справочнике.{" "}
            <a
              href="/regions/new"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              Создать карточку →
            </a>
          </p>
        )}
      {allowEmpty && !regionInput.trim() && (
        <FieldHint>Оставьте пустым для федерального уровня</FieldHint>
      )}

      {/* Если выбран регион из справочника — показываем контекст */}
      {selectedProfile && (
        <div className="mt-3 rounded-xl border bg-gradient-to-br from-muted/60 to-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold">Контекст региона и Сбера</p>
            </div>
            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
              из справочника
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <MiniStat
              label="ЛПР в карточке"
              value={`${selectedProfile.stakeholders.length}`}
            />
            <MiniStat
              label="Активных проектов"
              value={`${selectedProfile.activeProjects.length}`}
            />
            {selectedProfile.digitalMaturity && (
              <MiniStat
                label="Цифровая зрелость"
                value={`${selectedProfile.digitalMaturity}/5`}
              />
            )}
          </div>
          {selectedProfile.sberNote && (
            <p className="mt-2 line-clamp-2 text-[11px] italic leading-snug text-muted-foreground">
              {selectedProfile.sberNote}
            </p>
          )}
          <RegionDataHints profile={selectedProfile} />
        </div>
      )}
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
    ...projectGaps.map((project) => `проект «${project.title || "без названия"}»: сумма, владельцы, статус или заметка`),
    ...stakeholderGaps.map((person) => `ЛПР ${person.fullName || "без ФИО"}: мотивация и риск отказа`),
  ];

  if (!gaps.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50/60 p-2.5 text-[11px] dark:border-amber-900/40 dark:bg-amber-950/20">
      <p className="font-semibold text-amber-800 dark:text-amber-200">
        Перед генерацией можно дополнить карточку
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
        className="mt-1.5 inline-block font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
      >
        Открыть регион
      </a>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

// ── Share field ─────────────────────────────────────────────────────────────

function ShareField({
  form,
}: {
  form: ReturnType<typeof useSessionForm>["form"];
}) {
  const [input, setInput] = useState("");
  const value = form.watch("sharedWith") ?? [];

  function add() {
    const clean = input.trim();
    if (!clean) return;
    const bag = new Set([...(value ?? []), clean]);
    form.setValue("sharedWith", Array.from(bag), { shouldValidate: false });
    setInput("");
  }
  function remove(target: string) {
    form.setValue(
      "sharedWith",
      (value ?? []).filter((v) => v !== target),
      { shouldValidate: false },
    );
  }

  return (
    <div>
      <FieldLabel icon={<UsersRound className="size-3.5" />} title="Поделиться с коллегами" />
      <div className="flex gap-2">
        <Input
          placeholder="email или имя"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="default" onClick={add}>
          Добавить
        </Button>
      </div>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-lg border bg-background px-2 py-0.5 text-xs"
            >
              {v}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => remove(v)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <FieldHint>Они получат ссылку для просмотра после создания сессии</FieldHint>
    </div>
  );
}
