/**
 * Автозаполнение карточки региона из открытых источников.
 *
 * Берём уже готовый веб-поиск с фильтром релевантности (retrieveOpenSources),
 * и одним вызовом LLM раскладываем найденное в поля карточки: приоритеты, ограничения,
 * свежую повестку и карту ЛПР. Результат — ЧЕРНОВИК: в генерацию он идёт только
 * как гипотеза, пока человек не подтвердит элементы вручную.
 */

import { callLLM } from "./llm-client";
import {
  formatEvidenceForPrompt,
  retrieveOpenSources,
} from "@/lib/integrations/web-retrieval";
import {
  regionNewsSchema,
  stakeholderSchema,
  strategicPrioritySchema,
  type RegionDraft,
} from "@/lib/schemas/region";
import { createId } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";

function emptyDraft(sources: string[] = []): RegionDraft {
  return {
    generatedAt: nowIso(),
    status: "ready",
    sources,
    topPriorities: [],
    painPoints: [],
    news: [],
    stakeholders: [],
  };
}

function repairJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = repairJson(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned) as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Извлекает черновик карточки региона из открытых источников.
 * Никогда не бросает: при отсутствии источников/ошибке возвращает пустой черновик.
 */
export async function buildRegionDraft(regionName: string): Promise<RegionDraft> {
  const name = regionName.trim();
  if (!name) return emptyDraft();

  let evidence;
  try {
    evidence = await retrieveOpenSources({
      region: name,
      focusTopic:
        "стратегические приоритеты, цифровизация, руководители и ответственные лица, бюджет, проблемы и узкие места",
      limit: 10,
    });
  } catch (err) {
    console.warn(`[region-autofill] поиск не удался: ${err instanceof Error ? err.message : err}`);
    return emptyDraft();
  }

  const sources = Array.from(new Set(evidence.map((item) => item.source).filter(Boolean)));
  if (!evidence.length) return emptyDraft(sources);

  const webEvidence = formatEvidenceForPrompt(evidence);

  let raw: string;
  try {
    raw = await callLLM({
      temperature: 0.1,
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: [
            "Ты наполняешь карточку региона для стратегической работы в госсекторе.",
            "Извлекай ТОЛЬКО то, что прямо подтверждается фрагментами источников. Ничего не выдумывай.",
            "Если данных по полю нет — оставь пустой массив. Лучше пусто, чем выдумка.",
            "Верни ТОЛЬКО валидный JSON, без markdown и пояснений.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "Схема JSON:",
            `{"federalDistrict":"федеральный округ или пусто","population":"население (напр. ~1.0 млн) или пусто","budgetProfile":"кратко про бюджет региона или пусто","budgetCycle":"когда формируется бюджет / окно подачи или пусто","topPriorities":[{"title":"приоритет региона до 120 символов","source":"кратко: откуда (домен/документ)"}],"painPoints":["ограничение или узкое место до 140 символов"],"news":[{"title":"свежее событие","source":"домен","url":"ссылка или пусто","date":"если есть"}],"stakeholders":[{"fullName":"ФИО","role":"должность","department":"ведомство","motivation":"зона ответственности или управленческий интерес, если ясно из источника"}]}`,
            "",
            "Правила:",
            "- ЛПР: только реальные публичные должностные лица (губернатор, министры, зампреды), подтверждённые источником. Без выдуманных ФИО.",
            "- Максимум по 6 элементов в каждом массиве.",
            "- Приоритеты и ограничения — конкретные, не лозунги.",
            "- Контекстные поля (округ, население, бюджет, зрелость) — только если есть в источниках; иначе пусто/null.",
            "",
            `Регион: ${name}`,
            "",
            `Открытые источники:\n${webEvidence}`,
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    console.warn(`[region-autofill] LLM не ответил: ${err instanceof Error ? err.message : err}`);
    return emptyDraft(sources);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(raw);
  } catch (err) {
    console.warn(`[region-autofill] разбор JSON не удался: ${err instanceof Error ? err.message : err}`);
    return emptyDraft(sources);
  }

  // Валидируем каждый элемент под zod-формы карточки; невалидные отбрасываем.
  const topPriorities = asArray(parsed.topPriorities)
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const candidate = {
        id: createId("pri"),
        title: asString(record.title),
        source: asString(record.source) || undefined,
      };
      const result = strategicPrioritySchema.safeParse(candidate);
      return result.success ? result.data : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  const painPoints = asArray(parsed.painPoints)
    .map(asString)
    .filter((point) => point.length >= 4)
    .slice(0, 6);

  const news = asArray(parsed.news)
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const url = asString(record.url);
      const candidate = {
        id: createId("news"),
        title: asString(record.title),
        source: asString(record.source) || undefined,
        url: /^https?:\/\//.test(url) ? url : "",
        date: asString(record.date) || undefined,
      };
      const result = regionNewsSchema.safeParse(candidate);
      return result.success ? result.data : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  const stakeholders = asArray(parsed.stakeholders)
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const candidate = {
        id: createId("stk"),
        fullName: asString(record.fullName),
        role: asString(record.role),
        department: asString(record.department) || undefined,
        motivation: asString(record.motivation) || undefined,
        relationship: "cold" as const,
      };
      const result = stakeholderSchema.safeParse(candidate);
      return result.success ? result.data : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  return {
    generatedAt: nowIso(),
    status: "ready",
    sources,
    federalDistrict: asString(parsed.federalDistrict) || undefined,
    population: asString(parsed.population) || undefined,
    budgetProfile: asString(parsed.budgetProfile) || undefined,
    budgetCycle: asString(parsed.budgetCycle) || undefined,
    topPriorities,
    painPoints,
    news,
    stakeholders,
  };
}
