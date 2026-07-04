import type { CompetitionBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import type { Competitor } from "@/lib/schemas/structured-output";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble, pickString, isRecord } from "./base";

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

  // Salvage: если после двух проходов массив всё ещё пуст, а источники есть —
  // reasoning-модель, вероятно, уронила вложенный массив. Добираем узким вызовом.
  if (!result.competitiveLandscape.length && webEvidence.trim().length > 0) {
    const salvaged = await salvageCompetition(deps, webEvidence);
    if (salvaged.competitiveLandscape.length) {
      result = salvaged;
      parsed = { ...parsed, competitiveLandscape: salvaged.competitiveLandscape };
    }
  }

  return {
    ...result,
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeCompetitionHypotheses(result, parsed),
  };
}

/**
 * Узкий повторный вызов: просим ТОЛЬКО массив competitiveLandscape с примером и
 * обязательным evidence, опираясь на уже собранные источники.
 */
async function salvageCompetition(deps: BlockDeps, webEvidence: string): Promise<CompetitionBlockOutput> {
  const salvageMessage = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    `Тип сессии: ${deps.session.taskType}`,
    "",
    `Источники:\n${webEvidence}`,
    "",
    'Верни ТОЛЬКО JSON вида {"competitiveLandscape":[ ... ]} — БЕЗ каких-либо других полей.',
    "2-4 поставщика/решения, у которых в источниках есть региональное подтверждение (контракт, закупка, внедрение, оператор системы).",
    "У КАЖДОГО объекта ОБЯЗАТЕЛЬНЫ непустые vendor, product и evidence (конкретный факт: контракт/платформа/год). Портал закупок как ИСТОЧНИК доказательства допустим; но сам портал/регулятор (ЕИС, Минцифры) поставщиком не считается.",
    'Пример: {"id":"comp_1","vendor":"Компания","product":"Решение","where":"Ведомство региона","stage":"active","threatLevel":"medium","evidence":"Контракт 2024 на сопровождение ГИС","incumbentPosition":"..."}',
  ].join("\n");
  try {
    const raw = await callBlockLLM(SYSTEM_PROMPT, salvageMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "competition.salvage",
    });
    const parsed = parseBlockJson(raw) as CompetitionBlockOutput;
    return normalizeCompetition(parsed, deps);
  } catch {
    return { competitiveLandscape: [], sources: [], hypotheses: [] };
  }
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

/** Толерантно приводит сырой элемент к Competitor (синонимы ключей). */
function coerceCompetitor(raw: unknown, index: number): Competitor | null {
  if (!isRecord(raw)) return null;
  const vendor = pickString(raw, ["vendor", "company", "name", "supplier", "provider", "поставщик"]);
  const product = pickString(raw, ["product", "solution", "system", "platform", "service", "решение"]);
  const evidence = pickString(raw, ["evidence", "proof", "fact", "contract", "доказательство"]);
  if (!vendor || !evidence) return null;
  return {
    id: pickString(raw, ["id"]) || `comp_${index + 1}`,
    vendor,
    product: product || vendor,
    where: pickString(raw, ["where", "location", "scope", "где"]),
    stage: pickString(raw, ["stage", "status"]) || "active",
    threatLevel: pickString(raw, ["threatLevel", "threat", "level"]) || "medium",
    sberAdvantage: pickString(raw, ["sberAdvantage"]),
    evidence,
    incumbentPosition: pickString(raw, ["incumbentPosition", "position", "foothold"]),
    sberCounterPosition: pickString(raw, ["sberCounterPosition", "counter"]),
  };
}

function normalizeCompetition(parsed: CompetitionBlockOutput, deps: BlockDeps): CompetitionBlockOutput {
  const rawList = Array.isArray(parsed.competitiveLandscape) ? parsed.competitiveLandscape : [];
  return {
    competitiveLandscape: rawList
      .map((item, i) => coerceCompetitor(item, i))
      .filter((item): item is Competitor => item !== null)
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
  // Прицел на СТАТЬИ-анонсы контрактов и имена вендоров: провайдеры игнорируют
  // оператор site:, а сам zakupki.gov.ru отдаёт JS/анти-бот. Формулировки с
  // «внедрил / контракт / млн руб / сопровождение» чаще возвращают конкретные
  // новости о поставщиках, а не домашние страницы порталов.
  return [
    `${region} внедрил информационную систему подрядчик ${prev} ${year}`,
    `${region} контракт сопровождение государственной информационной системы млн руб`,
    `${region} цифровизация госуправления поставщик решение ведомство`,
    `${region} Ростелеком БАРС БФТ 1С Диалог контракт информационная система`,
    `${region} министерство цифрового развития закупка поставщик ПО`,
    `${region} импортозамещение программное обеспечение внедрение ведомство`,
  ];
}

/**
 * Исключаем ТОЛЬКО когда сам поставщик — портал/регулятор/федеральная
 * инфраструктура (проверяем vendor/product/incumbentPosition). evidence и where
 * НЕ проверяем: ссылка на zakupki.gov.ru там — это законный ИСТОЧНИК доказательства
 * контракта, а не признак того, что «поставщик» = портал закупок.
 */
function isRegionalSupplier(item: Competitor) {
  const identity = `${item.vendor} ${item.product} ${item.incumbentPosition ?? ""}`.toLowerCase();
  if (/сертификат\s+минцифр|минцифр[аы]\s+россии|единая информационная система|(?:^|\s)еис(?:\s|$)|портал закупок|независимый регистратор/.test(identity)) {
    return false;
  }
  if (/федеральн(?:ый|ого|ая|ой)\s+(?:портал|оператор|сервис|регулятор)/.test(identity)) {
    return false;
  }
  return true;
}
