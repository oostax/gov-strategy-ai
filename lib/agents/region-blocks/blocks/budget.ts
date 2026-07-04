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
- totalBudget: общая сумма с годом (например "192,3 млрд ₽, 2026").
- totalIncomeValue/totalExpenseValue: числовые значения в млрд ₽.
- breakdown: конкретные статьи доходов и расходов с суммами. ТОЛЬКО из источника.
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
    "Если в источниках есть цифры по бюджету — обязательно используй их.",
    "Если данных нет — оставь поля пустыми.",
  ].join("\n");
}

function hasBudgetFact(parsed: BudgetBlockOutput): boolean {
  const landscape = parsed.budgetLandscape;
  return hasUsefulText(landscape?.totalBudget) ||
    Boolean(landscape?.totalIncomeValue) ||
    Boolean(landscape?.totalExpenseValue) ||
    Boolean(landscape?.breakdown?.length);
}
