import type { CompetitionBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — конкурентный аналитик. Составь карту поставщиков и конкурирующих решений в регионе.

Правила:
- Включай только поставщиков, по которым в источниках есть региональное подтверждение: контракт, закупка, проект, внедрение, оператор системы.
- Не включай обязательные федеральные порталы, сертификаты, регуляторов и инфраструктуру электронных закупок как "конкурентов": ЕИС, сертификаты Минцифры, общие страницы zakupki.gov.ru являются источниками, а не поставщиками региона.
- Не добавляй компании по шаблону. Если по Яндексу, VK, Ростелекому, БФТ, 1С, КРОК нет регионального факта — не включай их.
- evidence: конкретный факт — номер контракта, название платформы, год внедрения.
- incumbentPosition: где закреплён — конкретное ведомство, система, контракт.
- sberCounterPosition: заполняй только для taskType="sber_region_strategy"; для taskType="region_strategy" оставь пустым.
- Без воды и общих слов. Только конкретика.
- Если подтверждённых данных меньше трёх, верни столько, сколько подтверждено; не добирай список гипотезами.
- Верни ТОЛЬКО JSON.

Схема:
{
  "competitiveLandscape": [
    {
      "id":"comp_1",
      "vendor":"Название компании",
      "product":"Конкретное решение",
      "where":"Где в регионе",
      "stage":"pilot|active|rollout",
      "threatLevel":"high|medium|low",
      "evidence":"Конкретный факт: контракт, проект, платформа",
      "incumbentPosition":"Где закреплён",
      "sberCounterPosition":"Конкретный продукт Сбера"
    }
  ],
  "sources": [],
  "hypotheses": ["какие категории поставщиков нужно проверить отдельно, если источников недостаточно"]
}`;

export async function generateCompetitionBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<CompetitionBlockOutput> {
  let { webEvidence, sources } = await prepareBlockSources(
    deps,
    enrichCompetitionQueries(deps.region, searchQueries),
    { kind: "competition", maxFullTextChars: 2600, limit: 8 },
  );

  let userMessage = buildCompetitionUserMessage(deps, webEvidence);
  let raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "competition" });
  let parsed = parseBlockJson(raw) as CompetitionBlockOutput;
  parsed = await refineByAgentInstructions(parsed, "Конкурентный ландшафт", SYSTEM_PROMPT, userMessage, deps.agentInstructions);
  let result = normalizeCompetition(parsed, deps);

  if (!result.competitiveLandscape.length) {
    ({ webEvidence, sources } = await prepareBlockSources(
      deps,
      fallbackCompetitionQueries(deps.region),
      { kind: "competition", skipCache: true, maxFullTextChars: 4200, limit: 10 },
    ));
    userMessage = [
      buildCompetitionUserMessage(deps, webEvidence),
      "",
      "Первый проход не дал подтверждённых региональных поставщиков.",
      "Сделай повторный разбор только по карточкам контрактов, закупкам, аудитам, региональным порталам и официальным сообщениям.",
      "Если поставщик не назван в источнике, не включай его. Лучше вернуть пустой список и конкретные проверки, чем выдать предположение.",
    ].join("\n");
    raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "competition_fallback" });
    parsed = parseBlockJson(raw) as CompetitionBlockOutput;
    parsed = await refineByAgentInstructions(parsed, "Конкурентный ландшафт", SYSTEM_PROMPT, userMessage, deps.agentInstructions);
    result = normalizeCompetition(parsed, deps);
  }

  return {
    ...result,
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeCompetitionHypotheses(result, parsed),
  };
}

function buildCompetitionUserMessage(deps: BlockDeps, webEvidence: string): string {
  return [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    `Тип сессии: ${deps.session.taskType}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Составь карту поставщиков и конкурирующих решений в регионе с конкретными доказательствами.",
    "Для каждого: какой проект/контракт/платформа и где закреплён.",
    "Не считай ЕИС, сертификат Минцифры или общий портал закупок поставщиком региона.",
    "Не добавляй поставщика, если в источниках нет регионального факта.",
  ].join("\n");
}

function normalizeCompetition(parsed: CompetitionBlockOutput, deps: BlockDeps): CompetitionBlockOutput {
  return {
    competitiveLandscape: (parsed.competitiveLandscape || [])
      .filter((item) => typeof item.evidence === "string" && item.evidence.trim().length > 0)
      .filter(isRegionalSupplier)
      .map((item) => ({
        ...item,
        sberAdvantage: deps.session.taskType === "sber_region_strategy" ? item.sberAdvantage : "",
        sberCounterPosition: deps.session.taskType === "sber_region_strategy" ? item.sberCounterPosition : "",
      }))
      .slice(0, 6),
    sources: [],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function normalizeCompetitionHypotheses(result: CompetitionBlockOutput, parsed: CompetitionBlockOutput): string[] {
  const hypotheses = normalizeHypotheses(parsed.hypotheses);
  if (!result.competitiveLandscape.length) {
    hypotheses.unshift(
      "Проверить реестр контрактов и региональный портал закупок по запросам: сопровождение государственных информационных систем, программное обеспечение, центр обработки данных, региональная информационная система.",
    );
  }
  return Array.from(new Set(hypotheses)).slice(0, 8);
}

function enrichCompetitionQueries(region: string, queries: string[]): string[] {
  return Array.from(new Set([
    ...queries,
    ...fallbackCompetitionQueries(region),
  ])).slice(0, 8);
}

function fallbackCompetitionQueries(region: string): string[] {
  const year = new Date().getFullYear();
  const prev = year - 1;
  return [
    `site:zakupki.gov.ru/epz/contract/contractCard "${region}" "информационная система"`,
    `site:zakupki.gov.ru/epz/contract/contractCard "${region}" "программное обеспечение"`,
    `site:zakupki.gov.ru/epz/order "${region}" "сопровождение" "информационной системы"`,
    `site:zakupki.gov.ru "${region}" "комитет информационных технологий" контракт поставщик`,
    `"${region}" "региональная информационная система" "поставщик"`,
    `"${region}" "сопровождение государственной информационной системы" ${prev} ${year}`,
    `"${region}" "контракт" "программное обеспечение" "заказчик" "поставщик"`,
    `"${region}" "аудит" "информационная инфраструктура" "контракт"`,
  ];
}

function isRegionalSupplier(item: CompetitionBlockOutput["competitiveLandscape"][number]) {
  const text = `${item.vendor} ${item.product} ${item.where} ${item.evidence} ${item.incumbentPosition}`.toLowerCase();
  if (/сертификат\s+минцифр|минцифр[аы]\s+россии|единая информационная система|(?:^|\s)еис(?:\s|$)|zakupki\.gov\.ru|независимый регистратор/.test(text)) {
    return false;
  }
  if (/федеральн(?:ый|ого|ая|ой)\s+(?:портал|оператор|сервис|регулятор)/.test(text)) {
    return false;
  }
  return true;
}
