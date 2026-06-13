"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Globe,
  Loader2,
  Map,
  MapPin,
  MessageSquareText,
  Mic,
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

export default function NewSessionPage() {
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
    setStep,
    validateCurrentStep,
    applySuggestion,
  } = useSessionForm();

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

  function goToStep(n: number) {
    setStep(n);
    forceUpdate((v) => v + 1);
    // Scroll to top for mobile
    window.scrollTo(0, 0);
  }

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

  return (
    <AppShell>
      <div className="mx-auto max-w-lg space-y-4">
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
                    {classifying ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                    Подготовить черновик
                  </Button>
                </div>
              </div>
              <button type="button" onClick={() => { goToStep(1); }} className="w-full rounded-xl border bg-background px-4 py-3 text-sm font-medium active:bg-muted">
                Заполнить вручную
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
                    // Прячем дропдаун, если единственная подсказка уже выбрана.
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
              <Field label="Объём">
                <div className="grid grid-cols-3 gap-2">
                  {(["short", "medium", "deep"] as const).map((v) => (
                    <button type="button" key={v} onClick={() => form.setValue("detailLevel", v, { shouldValidate: true })}
                      className={cn("rounded-xl border p-2.5 text-center text-xs font-semibold transition", detailLevel === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/50")}>
                      {v === "short" ? "Коротко" : v === "medium" ? "Средне" : "Глубоко"}
                    </button>
                  ))}
                </div>
              </Field>

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
              <button type="button" disabled={loading} onClick={form.handleSubmit(submit)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50 active:bg-primary/90">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Создать
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
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
    ...stakeholderGaps.map((person) => `ЛПР ${person.fullName || "без ФИО"}: мотивация и риск отказа`),
  ];

  if (!gaps.length) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900/40 dark:bg-amber-950/20">
      <p className="font-semibold text-amber-800 dark:text-amber-200">
        Чтобы агент дал более точный материал
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
