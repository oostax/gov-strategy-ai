/**
 * Новый генератор: один вызов LLM → structured JSON.
 * Заменяет старый 5-блочный pipeline для моделей с поддержкой structured output.
 */

import type { SessionProfile } from "@/lib/schemas/session";
import type { Playbook } from "@/lib/schemas/playbook";
import type { RegionProfile } from "@/lib/schemas/region";
import type {
  BriefOutput,
  MeetingOutput,
  OutputVisual,
  RegionAnalysisOutput,
  Source,
  StructuredOutput,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { callLLM } from "./llm-client";
import { formatRegionContext, modePrompt } from "./prompt-builder";
import { getDocumentBlueprint } from "./document-blueprint";
import { buildEvidencePack, formatEvidencePack } from "./evidence-pack";
import { baseSystemPrompt } from "@/lib/prompts/base-system";
import {
  strategyJsonContract,
  meetingJsonContract,
  briefJsonContract,
  regionAnalysisContract,
} from "@/lib/prompts/structured-contract";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import { formatSberProjectsForPrompt, type SberGovProject } from "@/lib/storage/sber-projects";

function getContract(taskType: string): string {
  if (taskType === "meeting_preparation" || taskType === "meeting_followup") {
    return meetingJsonContract;
  }
  if (taskType === "executive_brief") {
    return briefJsonContract;
  }
  if (taskType === "region_strategy" || taskType === "sber_region_strategy") {
    return regionAnalysisContract;
  }
  return strategyJsonContract;
}

function getKind(taskType: string): TypedOutput["kind"] {
  if (taskType === "meeting_preparation" || taskType === "meeting_followup") {
    return "meeting";
  }
  if (taskType === "executive_brief") {
    return "brief";
  }
  if (taskType === "region_strategy" || taskType === "sber_region_strategy") {
    return "region";
  }
  return "strategy";
}

function repairJsonText(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");
}

function tryParseJson(raw: string): unknown {
  const cleaned = repairJsonText(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Модель вернула невалидный JSON. Попробуйте пересобрать.");
    return JSON.parse(repairJsonText(jsonMatch[0]));
  }
}

interface AllowedSource {
  title: string;
  url?: string;
  excerpt: string;
}

function normalizeUrl(url?: string) {
  return (url ?? "").trim().replace(/\/$/, "").toLowerCase();
}

function extractAllowedSources(webEvidence: string): AllowedSource[] {
  const sources: AllowedSource[] = [];
  const pattern =
    /(?:^|\n)\d+\.\s+(.+?)\nИсточник:\s+(.+?)\nURL:\s+(\S+)[\s\S]*?\nФрагмент:\s+([\s\S]*?)(?=\n\n\d+\.\s|\s*$)/g;
  for (const match of webEvidence.matchAll(pattern)) {
    const title = match[1].trim();
    const url = match[3].trim();
    const excerpt = match[4].replace(/\s+/g, " ").trim().slice(0, 420);
    if (!title || !url || !excerpt) continue;
    if (sources.some((source) => normalizeUrl(source.url) === normalizeUrl(url))) continue;
    sources.push({ title, url, excerpt });
  }
  return sources.slice(0, 8);
}

function firstEvidenceSentence(excerpt: string) {
  return (
    excerpt
      .split(/(?<=[.!?])\s+/)
      .find((part) => part.length > 35)
      ?.slice(0, 220) ?? excerpt.slice(0, 220)
  );
}

function safeSources(_current: Source[] | undefined, allowed: AllowedSource[]): Source[] {
  return allowed.slice(0, 5).map((source) => ({
    title: source.title,
    url: source.url,
    excerpt: firstEvidenceSentence(source.excerpt),
    isVerified: true,
  }));
}

function evidenceLinesFromPack(
  evidencePack: Awaited<ReturnType<typeof buildEvidencePack>>,
  allowed: AllowedSource[],
) {
  const allowedFacts = evidencePack.facts.filter((fact) => {
    const factUrl = normalizeUrl(fact.sourceUrl);
    if (factUrl && allowed.some((source) => normalizeUrl(source.url) === factUrl)) return true;
    const factTitle = fact.sourceTitle.trim().toLowerCase();
    return allowed.some((source) => {
      const title = source.title.trim().toLowerCase();
      return factTitle.length > 12 && (title.includes(factTitle) || factTitle.includes(title));
    });
  });

  if (allowedFacts.length) {
    return allowedFacts.slice(0, 5).map((fact) => `${fact.claim} (${fact.sourceTitle})`);
  }

  return allowed
    .slice(0, 5)
    .map((source) => `${firstEvidenceSentence(source.excerpt)} (${source.title})`);
}

function hasVisualNumber(item: { value?: number; valueRaw?: number }) {
  return Number.isFinite(item.valueRaw) || Number.isFinite(item.value);
}

// Гард синхронизирован с клиентским isUsefulVisual (visuals-section.tsx):
// пропускаем содержательные визуалы, режем пустые/служебные/без подписей. Лимит 4.
function usefulVisuals(visuals: OutputVisual[] | undefined) {
  return (visuals ?? [])
    .filter((visual) => {
      const items = (visual.items ?? []).filter((item) => item.label?.trim());
      if (items.length < 2) return false;
      const uniqueLabels = new Set(items.map((item) => item.label.trim().toLowerCase()));
      if (uniqueLabels.size < 2) return false;
      // Только чисто служебные мета-графики о самом поиске.
      if (/опора на источники|использованные домены|подтверждено фактами/i.test(visual.title)) {
        return false;
      }
      // Матрица — настоящее 2D-поле: нужны ОБЕ координаты у 2+ точек.
      if (visual.type === "matrix") {
        return items.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y)).length >= 2;
      }
      return items.filter(hasVisualNumber).length >= 2;
    })
    .slice(0, 4);
}

function guardSourcesAndEvidence({
  kind,
  data,
  evidencePack,
  webEvidence,
}: {
  kind: TypedOutput["kind"];
  data: unknown;
  evidencePack: Awaited<ReturnType<typeof buildEvidencePack>>;
  webEvidence: string;
}) {
  const allowed = extractAllowedSources(webEvidence);
  if (!allowed.length) {
    if (kind === "brief") {
      const brief = data as BriefOutput;
      return {
        ...brief,
        evidence: [
          "Открытые источники за время поиска не дали проверяемых фактов по теме. Числа, доли рынка и объемы нужно снять как baseline до решения.",
        ],
        visuals: usefulVisuals(brief.visuals),
        sources: [],
      };
    }
  if (kind === "meeting") {
    const meeting = data as MeetingOutput;
    return {
      ...meeting,
      visuals: usefulVisuals(meeting.visuals),
      sources: [],
      hypotheses: [
        ...(meeting.hypotheses ?? []),
        "Открытые источники за время поиска не дали проверяемых фактов; все количественные утверждения требуют проверки.",
      ].slice(0, 6),
    };
  }
  if (kind === "region") {
    const region = data as RegionAnalysisOutput;
    return {
      ...region,
      sources: [],
      hypotheses: [
        ...(region.hypotheses ?? []),
        "Открытые источники за время поиска не дали проверяемых фактов; все количественные утверждения требуют проверки.",
      ].slice(0, 8),
    };
  }
  const strategy = data as StructuredOutput;
    return {
      ...strategy,
      visuals: usefulVisuals(strategy.visuals),
      sources: [],
      hypotheses: [
        ...(strategy.hypotheses ?? []),
        "Открытые источники за время поиска не дали проверяемых фактов; все количественные утверждения требуют проверки.",
      ].slice(0, 6),
    };
  }

  if (kind === "brief") {
    const brief = data as BriefOutput;
    return {
      ...brief,
      evidence: evidenceLinesFromPack(evidencePack, allowed),
      visuals: usefulVisuals(brief.visuals),
      sources: safeSources(brief.sources, allowed),
    };
  }

  if (kind === "meeting") {
    const meeting = data as MeetingOutput;
    return {
      ...meeting,
      visuals: usefulVisuals(meeting.visuals),
      sources: safeSources(meeting.sources, allowed),
      hypotheses: [
        ...(meeting.hypotheses ?? []),
        ...evidencePack.gaps.filter((gap) => !meeting.hypotheses?.includes(gap)).slice(0, 3),
      ].slice(0, 6),
    };
  }

  if (kind === "region") {
    const region = data as RegionAnalysisOutput;
    return {
      ...region,
      sources: safeSources(region.sources, allowed),
      hypotheses: [
        ...(region.hypotheses ?? []),
        ...evidencePack.gaps.filter((gap) => !region.hypotheses?.includes(gap)).slice(0, 3),
      ].slice(0, 8),
    };
  }

  const strategy = data as StructuredOutput;
  return {
    ...strategy,
    visuals: usefulVisuals(strategy.visuals),
    sources: safeSources(strategy.sources, allowed),
    hypotheses: [
      ...(strategy.hypotheses ?? []),
      ...evidencePack.gaps.filter((gap) => !strategy.hypotheses?.includes(gap)).slice(0, 3),
    ].slice(0, 6),
  };
}

async function reviewAndReviseStructured({
  parsed,
  contract,
  kind,
  session,
  webEvidence,
  blueprint,
  evidencePack,
}: {
  parsed: unknown;
  contract: string;
  kind: TypedOutput["kind"];
  session: SessionProfile;
  webEvidence: string;
  blueprint: string;
  evidencePack: string;
}): Promise<unknown> {
  const raw = await callLLM({
    messages: [
      {
        role: "system" as const,
        content: [
          "Ты — строгий редактор стратегических материалов для руководителя госсектора Сбера.",
          "Твоя задача: проверить полезность, фактологичность и управленческую конкретику JSON-документа.",
          "Верни ТОЛЬКО валидный JSON-обертку: {\"score\":1-5,\"problems\":[\"...\"],\"revised\":{...исправленный документ по схеме...}}.",
          "score=5 только если материал полезен руководителю без ручной переработки.",
          contract,
        ].join("\n\n"),
      },
      {
        role: "user" as const,
        content: [
          `Тип документа: ${kind}`,
          `Задача: ${session.focusTopic || "не указана"}`,
          `Регион: ${session.region || "федеральный уровень"}`,
          "",
          `Blueprint документа:\n${blueprint}`,
          "",
          "Проверь и улучши документ по чек-листу:",
          "1. Решение должно быть предметным, не общим лозунгом.",
          "2. Не должно быть выдуманных чисел, рейтингов, законов, персоналий и фактов.",
          "3. Роль Сбера должна быть конкретной: актив/продукт, действие за 2 недели, данные, артефакт для ЛПР.",
          "4. Если источника не хватает, перенеси утверждение в hypotheses или checkNeeded.",
          "5. Убери воду, повторы и формулировки вроде 'запускаем пилот ИИ-ассистента' без управленческой логики.",
          "6. Добавь больше проверяемых формул, владельцев, критериев запуска/остановки.",
          "7. Добавь visuals только если они помогают выбрать действие. Не добавляй декоративные счетчики, готовность или силу аргументов без проверяемой основы.",
          "8. Для встречи: сценарий должен быть пригоден для реальной 30-минутной встречи.",
          "9. Для записки ВП: максимум решений, минимум описательности.",
          "10. Источники в sources и evidence должны быть только из списка 'Сырые источники'. Если URL/названия нет в списке — удали факт.",
          "11. Не придумывай доли рынка Сбера, число клиентов, число предприятий, рейтинги и персоналии. Если данных нет — запрашиваем baseline.",
          "12. Не указывай количество пилотных объектов/предприятий/площадок без источника или прямого ввода пользователя. Пиши 'пилотная группа' или 'перечень приоритетных объектов'.",
          "",
          `Evidence pack:\n${evidencePack}`,
          "",
          `Сырые источники для сверки:\n${webEvidence}`,
          "",
          `Исходный JSON:\n${JSON.stringify(parsed).slice(0, 18000)}`,
        ].join("\n"),
      },
    ],
    maxTokens: 8000,
    temperature: 0.12,
  });

  const critique = tryParseJson(raw) as {
    score?: number;
    problems?: string[];
    revised?: unknown;
  };
  const revised = critique.revised ?? critique;
  if (typeof critique.score === "number" && critique.score < 4) {
    const secondRaw = await callLLM({
      messages: [
        {
          role: "system",
          content: [
            "Ты — финальный редактор. Исправь документ так, чтобы он получил score >= 4 для руководителя.",
            "Верни ТОЛЬКО JSON документа по исходной схеме, без обертки.",
            contract,
          ].join("\n\n"),
        },
        {
          role: "user",
          content: [
            `Проблемы критика: ${(critique.problems ?? []).join("; ") || "материал слабый"}`,
            `Blueprint:\n${blueprint}`,
            `Evidence pack:\n${evidencePack}`,
            `Документ:\n${JSON.stringify(revised).slice(0, 18000)}`,
          ].join("\n\n"),
        },
      ],
      maxTokens: 8000,
      temperature: 0.1,
    });
    return tryParseJson(secondRaw);
  }
  return revised;
}

async function callAndParseStructured(
  systemMessage: string,
  userMessage: string,
): Promise<unknown> {
  const raw = await callLLM({
    messages: [
      { role: "system" as const, content: systemMessage },
      { role: "user" as const, content: userMessage },
    ],
    maxTokens: 8000,
    temperature: 0.3,
  });

  try {
    return tryParseJson(raw);
  } catch {
    const fixRaw = await callLLM({
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content:
            "Исправь следующий ответ: верни ТОЛЬКО валидный JSON по той же схеме, без markdown и комментариев.\n\n" +
            raw.slice(0, 12000),
        },
      ],
      maxTokens: 8000,
      temperature: 0.1,
    });
    return tryParseJson(fixRaw);
  }
}

export async function generateStructured(
  session: SessionProfile,
  activePlaybooks: Playbook[],
  region: RegionProfile | null,
  memories: Array<{ title: string; excerpt: string }>,
  webEvidence: string,
  userPrompt: string,
  sberCatalog: SberGovProject[] = [],
): Promise<TypedOutput> {
  const contract = getContract(session.taskType);
  const kind = getKind(session.taskType);
  const blueprint = getDocumentBlueprint(session);
  const evidencePack = await buildEvidencePack({ session, webEvidence, memories });
  const formattedEvidencePack = formatEvidencePack(evidencePack);

  const horizonLabels: Record<string, string> = {
    "3_months": "3 месяца",
    "12_months": "12 месяцев",
    "2028": "до 2028",
    "2030": "до 2030",
  };

  const meetingContext =
    session.taskType === "meeting_preparation" || session.taskType === "meeting_followup"
      ? [
          session.meetingWith ? `ЛПР: ${session.meetingWith}` : "",
          session.meetingDate ? `Дата: ${session.meetingDate}` : "",
          session.meetingGoal ? `Цель: ${session.meetingGoal}` : "",
          session.meetingContext ? `Контекст: ${session.meetingContext}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const systemMessage = [
    baseSystemPrompt,
    modePrompt(session),
    "КРИТИЧЕСКИ ВАЖНО: Верни ТОЛЬКО валидный JSON. Без markdown, без пояснений, без текста до или после.",
    "Не выдумывай числа, проценты, статистику без источника. Если данных нет — пиши 'нужно снять baseline'.",
    "Все публичные факты должны опираться на блок 'Открытые источники'. Если источника нет — это гипотеза, а не факт.",
    "Evidence-first правило: сначала используй Evidence pack. Сырые источники нужны только для сверки и ссылок.",
    "Источники и evidence: используй только URL и названия, которые есть в блоке 'Сырые открытые источники'. Запрещено добавлять источники из памяти модели.",
    "Каждая рекомендация должна иметь управленческую причину, владельца, проверку и роль Сбера.",
    "Роль Сбера не формулируй общими словами. Укажи актив Сбера, первые 2 недели, данные и артефакт для ЛПР.",
    "Не выдумывай внутренние доли Сбера, количество клиентов, количество предприятий и точные планы вроде '50 компаний', если это не было дано пользователем или источником.",
    "Не выдумывай размер пилота: без источника не пиши '5 объектов', '10 предприятий', '20 площадок'. Используй формулировки 'пилотная группа', 'перечень приоритетных объектов', 'первый контур участников'.",
    "Не предлагай сокращение штата.",
    contract,
  ].join("\n\n");

  const userMessage = [
    `Профиль сессии:`,
    `Роль: ${roleLabels[session.userRole]}`,
    `Тип: ${taskLabels[session.taskType]}`,
    `Аудитория: ${session.audience}`,
    `Горизонт: ${horizonLabels[session.horizon] ?? session.horizon}`,
    `Регион: ${session.region || "федеральный уровень"}`,
    `Задача: ${session.focusTopic || "не указана"}`,
    meetingContext,
    `Дополнительные требования: ${session.constraints.length ? session.constraints.join("; ") : "нет"}`,
    "",
    `Blueprint документа:\n${blueprint}`,
    "",
    formatRegionContext(region),
    "",
    formatSberProjectsForPrompt(session.focusTopic, session.region, 7, sberCatalog),
    "",
    `Правила агента (верхние — самые свежие, выученные на фидбеке):\n${activePlaybooks.map((p) => `• ${p.name}: ${p.rules.slice(0, 5).join("; ")}`).join("\n")}`,
    "",
    `Память:\n${memories.slice(0, 3).map((m) => `• ${m.title}: ${m.excerpt.slice(0, 200)}`).join("\n") || "нет релевантных записей"}`,
    "",
    `Evidence pack:\n${formattedEvidencePack}`,
    "",
    `Сырые открытые источники для ссылок и сверки:\n${webEvidence || "Источники не найдены. Не выдумывай факты."}`,
    "",
    "Качество ответа:",
    "- Сначала управленческое решение, потом доказательства.",
    "- Покажи альтернативы: процессная, финансовая, партнерская/организационная, технологическая. ИИ — только если уместен.",
    "- Добавь 2-4 содержательные visuals в реальных величинах: матрица эффект×реализуемость (item.x/y), сравнение в деньгах (bar с valueRaw+unit), воронка follow-up (funnel), KPI baseline→target (scorecard). Никаких value:null и декоративной 'готовности/силы аргумента'. Если совсем нет чисел — [].",
    "- Если региональная карточка содержит проекты Сбера, используй их как точку входа и предложи, что дозаполнить в карточке.",
    "- В sources включи только реально использованные источники из блока выше.",
    "",
    `Запрос: ${userPrompt || session.focusTopic || "Сформируй материал"}`,
    "",
    "Верни JSON строго по схеме выше. Ничего кроме JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await callAndParseStructured(systemMessage, userMessage);
  const revised = await reviewAndReviseStructured({
    parsed,
    contract,
    kind,
    session,
    webEvidence,
    blueprint,
    evidencePack: formattedEvidencePack,
  }).catch((error) => {
    console.warn(`[structured] review step skipped: ${error instanceof Error ? error.message : error}`);
    return parsed;
  });

  const guarded = guardSourcesAndEvidence({
    kind,
    data: revised,
    evidencePack,
    webEvidence,
  });

  return { kind, data: guarded } as TypedOutput;
}
