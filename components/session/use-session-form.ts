"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  createSessionSchema,
  roleDefaultAudience,
  taskDefaultFormat,
  taskIsMeeting,
  taskNeedsHorizon,
  type CreateSessionInput,
  type TaskType,
} from "@/lib/schemas/session";

// ── Шаги визарда ─────────────────────────────────────────────────────────────

/**
 * Новая структура шагов:
 *   0. "Быстрый старт" — голос / фраза / шаблон (пропускаемый)
 *   1. "Тип материала" — выбор типа материала
 *   2. "О встрече" или "Задача" — зависит от типа
 *   3. "Детали"        — срочность, формат, объём, доп.блоки, share
 *
 * Быстрый старт всегда присутствует как нулевой шаг, но руководитель
 * может пропустить его одним кликом.
 */
export function getStepsForTask(taskType: TaskType): string[] {
  const base = ["Быстрый старт", "Тип материала"];
  if (taskIsMeeting(taskType)) return [...base, "О встрече", "Детали"];
  return [...base, "Задача", "Детали"];
}

const defaults: CreateSessionInput = {
  userRole: "sales_lead",
  taskType: "meeting_preparation",
  audience: roleDefaultAudience["sales_lead"],
  horizon: "12_months",
  region: "",
  regionId: "",
  focusTopic: "",
  title: "",
  meetingWith: "",
  meetingDate: "",
  meetingGoal: "",
  meetingContext: "",
  detailLevel: "medium",
  outputFormat: taskDefaultFormat["meeting_preparation"],
  urgency: "24h",
  deliveryFormat: "workspace",
  constraints: [],
  sharedWith: [],
};

// ── Хук ──────────────────────────────────────────────────────────────────────

export function useSessionForm(onSuccess?: () => void) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [regionInput, setRegionInput] = useState("");

  const form = useForm<CreateSessionInput>({
    resolver: zodResolver(createSessionSchema),
    defaultValues: defaults,
  });

  const userRole = useWatch({ control: form.control, name: "userRole" });
  const taskType = useWatch({ control: form.control, name: "taskType" });
  const horizon = useWatch({ control: form.control, name: "horizon" });
  const detailLevel = useWatch({ control: form.control, name: "detailLevel" });
  const urgency = useWatch({ control: form.control, name: "urgency" });
  const deliveryFormat = useWatch({ control: form.control, name: "deliveryFormat" });
  const region = useWatch({ control: form.control, name: "region" });
  const regionId = useWatch({ control: form.control, name: "regionId" });
  const selectedConstraints = useWatch({ control: form.control, name: "constraints" });

  const steps = useMemo(() => getStepsForTask(taskType), [taskType]);
  const progress = useMemo(() => ((step + 1) / steps.length) * 100, [step, steps]);

  // При смене роли — обновляем аудиторию
  useEffect(() => {
    form.setValue("audience", roleDefaultAudience[userRole], { shouldValidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // При смене типа задачи — обновляем формат. Шаг НЕ сбрасываем, чтобы
  // one-shot/голос оставался на своей позиции после переключения.
  useEffect(() => {
    form.setValue("outputFormat", taskDefaultFormat[taskType], { shouldValidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskType]);

  async function submit(values: CreateSessionInput) {
    setLoading(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await response.json()) as {
        session?: { id: string };
        error?: string;
      };
      if (!response.ok || !data.session)
        throw new Error(data.error || "Не удалось создать сессию");
      toast.success("Сессия создана");
      onSuccess?.();
      setStep(0);
      form.reset(defaults);
      setRegionInput("");
      router.push(`/sessions/${data.session.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка создания сессии");
    } finally {
      setLoading(false);
    }
  }

  function toggleConstraint(value: string) {
    const current = selectedConstraints ?? [];
    form.setValue(
      "constraints",
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
      { shouldValidate: true },
    );
  }

  function selectRegion(value: string, id?: string) {
    if (region === value && (!id || id === regionId)) {
      form.setValue("region", "", { shouldValidate: false });
      form.setValue("regionId", "", { shouldValidate: false });
      setRegionInput("");
    } else {
      form.setValue("region", value, { shouldValidate: false });
      form.setValue("regionId", id ?? "", { shouldValidate: false });
      setRegionInput(value);
    }
  }

  async function goToStep(targetStep: number) {
    if (targetStep <= step) {
      setStep(targetStep);
      return;
    }
    const valid = await validateCurrentStep();
    if (valid) setStep(targetStep);
  }

  async function goNext() {
    const valid = await validateCurrentStep();
    if (valid) setStep((s) => s + 1);
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function validateCurrentStep(): Promise<boolean> {
    const currentStepName = steps[step];
    if (currentStepName === "Задача") {
      return form.trigger("focusTopic");
    }
    if (currentStepName === "О встрече") {
      return form.trigger(["focusTopic"]);
    }
    return true;
  }

  /**
   * Применяет результат one-shot классификатора в форму.
   * Ничего не очищает, только заполняет то, что пришло.
   */
  function applySuggestion(suggestion: Partial<CreateSessionInput>) {
    const keys = Object.keys(suggestion) as Array<keyof CreateSessionInput>;
    for (const key of keys) {
      const value = suggestion[key];
      if (value === undefined || value === "" || value === null) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.setValue(key, value as any, { shouldValidate: false });
    }
    if (typeof suggestion.region === "string" && suggestion.region) {
      setRegionInput(suggestion.region);
    }
  }

  return {
    form,
    step,
    steps,
    progress,
    loading,
    regionInput,
    setRegionInput,
    userRole,
    taskType,
    horizon,
    detailLevel,
    urgency,
    deliveryFormat,
    region,
    regionId,
    selectedConstraints,
    submit,
    toggleConstraint,
    selectRegion,
    goNext,
    goBack,
    goToStep,
    setStep,
    validateCurrentStep,
    applySuggestion,
    needsHorizon: taskNeedsHorizon(taskType),
    isMeeting: taskIsMeeting(taskType),
  };
}
