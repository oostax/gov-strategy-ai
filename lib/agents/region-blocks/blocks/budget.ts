import type { BudgetBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import type { Source } from "@/lib/schemas/structured-output";
import { prepareBlockSources, callBlockLLM, parseBlockJson, hasUsefulText, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";
import { fetchWikiFacts } from "@/lib/integrations/open-data-retrieval";
import { logBlockEvent } from "../logger";

/** Ключевые слова для вытяжки бюджетно-экономических пассажей из статьи Википедии. */
const BUDGET_WIKI_KEYWORDS = [
  "доходы бюджета",
  "расходы бюджета",
  "консолидированн",
  "бюджет",
  "ВРП",
  "валовой региональный",
  "дефицит",
  "профицит",
  "млрд р",
];

const SYSTEM_PROMPT = `Ты — бюджетный аналитик. Составь детальный бюджетный ландшафт региона.

Правила:
- totalBudget: общая сумма с годом (например "192,3 млрд ₽, 2026"). Если в источниках есть доходы/расходы бюджета за ЛЮБОЙ год (даже не самый свежий, напр. из справочной статьи) — ОБЯЗАТЕЛЬНО заполни, явно указав год. Пустой totalBudget при наличии цифр в источнике — ошибка.
- totalIncomeValue/totalExpenseValue: числовые значения в млрд ₽ (например 292 и 317), если доходы/расходы названы в источнике.
- breakdown: статьи бюджета по РАЗДЕЛАМ (образование, здравоохранение, национальная экономика, соцполитика и т.п.) с суммами. НЕ вставляй сюда отдельные инвестпроекты, сделки или стройки из новостей — это не структура бюджета. ТОЛЬКО из источника.
- keyPrograms: конкретные госпрограммы с названием, владельцем, бюджетом, статусом.
- history: динамика доходов/расходов за 2-3 года если есть.
- Не выдумывай числа. Если данных нет — оставь поле пустым.
- Не ставь 0 вместо отсутствующей суммы: если сумма не найдена, оставь поле null или не включай строку.
- Для taskType="region_strategy" не заполняй sberRelevance.
- Верни ТОЛЬКО JSON.

Схема:
{
  "budgetLandscape": {
    "totalBudget": "бюджет если известен",
    "totalIncomeValue": 0,
    "totalExpenseValue": 0,
    "breakdown": [
      {"id":"b_1","name":"Образование","kind":"expense","value":12.3,"unit":"млрд ₽","source":""},
      {"id":"b_2","name":"Налог на прибыль","kind":"income","value":45.6,"unit":"млрд ₽","source":""}
    ],
    "keyPrograms": [
      {"id":"prog_1","name":"Название программы","owner":"Ведомство","budget":"сумма","status":"статус","sberRelevance":"релевантность для Сбера"}
    ],
    "history": null
  },
  "sources": [],
  "hypotheses": []
}`;

export async function generateBudgetBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<BudgetBlockOutput> {
  let { webEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "budget" },
  );

  // Реальные бюджетные цифры (доходы/расходы/ВРП) обычно есть только в ТЕЛЕ
  // статьи Википедии, а не во вступлении и не на генерик-страницах новостей.
  // Тянем тематическую вытяжку и ставим её первой — это живой источник, не мок.
  const wikiFacts = await fetchWikiFacts(deps.region, BUDGET_WIKI_KEYWORDS, 3500);
  if (wikiFacts) {
    webEvidence = `${wikiFacts.snippet}\n\n${webEvidence}`;
    const wikiSource: Source = {
      title: wikiFacts.title,
      url: wikiFacts.url,
      excerpt: wikiFacts.snippet.slice(0, 220),
      isVerified: true,
    };
    sources = [wikiSource, ...sources];
  }

  let userMessage = buildBudgetUserMessage(deps, webEvidence);
  let raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "budget" });
  let parsed = parseBlockJson(raw) as BudgetBlockOutput;

  if (!hasBudgetFact(parsed)) {
    await logBlockEvent({
      sessionId: deps.session.id,
      runId: deps.runId,
      scope: "blocks.block",
      message: "budget_fallback_start",
      data: { reason: "no_budget_fact" },
    });
    const year = new Date().getFullYear();
    ({ webEvidence, sources } = await prepareBlockSources(
      deps,
      [
        `${deps.region} закон о бюджете ${year} доходы расходы официальный сайт`,
        `${deps.region} бюджет для граждан ${year} ${year + 1} ${year + 2}`,
        `${deps.region} министерство финансов бюджет ${year} доходы расходы`,
        `${deps.region} структура расходов бюджета ${year} образование здравоохранение национальная экономика`,
      ],
      { kind: "budget", skipCache: true },
    ));
    if (wikiFacts) webEvidence = `${wikiFacts.snippet}\n\n${webEvidence}`;
    userMessage = buildBudgetUserMessage(deps, webEvidence);
    raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "budget_fallback" });
    parsed = parseBlockJson(raw) as BudgetBlockOutput;
  }

  // Salvage: reasoning-модель недетерминирована (temp форсится в 1) и порой не
  // извлекает цифры даже когда они есть в wiki-вытяжке. Узкий повторный вызов
  // строго на извлечение доходов/расходов из справочных фактов — детерминирует.
  if (!hasBudgetFact(parsed) && wikiFacts) {
    parsed = await salvageBudgetFromFacts(deps, wikiFacts.snippet, parsed);
  }

  if (!hasBudgetFact(parsed)) {
    console.warn(`[blocks][budget] no budget fact found, using partial data`);
  }
  parsed = await refineByAgentInstructions(parsed, "Бюджетный ландшафт", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  return {
    budgetLandscape: {
      totalBudget: parsed.budgetLandscape?.totalBudget ?? "",
      itShare: "",
      totalIncomeValue: parsed.budgetLandscape?.totalIncomeValue ?? undefined,
      totalExpenseValue: parsed.budgetLandscape?.totalExpenseValue ?? undefined,
      breakdown: (parsed.budgetLandscape?.breakdown || [])
        .filter((item) => typeof item.value === "number" && Number.isFinite(item.value) && item.value > 0)
        .slice(0, 10),
      keyPrograms: (parsed.budgetLandscape?.keyPrograms || [])
        .slice(0, 8)
        .map((program) => ({
          ...program,
          sberRelevance: deps.session.taskType === "sber_region_strategy" ? program.sberRelevance : "",
        })),
      upcomingTenders: "",
      dataNeeded: "",
      history: parsed.budgetLandscape?.history ?? undefined,
    },
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/**
 * Узкий детерминирующий добор: из справочной вытяжки (где доходы/расходы/ВРП
 * лежат стабильно) извлекаем именно бюджетные тоталы. Нужен, потому что основной
 * проход reasoning-модели недетерминирован и иногда игнорирует цифры.
 */
async function salvageBudgetFromFacts(
  deps: BlockDeps,
  factsText: string,
  prev: BudgetBlockOutput,
): Promise<BudgetBlockOutput> {
  const salvagePrompt = `Ты — бюджетный аналитик. Из приведённого текста извлеки бюджетные показатели региона.
Верни ТОЛЬКО JSON: {"budgetLandscape":{"totalBudget":"строка с суммой и годом","totalIncomeValue":число_млрд_или_null,"totalExpenseValue":число_млрд_или_null}}.
Если названы доходы/расходы бюджета за любой год — заполни (totalBudget как строку с годом, значения — в млрд ₽ числом). Ничего не выдумывай: если суммы нет — верни null.`;
  const salvageMessage = [
    `Регион: ${deps.region}`,
    "",
    "Текст со справочными фактами:",
    factsText,
  ].join("\n");
  try {
    const raw = await callBlockLLM(salvagePrompt, salvageMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "budget.salvage",
    });
    const salv = parseBlockJson(raw) as BudgetBlockOutput;
    const s = salv.budgetLandscape;
    if (!s) return prev;
    return {
      ...prev,
      budgetLandscape: {
        ...prev.budgetLandscape,
        totalBudget: hasUsefulText(s.totalBudget) ? s.totalBudget : (prev.budgetLandscape?.totalBudget ?? ""),
        totalIncomeValue: typeof s.totalIncomeValue === "number" ? s.totalIncomeValue : prev.budgetLandscape?.totalIncomeValue,
        totalExpenseValue: typeof s.totalExpenseValue === "number" ? s.totalExpenseValue : prev.budgetLandscape?.totalExpenseValue,
        breakdown: prev.budgetLandscape?.breakdown ?? [],
        keyPrograms: prev.budgetLandscape?.keyPrograms ?? [],
      },
    };
  } catch {
    return prev;
  }
}

function buildBudgetUserMessage(deps: BlockDeps, webEvidence: string): string {
  return [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    `Тип сессии: ${deps.session.taskType}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Проанализируй бюджет региона: доходы, расходы, структуру, госпрограммы.",
    "Если в источниках (в т.ч. в справочной статье) названы доходы/расходы бюджета — ОБЯЗАТЕЛЬНО заполни totalBudget и totalIncomeValue/totalExpenseValue, указав год (даже если это прошлые годы).",
    "В breakdown — только разделы бюджета (образование, здравоохранение и т.п.), НЕ отдельные инвестпроекты/сделки из новостей.",
    "Если данных нет — оставь поля пустыми, не выдумывай.",
  ].join("\n");
}

function hasBudgetFact(parsed: BudgetBlockOutput): boolean {
  const landscape = parsed.budgetLandscape;
  return hasUsefulText(landscape?.totalBudget) ||
    Boolean(landscape?.totalIncomeValue) ||
    Boolean(landscape?.totalExpenseValue) ||
    Boolean(landscape?.breakdown?.length);
}
