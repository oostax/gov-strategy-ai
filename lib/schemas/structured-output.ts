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

// ── Тиерная модель честности (meeting) ──────────────────────────────────────
// Каждый факт помечается источником: откуда он взят и насколько ему можно верить.
// fact       — факт из открытых источников (со ссылкой)
// hypothesis — гипотеза модели, выведенная из фактов
// crm        — из карточки региона / истории Сбера (не из интернета)
// ask        — то, что нужно спросить на встрече (не выдумываем)
export type SourceTier = "fact" | "hypothesis" | "crm" | "ask";

// Бюджетное окно ведомства: блок «сигнал / напряжение / вывод» (как в анализе региона).
export interface MinistryBudgetWindow {
  signal: string;          // Что видно на поверхности (бюджет, динамика ИТ-расходов)
  tension: string;         // Где напряжение (дефицит, приоритеты)
  decision: string;        // Вывод для встречи — как заходить
  sources?: Source[];      // Ссылки на открытые источники
}

// Стат-карточка портрета ведомства (дефицит, объём обращений, доля ИТ-закупок).
export interface MinistryStat {
  id?: string;
  label: string;           // Короткая подпись метрики
  value: string;           // Значение с единицей, напр. «13,85 млрд ₽»
  caption: string;         // Пояснение, что это значит для встречи
  tier: SourceTier;
  source?: Source;         // Источник (для tier="fact")
}

// Инициатива ведомства (зацепка) или уже внедрённое решение (конкурент / точка интеграции).
export interface MinistryItem {
  id?: string;
  title: string;           // Название инициативы / системы
  detail: string;          // Что это и почему важно для встречи
  tier: SourceTier;
  source?: Source;
}

// ЯДРО дашборда — портрет ведомства и повестки (собирается из открытых источников).
export interface MinistryPortrait {
  budgetWindow?: MinistryBudgetWindow;
  stats?: MinistryStat[];       // Стат-карточки
  initiatives?: MinistryItem[]; // Что ведомство уже делает (зацепки)
  incumbents?: MinistryItem[];  // Что уже внедрено = конкуренты / точки интеграции
}

// Тиерная плитка досье ЛПР — известно / мотив / отношение / спросить.
export interface LprTile {
  text: string;
  tier: SourceTier;
  source?: Source;
}

// Досье ЛПР — тонкий честный тиерный слой (не выдуманная анкета).
export interface LprDossier {
  name?: string;                 // ФИО — только из источников/ввода, иначе опустить
  role?: string;                 // Должность
  known?: LprTile;               // Что известно (tier="fact")
  motive?: LprTile;              // Мотив / зона решений (tier="hypothesis")
  relationship?: LprTile;        // Отношение к Сберу (tier="crm")
  ask?: LprTile;                 // Добрать на встрече (tier="ask")
}

// Участник встречи для карты участников.
export interface MeetingParticipant {
  id?: string;
  name?: string;                 // ФИО или опустить, если не подтверждено
  role: string;                  // Роль в встрече (структурный факт)
  stance: "ally" | "skeptic" | "neutral";
  whatMatters: string;           // Что для него важно / как с ним работать
  tier: SourceTier;
}

// Тезис под повестку ЛПР, привязанный к конкретному факту.
export interface MeetingThesis {
  id?: string;
  text: string;                  // Сам тезис
  tiedTo: string;                // К какому факту/KPI ЛПР привязан
  evidence: string;              // Доказательная база / как считаем эффект
  tier: SourceTier;
}

// Исход встречи с сигналом-триггером и что зафиксировать.
export interface MeetingOutcome {
  triggerSignal: string;         // Как понять, что мы в этом исходе
  steps: NextStep[];             // Что делаем
  whatToCapture: string;         // Что зафиксировать письменно
}

export interface MeetingAfter {
  outcomes?: {
    ifYes?: MeetingOutcome;
    ifPause?: MeetingOutcome;
    ifNo?: MeetingOutcome;
  };
  first48h?: NextStep[];         // Первые 48 часов после встречи
}

// Лестница запросов: максимум / цель / минимум.
export interface AskLadder {
  max?: string;
  target?: string;
  min?: string;
}

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

  // ── Новые опциональные поля тиерной модели (старые сессии рендерятся без них) ──
  askLadder?: AskLadder;             // Лестница запросов (максимум / цель / минимум)
  ministryPortrait?: MinistryPortrait; // ЯДРО: портрет ведомства и повестки
  lprDossier?: LprDossier;           // Досье ЛПР (тиерный слой)
  participants?: MeetingParticipant[]; // Карта участников встречи
  theses?: MeetingThesis[];          // Тезисы под повестку ЛПР
  afterMeeting?: MeetingAfter;       // Углублённый блок «После встречи»

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
  // Новые опциональные поля (углублённые возражения)
  trueReason?: string;     // Истинная причина возражения
  fallback?: string;       // Запасной ход, если ответ не сработал
  tier?: SourceTier;       // На что опирается ответ: факт / гипотеза / специфично ЛПР
  specific?: boolean;      // true = персональное возражение этого ЛПР
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
  oneLiner: string;
}

export interface IndustryBreakdown {
  id: string;
  name: string;
  keyEnterprises: { name: string; description: string }[];
  currentDigitalState: string;
  limitations: string[];
  sberRelevance: string;
  source?: string;
  sourceUrl?: string;
}

export interface BudgetProgram {
  id: string;
  name: string;
  owner: string;
  budget: string;
  status: string;
  sberRelevance: string;
  budgetValue?: number;
  source?: string;
  sourceUrl?: string;
}

// Статья структуры бюджета (доход или расход) для диаграммы.
export interface BudgetBreakdownItem {
  id: string;
  name: string;
  kind: "income" | "expense";
  value: number;
  valueRaw?: number;
  unit?: string;
  share?: string | number;
  source?: string;
  sourceUrl?: string;
  evidence?: string;
}

export interface BudgetLandscape {
  totalBudget: string;
  itShare: string;
  keyPrograms: BudgetProgram[];
  upcomingTenders: string;
  dataNeeded: string;
  breakdown?: BudgetBreakdownItem[];
  totalIncomeValue?: number;
  totalExpenseValue?: number;
  history?: {
    years: string[];
    income: (number | null)[];
    expense: (number | null)[];
    deficit?: (number | null)[];
    source?: string;
    sourceUrl?: string;
  };
  aiHighlights?: string[];
}

export interface RegionStakeholder {
  id: string;
  name: string;
  role: string;
  department: string;
  achievements: string;
  recentNews: string;
  managedBudget?: string;
  managementInterest: string;
  relationshipToSber: string;
  engagementPrinciple: string;
}

export interface Competitor {
  id: string;
  vendor: string;
  product: string;
  where: string;
  stage: string;
  threatLevel: string;
  sberAdvantage: string;
  evidence?: string;
  incumbentPosition?: string;
  decisionCriteria?: string[];
  riskForSber?: string;
  sberCounterPosition?: string;
  nextCheck?: string;
}

export interface EntryPoint {
  id: string;
  regionNeed: string;
  sberCapability: string;
  stakeholder: string;
  firstAction: string;
  confidence: string;
  evidence?: string;
  validationQuestion?: string;
}

export interface DataGap {
  id: string;
  question: string;
  howToGet: string;
  priority: string;
  owner: string;
  sourceHint?: string;
}

// Приоритет региона на горизонте 5 лет (для дорожной карты приоритетов).
export interface PriorityHorizon {
  id: string;
  title: string;
  period: string;
  linkedProgram?: string;
  source?: string;
}

export interface RegionalScenario {
  id: string;
  title: string;
  probability: "high" | "medium" | "low";
  horizon: string;
  trigger: string;
  regionMoves: string[];
  budgetImplication: string;
  industryImpact: string;
  sberPosture: string;
  earlySignals: string[];
  evidence?: string[];
  sources?: { title: string; url?: string; excerpt: string }[];
}

// ── Слой 1: центральный контринтуитивный тезис ────────────────────────────────
// Один парадокс, удерживающий весь анализ: X маскирует Y.
export interface RegionCoreThesis {
  headline: string;
  surfaceSignal: string;
  hiddenReality: string;
  soWhat: string;
  evidence?: string[];
  sources?: { title: string; url?: string; excerpt: string }[];
}

// ── Слой 2: цепочка «цифра → следствие → решение» ──────────────────
export interface RegionClaim {
  id: string;
  metric: string;
  metricValue?: number;
  direction?: "up" | "down" | "flat";
  implication: string;
  decision: string;
  confidence?: "high" | "medium" | "low";
  source?: string;
  sourceUrl?: string;
}

// ── Слой 3: ключевые игроки региона с финансовыми фактами ────────────
export interface RegionKeyPlayer {
  id: string;
  name: string;
  sector: string;
  role: "dominant" | "challenger" | "distressed" | "emerging";
  financials: { label: string; value: string; valueNum?: number }[];
  sberAngle: string;
  source?: string;
  sourceUrl?: string;
}

// ── Слой 4: разрыв «замысел стратегии vs факт» ─────────────────
export interface RegionStrategyRealityGap {
  id: string;
  dimension: string;
  strategyIntent: string;
  actualFact: string;
  gapMagnitude?: string;
  source?: string;
  sourceUrl?: string;
}

// ── Слой 5: матрица решений с зонированием по осям ───────────────
export interface RegionDecisionMatrixCell {
  id: string;
  quadrant: string;
  zone: "expand" | "hold" | "restrict" | "watch";
  target: string;
  rationale: string;
  metricHook?: string;
  source?: string;
  sourceUrl?: string;
}

export interface RegionDecisionMatrix {
  title: string;
  xAxis: { label: string; lowLabel?: string; highLabel?: string };
  yAxis: { label: string; lowLabel?: string; highLabel?: string };
  cells: RegionDecisionMatrixCell[];
}

// ── Слой 6: forward-looking ниши с оценкой объёма рынка ───────────
export interface RegionEmergingOpportunity {
  id: string;
  name: string;
  description: string;
  marketSize?: string;
  marketSizeNum?: number;
  horizon: string;
  readiness?: "pilot" | "early" | "scaling";
  sberAngle: string;
  source?: string;
  sourceUrl?: string;
}

export interface RegionAnalysisOutput {
  regionSummary: RegionSummary;
  // Адаптивная композиция: тип региона, фокус анализа и порядок «классических» блоков.
  regionArchetype?: string;
  focusAngle?: string;
  sectionOrder?: string[];
  coreThesis?: RegionCoreThesis;
  industryBreakdown: IndustryBreakdown[];
  budgetLandscape: BudgetLandscape;
  regionalScenarios?: RegionalScenario[];
  claims?: RegionClaim[];
  keyPlayers?: RegionKeyPlayer[];
  strategyRealityGap?: RegionStrategyRealityGap[];
  decisionMatrix?: RegionDecisionMatrix;
  emergingOpportunities?: RegionEmergingOpportunity[];
  stakeholderMap: RegionStakeholder[];
  competitiveLandscape: Competitor[];
  entryPoints: EntryPoint[];
  strategicPriorities: {
    confirmed: string[];
    hypothesized: string[];
    source: string;
    roadmap?: PriorityHorizon[];
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
