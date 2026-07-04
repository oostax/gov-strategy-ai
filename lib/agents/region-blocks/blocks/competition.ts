import type { CompetitionBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import type { Competitor } from "@/lib/schemas/structured-output";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble, pickString, isRecord } from "./base";

const SYSTEM_PROMPT = `Ты — конкурентный аналитик Сбера по госсектору. Составь карту КОНКУРЕНТОВ Сбера в регионе — тех, кто борется за тот же бизнес региона и госсектора.

Кто такие конкуренты (Сбер — банк + финтех + ИТ-провайдер госсектору):
- ДРУГИЕ БАНКИ за обслуживание региона: ВТБ, Альфа-Банк, ПСБ, Т-Банк (Тинькофф), Совкомбанк, Райффайзен, Газпромбанк, Россельхозбанк, банк «Открытие», МКБ и т.п. — расчётно-кассовое обслуживание бюджета, зарплатные проекты, эквайринг, кредитование региона/предприятий, размещение бюджетных средств.
- ФИНТЕХ и платёжные игроки: ЮMoney, QIWI, процессинг/эквайринг, платёжные сервисы.
- ИТ/ЦИФРОВЫЕ вендоры госсектора: Ростелеком, БФТ, БАРС Груп, 1С, Диалог, КРОК, Softline, Яндекс, VK — ГИС, цифровые платформы, облако, документооборот, порталы.

Правила:
- Включай конкурента только при РЕГИОНАЛЬНОМ подтверждении из источников: контракт, проект, обслуживание, зарплатный проект, эквайринг, внедрение, оператор системы.
- НЕ включай нерелевантные бизнесу Сбера сущности (сделки в АПК/сельхозе, стройка жилья, ритейл, туризм, промышленные активы) — они не конкуренты банку/финтеху/ИТ-провайдеру.
- Не включай федеральные порталы/регуляторов/инфраструктуру закупок как "конкурентов": ЕИС, сертификаты Минцифры, zakupki.gov.ru — это источники, а не игроки региона.
- Не добавляй компании по шаблону — только с региональным фактом.
- vendor: банк/финтех/ИТ-компания. product: за что конкурирует (зарплатный проект, эквайринг, РКО бюджета, кредит, ГИС, платформа).
- evidence: конкретный факт — контракт, проект, объём, год.
- incumbentPosition: где закреплён — ведомство/учреждение/система/контракт.
- sberCounterPosition: заполняй только для taskType="sber_region_strategy"; для taskType="region_strategy" оставь пустым.
- Без воды. Только конкретика. Если подтверждённых меньше трёх — верни столько, сколько есть; не добирай гипотезами.
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

  // Конкуренты — ТОЛЬКО подтверждённые факты. Никаких «вероятных / нужно
  // проверить»: их всё равно никто не проверяет, а открытые реестры закупок
  // машинно недоступны (zakupki под Qrator-анти-ботом, clearspending/spending
  // мертвы). Нет подтверждённого факта — секция просто пустая, без заглушек.
  return {
    ...result,
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: [],
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
      .filter(isRelevantCompetitor)
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
    // Банки за бизнес региона (главные конкуренты Сбера в госсекторе)
    `${region} ВТБ Альфа-банк ПСБ обслуживание бюджета зарплатный проект`,
    `${region} банк эквайринг госучреждения контракт ${prev} ${year}`,
    `${region} банк кредит региону размещение бюджетных средств`,
    // ИТ/цифровые вендоры
    `${region} внедрил информационную систему подрядчик ${prev} ${year}`,
    `${region} контракт сопровождение государственной информационной системы млн руб`,
    `${region} Ростелеком БАРС БФТ 1С Диалог контракт информационная система`,
    `${region} министерство цифрового развития закупка поставщик ПО`,
  ];
}

/**
 * Исключаем ТОЛЬКО когда сам поставщик — портал/регулятор/федеральная
 * инфраструктура (проверяем vendor/product/incumbentPosition). evidence и where
 * НЕ проверяем: ссылка на zakupki.gov.ru там — это законный ИСТОЧНИК доказательства
 * контракта, а не признак того, что «поставщик» = портал закупок.
 */
/**
 * Профильность конкурента для Сбера (банк + финтех + ИТ-провайдер госсектору).
 * Принимаем банки, финтех/платёжку И ИТ/цифровых вендоров. Отсекаем только явно
 * нерелевантные бизнесу Сбера сущности (сделки в АПК, стройка, ритейл, туризм),
 * которые смягчённый поиск иногда притягивает. Лучше честно пусто + гипотеза
 * «проверить реестр», чем неотносящийся к теме «конкурент».
 */
function isRelevantCompetitor(item: Competitor) {
  const text = `${item.vendor} ${item.product} ${item.evidence ?? ""} ${item.incumbentPosition ?? ""} ${item.where}`.toLowerCase();
  const relevant =
    // банки и банковские услуги госсектору
    /банк|втб|альфа|тинькоф|т-банк|псб|промсвяз|совкомбанк|райффайзен|газпромбанк|россельхоз|росбанк|открыти|\bмкб\b|кредитн|расчётно-кассов|\bрко\b|зарплатн|эквайринг|инкассац|размещени средств|казначейск|лизинг|страхов/.test(
      text,
    ) ||
    // финтех / платёжка
    /финтех|платёж|платеж|процессинг|юmoney|qiwi|юкасса|электронн кошел|финансов сервис/.test(text) ||
    // ИТ / цифра / связь
    /информацион|цифров|систем|платформ|программн|софт|\bit\b|ит[-\s]|телеком|связ|облак|дата|цод|гис|госуслуг|автоматизац|биллинг|документооборот|ростелеком|барс|бфт|1с|диалог|крок|softline|яндекс|\bvk\b|нейросет|искусственн интеллект|портал/.test(
      text,
    );
  return relevant;
}

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
