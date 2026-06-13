"use client";

import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Map,
  MessageSquareText,
  Route,
  Sparkles,
  Target,
  User,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RegionField } from "./region-field";
import {
  constraintOptions,
  horizons,
  taskFocusPlaceholder,
  taskLabels,
  taskOutputDescription,
  taskWhenToUse,
  type TaskType,
} from "@/lib/schemas/session";
import { cn } from "@/lib/utils";
import { useSessionForm } from "./use-session-form";

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

const popularRegions = [
  "Москва", "Санкт-Петербург", "Татарстан", "Московская область",
  "Краснодарский край", "Свердловская область", "Нижегородская область", "Самарская область",
];

const taskIcon: Record<TaskType, React.ComponentType<{ className?: string }>> = {
  meeting_preparation: UsersRound,
  meeting_followup:    ClipboardCheck,
  executive_brief:     BriefcaseBusiness,
  sber_region_strategy: Map,
  region_strategy:     Map,
  strategic_bets:      Target,
  scenario_analysis:   BarChart3,
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

export function SessionWizard({ compact = false }: { compact?: boolean }) {
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
    region,
    selectedConstraints,
    needsHorizon,
    isMeeting,
    submit,
    toggleConstraint,
    selectRegion,
    goNext,
    goBack,
    goToStep,
  } = useSessionForm();

  const currentStep = steps[step];
  const isFollowup = taskType === "meeting_followup";

  return (
    <Card id="new-session" className="overflow-hidden rounded-3xl shadow-sm">
      <CardHeader className={cn("border-b bg-primary text-primary-foreground pb-4", compact && "pb-3")}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-foreground text-primary">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-xl">Создать сессию</CardTitle>
              <p className="mt-1 text-sm text-primary-foreground/70">{currentStep}</p>
            </div>
          </div>
          <div className="rounded-full bg-primary-foreground px-3 py-1 text-sm font-medium text-primary tabular-nums">
            {step + 1} / {steps.length}
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-primary-foreground/15">
          <div
            className="h-full rounded-full bg-primary-foreground transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
          {steps.map((item, index) => (
            <button
              type="button"
              key={item}
              onClick={() => goToStep(index)}
              className={cn(
                "rounded-xl px-3 py-2 text-left text-xs transition",
                index === step
                  ? "bg-primary-foreground text-primary"
                  : "bg-primary-foreground/10 text-primary-foreground/75 hover:bg-primary-foreground/15"
              )}
            >
              <span className="font-semibold">{index + 1}. {item}</span>
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        <form
          onSubmit={form.handleSubmit(submit)}
          className="space-y-5"
          onKeyDown={(e) => {
            if (e.key === "Enter" && step < steps.length - 1) e.preventDefault();
          }}
        >
          {/* ШАГ 1: Тип материала */}
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
                      "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "bg-background hover:bg-muted/50"
                    )}
                  >
                    <span className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl",
                      active
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-semibold leading-tight", active && "text-primary-foreground")}>
                        {taskLabels[value]}
                      </p>
                      <p className={cn(
                        "mt-0.5 text-xs leading-tight",
                        active ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}>
                        {active ? taskOutputDescription[value] : taskWhenToUse[value]}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ШАГ 2а: О встрече */}
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
                  <FieldLabel icon={<CalendarClock className="size-3.5" />} title="Когда встреча" />
                  <Input
                    placeholder="16 мая, через два дня"
                    {...form.register("meetingDate")}
                  />
                  <FieldHint>Дата или срок — влияет на приоритизацию материала</FieldHint>
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

              <RegionField
                region={region}
                regionInput={regionInput}
                popular={popularRegions}
                onType={(value) => {
                  setRegionInput(value);
                  form.setValue("region", value, { shouldValidate: false });
                }}
                onSelect={selectRegion}
              />

              <div>
                <FieldLabel
                  icon={<MessageSquareText className="size-3.5" />}
                  title={isFollowup ? "Что обсуждали" : "Что уже знаете"}
                />
                <Textarea
                  rows={compact ? 2 : 3}
                  placeholder={
                    isFollowup
                      ? "Обсуждали платформу данных ЖКХ, он попросил показать кейсы из других регионов..."
                      : "Ранее обсуждали платформу данных, он скептически относится к ИИ..."
                  }
                  {...form.register("meetingContext")}
                />
                <FieldHint>
                  {isFollowup
                    ? "Ключевые моменты встречи — агент структурирует follow-up"
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
                  rows={compact ? 3 : 4}
                  placeholder={taskFocusPlaceholder[taskType]}
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

          {/* ШАГ 2б: Задача */}
          {currentStep === "Задача" && !isMeeting && (
            <div className="space-y-5">
              <div>
                <RegionField
                  region={region}
                  regionInput={regionInput}
                  popular={popularRegions}
                  onType={(value) => {
                    setRegionInput(value);
                    form.setValue("region", value, { shouldValidate: false });
                  }}
                  onSelect={selectRegion}
                />
                <FieldHint>Оставьте пустым для федерального уровня</FieldHint>
              </div>

              <div>
                <FieldLabel icon={<Target className="size-3.5" />} title="Задача" required />
                <Textarea
                  rows={compact ? 4 : 6}
                  placeholder={taskFocusPlaceholder[taskType]}
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

          {/* ШАГ 3: Детали */}
          {currentStep === "Детали" && (
            <div className="space-y-5">
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
                        onClick={() => form.setValue("horizon", opt.value, { shouldValidate: true })}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <FieldLabel icon={<BarChart3 className="size-3.5" />} title="Объём материала" />
                <div className="grid grid-cols-3 gap-2">
                  {detailOptions.map((opt) => (
                    <ToggleCard
                      key={opt.value}
                      active={detailLevel === opt.value}
                      title={opt.label}
                      sub={opt.sub}
                      onClick={() => form.setValue("detailLevel", opt.value, { shouldValidate: true })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel icon={<CalendarClock className="size-3.5" />} title="Название (необязательно)" />
                <Input
                  placeholder={isMeeting ? "Встреча с Минцифры Татарстана" : "Стратегия по ЦЭ на 2026"}
                  maxLength={60}
                  {...form.register("title")}
                />
                <FieldHint>Используется в списке сессий. Если не указано — подставляется из задачи.</FieldHint>
              </div>

              <div>
                <FieldLabel icon={<BookOpen className="size-3.5" />} title="Добавить в материал" />
                <div className={cn("grid gap-1.5", compact ? "" : "sm:grid-cols-2")}>
                  {constraintOptions.map((item) => {
                    const checked = selectedConstraints?.includes(item) ?? false;
                    return (
                      <button
                        type="button"
                        key={item}
                        onClick={() => toggleConstraint(item)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border p-2.5 text-left transition",
                          checked ? "border-primary/30 bg-primary/5" : "hover:bg-muted"
                        )}
                      >
                        <Checkbox checked={checked} className="shrink-0" />
                        <span className={cn("text-sm", checked && "font-medium")}>{item}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border bg-muted/30 p-3.5 space-y-1.5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Итого</p>
                <SummaryRow label="Материал" value={taskLabels[taskType]} />
                {region && <SummaryRow label="Регион" value={region} />}
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
                {selectedConstraints && selectedConstraints.length > 0 && (
                  <SummaryRow label="Доп. блоки" value={`${selectedConstraints.length} выбрано`} />
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between gap-3">
            <Button type="button" variant="outline" disabled={step === 0} onClick={goBack}>
              Назад
            </Button>
            {step < steps.length - 1 ? (
              <Button type="button" onClick={goNext}>
                Далее <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="button" disabled={loading} onClick={form.handleSubmit(submit)}>
                {loading ? <Sparkles className="size-4 animate-pulse" /> : <CheckCircle2 className="size-4" />}
                Создать сессию
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldLabel({ icon, title, required }: { icon: React.ReactNode; title: string; required?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {required && <span className="ml-0.5 text-xs text-destructive">*</span>}
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>;
}

function ToggleCard({ active, title, sub, onClick }: { active: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-0.5 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm",
        active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:bg-muted/50"
      )}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className={cn("text-xs leading-tight", active ? "text-primary-foreground/70" : "text-muted-foreground")}>{sub}</span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}
