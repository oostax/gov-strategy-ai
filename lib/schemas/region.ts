import { z } from "zod";

// ── Вложенные сущности ───────────────────────────────────────────────────────

export const stakeholderRoleOptions = [
  "губернатор",
  "зампред по цифре",
  "Минцифры",
  "Минфин",
  "Минэкономики",
  "отраслевой министр",
  "мэр",
  "руководитель ГУП/МУП",
  "ректор вуза",
  "ключевой ЛПР бизнеса",
  "прочее",
] as const;

export const stakeholderSchema = z.object({
  id: z.string(),
  fullName: z.string().min(2, "ФИО"),
  role: z.string().min(2, "Должность / роль"),
  department: z.string().optional(),
  motivation: z.string().optional(), // что он хочет, его KPI
  redFlags: z.string().optional(),   // чего боится, триггеры отказа
  relationship: z.enum(["cold", "warm", "hot"]).optional(),
  notes: z.string().optional(),
});

export const projectStageOptions = [
  "discovery",
  "pilot",
  "rollout",
  "active",
  "paused",
  "lost",
] as const;

export const sberProjectSchema = z.object({
  id: z.string(),
  product: z.string().min(1, "Продукт Сбера"),
  title: z.string().min(2, "Краткое название инициативы"),
  stage: z.enum(projectStageOptions),
  amount: z.string().optional(),
  sberOwner: z.string().optional(),   // ответственный со стороны Сбера
  customerOwner: z.string().optional(), // контакт со стороны региона
  startedAt: z.string().optional(),
  notes: z.string().optional(),
});

export const pastEngagementOutcomeOptions = [
  "won",
  "declined",
  "postponed",
  "abandoned",
] as const;

export const pastEngagementSchema = z.object({
  id: z.string(),
  topic: z.string().min(2, "О чём шла речь"),
  outcome: z.enum(pastEngagementOutcomeOptions),
  reason: z.string().optional(), // почему такой исход
  date: z.string().optional(),
});

export const strategicPrioritySchema = z.object({
  id: z.string(),
  title: z.string().min(2, "Короткая формулировка приоритета"),
  source: z.string().optional(), // откуда взят: стратегия СЭР, указ губернатора, нацпроект
});

export const regionNewsSchema = z.object({
  id: z.string(),
  title: z.string().min(2, "Заголовок / суть"),
  source: z.string().optional(),
  url: z.string().url().or(z.literal("")).optional(),
  date: z.string().optional(),
});

// ── Черновик из открытых источников ───────────────────────────────────────────
// Автозаполнение карточки региона веб-поиском. Хранится отдельно от
// подтверждённых полей: в генерацию идёт только как гипотеза, пока человек
// не нажал «Принять» (тогда элемент переезжает в основной массив).

export const regionDraftSchema = z.object({
  generatedAt: z.string(),
  status: z.enum(["ready", "generating"]).default("ready"),
  sources: z.array(z.string()).default([]),
  // Контекстные поля (скаляры) — предлагаются автозаполнением, принимаются по одному.
  federalDistrict: z.string().optional(),
  population: z.string().optional(),
  digitalMaturity: z.number().min(1).max(5).optional(),
  digitalMaturityNote: z.string().optional(),
  budgetProfile: z.string().optional(),
  budgetCycle: z.string().optional(),
  topPriorities: z.array(strategicPrioritySchema).default([]),
  painPoints: z.array(z.string()).default([]),
  news: z.array(regionNewsSchema).default([]),
  stakeholders: z.array(stakeholderSchema).default([]),
});

// ── Ключевая сущность ────────────────────────────────────────────────────────

export const regionProfileSchema = z.object({
  id: z.string(),
  slug: z.string().min(2),
  name: z.string().min(2),
  federalDistrict: z.string().optional(),
  population: z.string().optional(),

  // ── Слой региональной стратегии ───────────────────────────────────────────
  digitalMaturity: z.number().min(1).max(5).optional(),
  digitalMaturityNote: z.string().optional(),
  budgetProfile: z.string().optional(),
  budgetCycle: z.string().optional(),
  topPriorities: z.array(strategicPrioritySchema).default([]),
  federalProjects: z.array(z.string()).default([]),
  painPoints: z.array(z.string()).default([]),
  news: z.array(regionNewsSchema).default([]),
  stakeholders: z.array(stakeholderSchema).default([]),

  // ── Слой портфеля Сбера ────────────────────────────────────────────────────
  keyAccountManager: z.string().optional(),
  relationshipManager: z.string().optional(),
  activeProjects: z.array(sberProjectSchema).default([]),
  pastEngagements: z.array(pastEngagementSchema).default([]),
  relevantProducts: z.array(z.string()).default([]),
  quarterlyPriorities: z.array(z.string()).default([]),
  sberNote: z.string().optional(),

  // ── Черновик из открытых источников (непроверенный, до подтверждения) ──────
  draft: regionDraftSchema.optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createRegionInputSchema = regionProfileSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    slug: z.string().min(2, "Slug вроде 'tatarstan'"),
    name: z.string().min(2, "Название региона"),
  });

export const updateRegionInputSchema = createRegionInputSchema.partial();

export type Stakeholder = z.infer<typeof stakeholderSchema>;
export type SberProject = z.infer<typeof sberProjectSchema>;
export type PastEngagement = z.infer<typeof pastEngagementSchema>;
export type StrategicPriority = z.infer<typeof strategicPrioritySchema>;
export type RegionNews = z.infer<typeof regionNewsSchema>;
export type RegionProfile = z.infer<typeof regionProfileSchema>;
export type RegionDraft = z.infer<typeof regionDraftSchema>;
export type CreateRegionInput = z.infer<typeof createRegionInputSchema>;
export type UpdateRegionInput = z.infer<typeof updateRegionInputSchema>;

// ── Лейблы для UI ────────────────────────────────────────────────────────────

export const stageLabels: Record<(typeof projectStageOptions)[number], string> = {
  discovery: "В проработке",
  pilot: "Пилот",
  rollout: "Масштабирование",
  active: "Активный контракт",
  paused: "На паузе",
  lost: "Проигран",
};

export const stageColors: Record<(typeof projectStageOptions)[number], string> = {
  discovery: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  pilot: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  rollout: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  paused: "bg-muted text-muted-foreground",
  lost: "bg-destructive/10 text-destructive",
};

export const outcomeLabels: Record<(typeof pastEngagementOutcomeOptions)[number], string> = {
  won: "Выиграли",
  declined: "Отклонили",
  postponed: "Отложено",
  abandoned: "Оставлено",
};

export const relationshipLabels: Record<"cold" | "warm" | "hot", string> = {
  cold: "Холодный",
  warm: "Тёплый",
  hot: "Рабочий",
};

/** Короткое резюме региона одной строкой — для UI */
export function getRegionSummary(region: RegionProfile): string {
  const parts: string[] = [];
  if (region.digitalMaturity) parts.push(`Цифровая зрелость ${region.digitalMaturity}/5`);
  if (region.activeProjects.length) parts.push(`${region.activeProjects.length} активных проект(а/ов) Сбера`);
  if (region.stakeholders.length) parts.push(`${region.stakeholders.length} ЛПР в карточке`);
  return parts.join(" · ");
}
