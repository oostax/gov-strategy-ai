import { z } from "zod";

export const userRoles = [
  "vice_president",
  "direction_head",
  "sales_lead",
  "analyst",
  "product_lead",
  "project_office",
] as const;

/**
 * Типы материалов — 6 штук, в порядке частоты использования
 * руководителем департамента по работе с госсектором.
 *
 * Убраны: roadmap (редко, следствие решения), product_hypothesis (не его задача)
 * Добавлен: meeting_followup (после каждой встречи)
 * Переименованы под язык руководителя, не аналитика
 */
export const taskTypes = [
  "meeting_preparation",  // 3-5 раз/нед — подготовка к встрече с ЛПР
  "meeting_followup",     // после каждой встречи — фиксация договорённостей
  "executive_brief",      // 1-2 раза/нед — позиция для ВП / правления
  "sber_region_strategy", // 1-2 раза/мес — стратегия Сбера в регионе (портфель + заход)
  "region_strategy",      // 1-2 раза/мес — анализ региона, первый заход
  "strategic_bets",       // 1 раз/квартал — выбор направления
  "scenario_analysis",    // редко — сценарии при смене регулирования
] as const;

export const horizons = ["3_months", "12_months", "2028", "2030"] as const;
export const detailLevels = ["short", "medium", "deep"] as const;

/** Срочность задачи. Влияет на тон, объём и подбор playbook'ов. */
export const urgencyLevels = ["2_hours", "today", "24h", "week", "flex"] as const;
export type UrgencyLevel = (typeof urgencyLevels)[number];

export const urgencyLabels: Record<UrgencyLevel, string> = {
  "2_hours": "Через 2 часа",
  today: "Сегодня",
  "24h": "В течение 24 часов",
  week: "В течение недели",
  flex: "Без жёстких сроков",
};

export const urgencySubLabels: Record<UrgencyLevel, string> = {
  "2_hours": "Срочный режим · тезисы без углублённого анализа",
  today: "Сжатый формат с фокусом на главном",
  "24h": "Стандартный режим подготовки",
  week: "Возможна глубокая проработка",
  flex: "Плановая работа",
};

/** Формат, в котором результат будет использован. Меняет рендер и экспорт. */
export const deliveryFormats = [
  "workspace",
  "docx",
  "pptx",
  "email",
  "messenger",
] as const;
export type DeliveryFormat = (typeof deliveryFormats)[number];

export const deliveryFormatLabels: Record<DeliveryFormat, string> = {
  workspace: "Рабочая среда",
  docx: "Word (.docx)",
  pptx: "Презентация (.pptx)",
  email: "Письмо вице-президенту",
  messenger: "Сообщение команде",
};

export const deliveryFormatSubLabels: Record<DeliveryFormat, string> = {
  workspace: "Просмотр и доработка в системе",
  docx: "Готовый документ",
  pptx: "Структура слайдов",
  email: "Краткое письмо",
  messenger: "Одним сообщением",
};

export const outputFormats = [
  "brief",
  "strategy",
  "roadmap",
  "presentation_outline",
  "memo",
] as const;

// Типы задач, которым НЕ нужен горизонт планирования
export const taskTypesWithoutHorizon: TaskType[] = [
  "meeting_preparation",
  "meeting_followup",
  "executive_brief",
  "strategic_bets",  // руководитель думает задачей, не горизонтом
];

// Типы задач со специфическими полями встречи
export const meetingTaskTypes: TaskType[] = [
  "meeting_preparation",
  "meeting_followup",
];

export const sessionProfileSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  userRole: z.enum(userRoles),
  taskType: z.enum(taskTypes),
  audience: z.string().min(2),
  horizon: z.enum(horizons),
  region: z.string().optional(),
  /** ID региона в справочнике (если выбран из списка) — для точного резолва */
  regionId: z.string().optional(),
  focusTopic: z.string().optional(),
  meetingWith: z.string().optional(),
  meetingDate: z.string().optional(),
  meetingGoal: z.string().optional(),
  meetingContext: z.string().optional(),
  detailLevel: z.enum(detailLevels),
  outputFormat: z.enum(outputFormats),
  urgency: z.enum(urgencyLevels),
  deliveryFormat: z.enum(deliveryFormats),
  constraints: z.array(z.string()),
  /** Коллеги, с которыми хочется поделиться сессией (email-адреса) */
  sharedWith: z.array(z.string()),
  /** Публичный токен для read-only ссылки */
  shareToken: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createSessionSchema = sessionProfileSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    audience: z.string().min(2, "Укажите аудиторию результата"),
    focusTopic: z.string().min(3, "Опишите задачу"),
    title: z.string().max(60, "Не более 60 символов").optional(),
    meetingWith: z.string().optional(),
    meetingDate: z.string().optional(),
    meetingGoal: z.string().optional(),
    meetingContext: z.string().optional(),
  });

export type UserRole = (typeof userRoles)[number];
export type TaskType = (typeof taskTypes)[number];
export type Horizon = (typeof horizons)[number];
export type DetailLevel = (typeof detailLevels)[number];
export type OutputFormat = (typeof outputFormats)[number];
export type SessionProfile = z.infer<typeof sessionProfileSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// ── Метки ────────────────────────────────────────────────────────────────────

export const roleLabels: Record<UserRole, string> = {
  vice_president: "Вице-президент",
  direction_head: "Руководитель направления",
  sales_lead: "Продажи по регионам",
  analyst: "Аналитик",
  product_lead: "Продуктовый лидер",
  project_office: "Проектный офис",
};

/** Названия на языке руководителя, не аналитика */
export const taskLabels: Record<TaskType, string> = {
  meeting_preparation: "Подготовка встречи",
  meeting_followup:    "После встречи",
  executive_brief:     "Позиция для ВП",
  sber_region_strategy: "Стратегия Сбера в регионе",
  region_strategy:     "Анализ региона",
  strategic_bets:      "Выбор направления",
  scenario_analysis:   "Сценарии",
};

/** Что получится на выходе — одна строка */
export const taskOutputDescription: Record<TaskType, string> = {
  meeting_preparation: "Досье ЛПР · тезисы · сценарий · возражения",
  meeting_followup:    "Договорённости · ответственные · следующий шаг",
  executive_brief:     "1 страница: позиция → обоснование → решение",
  sber_region_strategy: "Портфель Сбера · ЛПР · план захода · продукты",
  region_strategy:     "ЛПР · боли региона · проекты Сбера · точка входа",
  strategic_bets:      "3 направления с выбором · пилот · метрики",
  scenario_analysis:   "3 сценария · триггеры · позиция Сбера в каждом",
};

/** Когда это нужно — одна строка, язык руководителя */
export const taskWhenToUse: Record<TaskType, string> = {
  meeting_preparation: "Встреча с губернатором, Минцифры, ЛПР",
  meeting_followup:    "Зафиксировать итоги и договорённости",
  executive_brief:     "Согласование с ВП или правлением",
  sber_region_strategy: "Обновить стратегию Сбера по региону",
  region_strategy:     "Первый заход или обновление позиции по региону",
  strategic_bets:      "Нужно выбрать куда идти в следующем периоде",
  scenario_analysis:   "Меняется 44-ФЗ, нацпроект или бюджетный цикл",
};

/** Placeholder для главного поля задачи */
export const taskFocusPlaceholder: Record<TaskType, string> = {
  meeting_preparation:
    "Что хотим обсудить, какие вопросы поднять, что оставить заказчику после встречи",
  meeting_followup:
    "Кратко: о чём договорились, что осталось открытым, что нужно сделать в ближайшие 48 часов",
  executive_brief:
    "Например: позиция Сбера по переходу на отечественное ПО — для согласования с ВП на следующей неделе",
  sber_region_strategy:
    "Например: обновить стратегию Сбера в Татарстане — что продаём, кому, через кого, какие пилоты запускаем в Q3",
  region_strategy:
    "Например: готовим первый заход в Татарстан — нужен анализ ключевых ЛПР, текущих проектов и точки входа",
  strategic_bets:
    "Например: в каких направлениях Сбер может усилить позиции в госсекторе в 2025–2026? Уже рассматривали ЦЭ и ГЧП",
  scenario_analysis:
    "Например: три сценария для Сбера при изменении 44-ФЗ — что делаем в каждом, где наша позиция",
};

/** Дополнительные блоки — только релевантные для госсектора */
export const constraintOptions = [
  "Добавить экономический эффект",
  "Добавить риски и меры по их снижению",
  "Добавить ключевых лиц и стейкхолдеров",
  "Добавить план первого захода",
  "Добавить аргументы для Минфина",
  "Добавить аргументы для Минцифры",
  "Добавить сравнение с другими регионами",
  "Без технических деталей",
];

/** Аудитория по умолчанию для каждой роли */
export const roleDefaultAudience: Record<UserRole, string> = {
  vice_president: "Правление и ВП блока",
  direction_head: "ВП и руководители блока",
  sales_lead: "Региональные команды и клиенты",
  analyst: "Руководитель направления",
  product_lead: "Продуктовая команда и стейкхолдеры",
  project_office: "Проектный комитет",
};

/** Формат вывода по умолчанию */
export const taskDefaultFormat: Record<TaskType, OutputFormat> = {
  meeting_preparation: "presentation_outline",
  meeting_followup:    "brief",
  executive_brief:     "brief",
  sber_region_strategy: "strategy",
  region_strategy:     "strategy",
  strategic_bets:      "strategy",
  scenario_analysis:   "memo",
};

/** Показывать ли горизонт планирования */
export function taskNeedsHorizon(taskType: TaskType): boolean {
  return !taskTypesWithoutHorizon.includes(taskType);
}

/** Показывать ли специфические поля встречи */
export function taskIsMeeting(taskType: TaskType): boolean {
  return meetingTaskTypes.includes(taskType);
}

/** Получить короткое название сессии */
export function getSessionTitle(session: { title?: string; focusTopic?: string }): string {
  return session.title?.trim() || session.focusTopic?.slice(0, 60) || "Без названия";
}
