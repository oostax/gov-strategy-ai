/**
 * Structured Output Schema — то, что модель ОБЯЗАНА вернуть.
 * Никакого свободного текста. Каждое поле — конкретный тип данных.
 * UI рендерит это напрямую без парсинга.
 */

// ── Ставка (для strategic_bets, region_strategy) ─────────────────────────────

export interface StrategyBet {
  id: string;
  type: "process" | "financial" | "technology" | "partnership" | "regulatory";
  title: string;           // «GigaChat как ассистент mos.ru»
  logic: string;           // Управленческая логика — 2-3 предложения
  sberProduct: string;     // Конкретный продукт Сбера
  sberAction2weeks: string; // Что делает Сбер в первые 2 недели
  goNoGo: string;          // Критерий запуска/остановки
  checkNeeded: string;     // Что нужно проверить
  recommended: boolean;    // Рекомендуемая ставка?
  // Опционально — для матрицы эффект/усилие (0-100). Если заданы, рисуем 2D-матрицу.
  impactScore?: number;    // Управленческий эффект, 0-100 (экспертная оценка)
  effortScore?: number;    // Сложность/затраты на реализацию, 0-100 (меньше = легче)
  horizonMonths?: number;  // За сколько месяцев виден результат
}

// ── Этап плана ───────────────────────────────────────────────────────────────

export interface PlanStage {
  id: string;
  week: string;            // «0-2 нед.», «3-4 нед.», «Май», «Q3»
  action: string;          // Что делаем
  owner: string;           // Кто отвечает
  deliverable: string;     // Что получаем на выходе
  doneWhen: string;        // Критерий завершения
  // Опционально — для наглядного план-графика
  isMilestone?: boolean;   // Веха
  isDecisionGate?: boolean; // Точка решения go/no-go ЛПР
  date?: string;           // Дата-чекпоинт, если есть
}

// ── Метрика ──────────────────────────────────────────────────────────────────

export interface Metric {
  id: string;
  name: string;            // «Время обработки обращения»
  formula: string;         // Как считать
  source: string;          // Где взять данные
  baseline: string;        // Текущее значение или «нужно снять»
  target: string;          // Целевое значение или «определить после пилота»
  // Опционально — числовые значения для дельта-бара «как есть → как будет»
  baselineValue?: number;  // Числовой baseline, если известен
  targetValue?: number;    // Числовая цель, если известна
  unit?: string;           // Единица измерения (%, мин, ₽, шт)
}

// ── Риск ─────────────────────────────────────────────────────────────────────

export interface Risk {
  id: string;
  title: string;           // «Vendor lock-in со стороны ДИТ»
  impact: "high" | "medium" | "low";
  mitigation: string;      // Как снять
  owner: string;           // Кто отвечает за снятие
  probability?: "high" | "medium" | "low"; // Вероятность (опц.) для сетки вероятность×влияние
}

// ── Следующий шаг ────────────────────────────────────────────────────────────

export interface NextStep {
  id: string;
  action: string;          // «Отправить письмо руководителю ДИТ»
  owner: string;           // «RM Госсектор»
  deadline: string;        // «До 15 мая» или «В течение 48 часов»
}

// ── Источник ─────────────────────────────────────────────────────────────────

export interface Source {
  title: string;
  url?: string;
  excerpt: string;
  isVerified: boolean;     // true = факт из источника, false = гипотеза
}

// ── Инфографика внутри материала ────────────────────────────────────────────

export interface VisualItem {
  label: string;
  value: number;           // 0-100 — нормализованная доля для длины бара/позиции
  description?: string;
  // Опционально — для реальных чисел и второй оси
  valueRaw?: number;       // Фактическое число (например 320), показывается с unit
  unit?: string;           // Единица измерения: «млн ₽», «%», «мин», «шт»
  x?: number;              // Координата X (0-100) — для матрицы (например реализуемость)
  y?: number;              // Координата Y (0-100) — для матрицы (например эффект)
  baseline?: number;       // Для сравнения «как есть → как будет»
  target?: number;
  tone?: "good" | "warn" | "bad" | "neutral"; // Цветовой акцент
}

export interface OutputVisual {
  id: string;
  title: string;
  type: "bar" | "matrix" | "funnel" | "scorecard";
  note?: string;
  // Подписи осей для матрицы
  xLabel?: string;
  yLabel?: string;
  items: VisualItem[];
}

// ── Предметная роль Сбера ───────────────────────────────────────────────────

export interface SberAction {
  id: string;
  asset: string;              // Продукт, компетенция или канал Сбера
  firstTwoWeeks: string;      // Что команда делает сразу
  dataNeeded: string;         // Какие данные нужны
  artifact: string;           // Что отдаем ЛПР / ВП
  commercialNextStep: string; // Какой следующий коммерческий/стратегический ход
}

// ── Вердикт и экономика для первого экрана ───────────────────────────────────

export interface Verdict {
  recommendation: "go" | "conditional-go" | "no-go"; // Рекомендуем / Условно / Не рекомендуем
  oneLineWhy: string;      // Одна строка обоснования
  confidence: "high" | "medium" | "low"; // Уверенность
  topCondition?: string;   // Ключевое условие для «условно»
}

export interface EconomicsSummary {
  capex?: string;          // Капзатраты, например «12 млн ₽»
  opex?: string;           // Операционные затраты в год
  expectedEffect?: string; // Ожидаемый эффект, например «40 млн ₽/год»
  payback?: string;        // Срок окупаемости, например «8 мес.»
  horizon?: string;        // Горизонт оценки, например «2026-2027»
  confidence?: "high" | "medium" | "low"; // Надёжность оценки
  note?: string;           // Оговорка (гипотеза / нужен baseline)
}

// ── Полный structured output ─────────────────────────────────────────────────

export interface StructuredOutput {
  // Первый экран — решение
  decision: string;        // 1-2 предложения: что делаем
  whyNow: string;          // Почему именно сейчас (1 предложение + источник)
  costOfInaction: string;  // Цена бездействия (1 предложение)
  sberRole: string;        // Роль Сбера одной фразой

  // Явный вердикт и экономика (опционально — старые данные продолжают рендериться)
  verdict?: Verdict;
  economics?: EconomicsSummary;

  // Ставки (для strategic_bets, region_strategy)
  bets: StrategyBet[];

  // План
  plan: PlanStage[];

  // Метрики
  metrics: Metric[];

  // Риски
  risks: Risk[];

  // Следующие шаги (конкретные действия с владельцами и сроками)
  nextSteps: NextStep[];

  // Конкретное участие Сбера
  sberActions?: SberAction[];

  // Инфографика — графики и матрицы по сути документа
  visuals?: OutputVisual[];

  // Источники
  sources: Source[];

  // Гипотезы — что нужно проверить
  hypotheses: string[];
}

// ── Адаптации под тип задачи ─────────────────────────────────────────────────

// Для meeting_preparation — другая структура первого экрана
export interface MeetingOutput {
  // Первый экран
  meetingGoal: string;     // Что хотим получить
  mainThesis: string;      // Главный тезис Сбера
  leaveAfter: string;      // Что оставляем после встречи

  // Сценарий встречи
  agenda: AgendaBlock[];

  // Возражения
  objections: Objection[];

  // Что предлагаем
  proposal: string;
  artifact: string;        // Что оставляем (1-страничник, расчёт, демо)

  // После встречи
  ifYes: NextStep[];       // Если согласились
  ifPause: NextStep[];     // Если взяли паузу
  ifNo: NextStep[];        // Если отказали

  sberActions?: SberAction[];
  visuals?: OutputVisual[];

  // Источники
  sources: Source[];
  hypotheses: string[];
}

export interface AgendaBlock {
  id: string;
  time: string;            // «0-5 мин», «5-15 мин»
  topic: string;           // О чём говорим
  sberSays: string;        // Что говорит Сбер
  askLpr: string;          // Что спрашиваем у ЛПР
  fixDecision: string;     // Какое решение фиксируем
}

export interface Objection {
  id: string;
  objection: string;       // Что скажет ЛПР
  response: string;        // Что отвечаем
  factNeeded: string;      // Какой факт нужен для подтверждения
}

// ── Для executive_brief — ещё короче ─────────────────────────────────────────

export interface BriefOutput {
  decision: string;        // Решение (1 абзац)
  evidence: string[];      // 3-5 фактов с источниками
  economics: string;       // Экономика одной формулой
  risks: Risk[];
  nextStep: NextStep;      // Один конкретный шаг
  sberActions?: SberAction[];
  visuals?: OutputVisual[];
  sources: Source[];
}

// ── Для region_strategy / sber_region_strategy — региональный анализ ────────

export interface RegionSummary {
  name: string;
  federalDistrict: string;
  population: string;
  budgetTotal: string;
  digitalMaturity: string;
  oneLiner: string;
}

export interface IndustryBreakdown {
  id: string;
  name: string;
  shareInGDP: string;
  keyPlayers: string;
  currentDigitalState: string;
  painPoints: string[];
  sberRelevance: string;
  dataNeeded: string;
}

export interface BudgetProgram {
  id: string;
  name: string;
  owner: string;
  budget: string;
  status: string;
  sberRelevance: string;
}

export interface BudgetLandscape {
  totalBudget: string;
  itShare: string;
  keyPrograms: BudgetProgram[];
  upcomingTenders: string;
  dataNeeded: string;
}

export interface RegionStakeholder {
  id: string;
  name: string;
  role: string;
  department: string;
  motivation: string;
  pain: string;
  relationshipToSber: string;
  redFlags: string;
  howToEngage: string;
}

export interface Competitor {
  id: string;
  vendor: string;
  product: string;
  where: string;
  stage: string;
  threatLevel: string;
  sberAdvantage: string;
}

export interface EntryPoint {
  id: string;
  regionNeed: string;
  sberCapability: string;
  stakeholder: string;
  firstAction: string;
  confidence: string;
}

export interface DataGap {
  id: string;
  question: string;
  howToGet: string;
  priority: string;
  owner: string;
}

export interface RegionAnalysisOutput {
  regionSummary: RegionSummary;
  industryBreakdown: IndustryBreakdown[];
  budgetLandscape: BudgetLandscape;
  stakeholderMap: RegionStakeholder[];
  competitiveLandscape: Competitor[];
  entryPoints: EntryPoint[];
  strategicPriorities: {
    confirmed: string[];
    hypothesized: string[];
    source: string;
  };
  dataGaps: DataGap[];
  risks: Risk[];
  nextSteps: NextStep[];
  visuals?: OutputVisual[];
  sources: Source[];
  hypotheses: string[];
}

// ── Union type ───────────────────────────────────────────────────────────────

export type TypedOutput =
  | { kind: "strategy"; data: StructuredOutput }
  | { kind: "meeting"; data: MeetingOutput }
  | { kind: "brief"; data: BriefOutput }
  | { kind: "region"; data: RegionAnalysisOutput };
