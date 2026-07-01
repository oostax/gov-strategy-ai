import type { SummaryBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — аналитик регионального развития. Составь карточку региона.

Правила:
- regionSummary.name: полное официальное название субъекта РФ.
- regionSummary.federalDistrict: федеральный округ ПОЛНОСТЬЮ (например "Южный федеральный округ", не просто "Южный").
- regionSummary.population: население с годом (например "~2,5 млн, 2024").
- regionSummary.budgetTotal: общий бюджет с годом (например "192,3 млрд ₽, 2026").
- regionSummary.oneLiner: управленческий вывод одной строкой — бюджетная рамка, 2-3 ключевые отрасли, ключевое следствие для анализа региона. Не энциклопедическая справка.
- coreThesis: главный вывод по региону без формулы "X маскирует Y", если она не следует из источников.
- Не выдумывай числа. Если данных нет — оставь поле пустым.
- Для taskType="region_strategy" не добавляй предложения и возможности Сбера.
- Не используй англицизмы, разговорные слова и рекламные формулировки.
- Верни ТОЛЬКО JSON без markdown.

Схема:
{
  "regionSummary": {
    "name": "Название региона",
    "federalDistrict": "Полное название ФО",
    "population": "население с годом",
    "budgetTotal": "бюджет с годом",
    "oneLiner": "управленческий вывод одной строкой"
  },
  "coreThesis": {
    "headline": "Парадокс: X маскирует Y",
    "surfaceSignal": "Что видно на поверхности",
    "hiddenReality": "Что на самом деле",
    "soWhat": "Следствие для анализа региона",
    "evidence": ["факты с цифрами"]
  },
  "sources": [{"title":"","url":"","excerpt":"","isVerified":true}],
  "hypotheses": []
}`;

export async function generateSummaryBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<SummaryBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "summary" },
  );

  const userMessage = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    `Тип сессии: ${deps.session.taskType}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Составь карточку региона: федеральный округ (полностью), население, бюджет, one-liner.",
    "ОБЯЗАТЕЛЬНО извлеки из источников: федеральный округ, население, бюджет.",
    "oneLiner — управленческий вывод о регионе, не энциклопедическая справка и не предложение Сбера.",
  ].join("\n");

  const raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "summary" });
  let parsed = parseBlockJson(raw) as SummaryBlockOutput;
  parsed = await refineByAgentInstructions(parsed, "Карточка региона", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  return {
    regionSummary: {
      name: parsed.regionSummary?.name || deps.region,
      federalDistrict: parsed.regionSummary?.federalDistrict || "",
      population: parsed.regionSummary?.population || "",
      budgetTotal: parsed.regionSummary?.budgetTotal || "",
      oneLiner: parsed.regionSummary?.oneLiner || "",
    },
    coreThesis: parsed.coreThesis || undefined,
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}
