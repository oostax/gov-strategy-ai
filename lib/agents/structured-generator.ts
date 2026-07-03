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
import { callLLM } from "@/lib/agents/llm-client";
import { formatRegionContext, modePrompt } from "@/lib/agents/prompt-builder";
import { getDocumentBlueprint } from "@/lib/agents/document-blueprint";
import { buildEvidencePack, formatEvidencePack } from "@/lib/agents/evidence-pack";
import { baseSystemPrompt } from "@/lib/prompts/base-system";
import { guardRegionOutput } from "@/lib/agents/fact-guard";
import {
  strategyJsonContract,
  meetingJsonContract,
  briefJsonContract,
  regionAnalysisContract,
} from "@/lib/prompts/structured-contract";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import { buildMaterialPlanDirective } from "@/lib/schemas/material-plan";
import { formatSberProjectsForPrompt, type SberGovProject } from "@/lib/storage/sber-projects";
import { jsonrepair } from "jsonrepair";

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
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  return cleaned.replace(/,\s*([}\]])/g, "$1");
}

function tryParseJson(raw: string): unknown {
  const cleaned = repairJsonText(raw);
  const parseWithRepair = (candidate: string) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return JSON.parse(jsonrepair(candidate));
    }
  };
  try {
    return parseWithRepair(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Модель вернула невалидный JSON. Попробуйте пересобрать.");
    return parseWithRepair(repairJsonText(jsonMatch[0]));
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
  const blocks = webEvidence
    .split(/\n\n(?=\d+\.\s+)/g)
    .filter((block) => /^\d+\.\s+/.test(block.trim()));

  for (const block of blocks) {
    const title = block.match(/^\d+\.\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";
    const url = block.match(/^URL:\s*(\S+)/m)?.[1]?.trim() ?? "";
    const fragment = block.match(/^Фрагмент:\s*([\s\S]*?)(?=\nПолный текст первоисточника|\n\n\d+\.\s|\s*$)/m)?.[1] ?? "";
    const fullTextLead =
      block.match(/^Полный текст первоисточника .*?:\s*([\s\S]*?)$/m)?.[1]?.slice(0, 900) ?? "";
    const excerpt = [fragment, fullTextLead]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1400);
    if (!title || !url || !excerpt) continue;
    if (sources.some((source) => normalizeUrl(source.url) === normalizeUrl(url))) continue;
    sources.push({ title, url, excerpt });
  }
  return sources.slice(0, 12);
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
  return allowed.slice(0, 8).map((source) => ({
    title: source.title,
    url: source.url,
    excerpt: firstEvidenceSentence(source.excerpt),
    isVerified: true,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredDataCandidate(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.data) && typeof value.kind === "string") {
    return value.data;
  }
  return value;
}

/**
 * Опции валидации. `enabledBlocks` — множество id включённых блоков из «Плана
 * материала». Если задано, обязательными считаются ТОЛЬКО включённые секции:
 * отключённый пользователем блок (напр. agenda / competition) не флагается как
 * ошибка. Если не задано — прежнее строгое поведение (полная схема).
 */
type UsableOptions = { requireSources?: boolean; enabledBlocks?: Set<string> };

/** Блок обязателен, если план не задан ИЛИ его id есть среди включённых. */
function blockRequired(enabled: Set<string> | undefined, id: string): boolean {
  return !enabled || enabled.has(id);
}

function isUsableStructuredData(
  kind: TypedOutput["kind"],
  value: unknown,
  options: UsableOptions = {},
): boolean {
  const requireSources = options.requireSources ?? true;
  const enabled = options.enabledBlocks;
  value = structuredDataCandidate(value);
  if (!isRecord(value)) return false;
  if ("score" in value || "problems" in value) return false;

  if (kind === "region") {
    const regionSummary = value.regionSummary;
    const budgetLandscape = value.budgetLandscape;
    const strategicPriorities = value.strategicPriorities;
    // regionSummary — базовое поле, требуется всегда. Остальные секции —
    // только если включены в плане (id совпадают с ключами sectionOrder).
    const okIndustries =
      !blockRequired(enabled, "industries") ||
      (Array.isArray(value.industryBreakdown) && value.industryBreakdown.length > 0);
    const okScenarios =
      !blockRequired(enabled, "scenarios") ||
      (Array.isArray(value.regionalScenarios) && value.regionalScenarios.length > 0);
    const okCompetition =
      !blockRequired(enabled, "competition") ||
      (Array.isArray(value.competitiveLandscape) && value.competitiveLandscape.length > 0);
    const okPriorities =
      !blockRequired(enabled, "priorities") ||
      (isRecord(strategicPriorities) && Array.isArray(strategicPriorities.confirmed));
    return (
      isRecord(regionSummary) &&
      typeof regionSummary.name === "string" &&
      regionSummary.name.trim().length > 0 &&
      isRecord(budgetLandscape) &&
      okIndustries &&
      okScenarios &&
      okCompetition &&
      okPriorities &&
      (!requireSources || (Array.isArray(value.sources) && value.sources.length > 0))
    );
  }

  if (kind === "meeting") {
    const agenda = value.agenda;
    const objections = value.objections;
    // Сценарий (agenda) обязателен и должен быть ЗАПОЛНЕН — но только если блок
    // включён в плане. Это устраняет баг пустого сценария, не ломая случай,
    // когда руководитель осознанно отключил «Сценарий встречи».
    const agendaFilled =
      !blockRequired(enabled, "agenda") ||
      (Array.isArray(agenda) &&
        agenda.length > 0 &&
        agenda.every(
          (block) =>
            isRecord(block) &&
            typeof block.topic === "string" &&
            block.topic.trim().length > 0 &&
            typeof block.sberSays === "string" &&
            block.sberSays.trim().length > 0,
        ));
    // Возражения если присутствуют — не должны быть пустыми объектами.
    const objectionsOk =
      !Array.isArray(objections) ||
      objections.every(
        (item) =>
          isRecord(item) &&
          typeof item.objection === "string" &&
          item.objection.trim().length > 0 &&
          typeof item.response === "string" &&
          item.response.trim().length > 0,
      );
    return (
      typeof value.meetingGoal === "string" &&
      value.meetingGoal.trim().length > 0 &&
      agendaFilled &&
      objectionsOk
    );
  }

  if (kind === "brief") {
    return typeof value.decision === "string" && Array.isArray(value.evidence) && isRecord(value.nextStep);
  }

  return (
    typeof value.decision === "string" &&
    Array.isArray(value.bets) &&
    value.bets.length > 0 &&
    Array.isArray(value.nextSteps)
  );
}

function assertUsableStructuredData(
  kind: TypedOutput["kind"],
  value: unknown,
  options: UsableOptions = {},
): asserts value is object {
  if (!isUsableStructuredData(kind, value, options)) {
    throw new Error(
      `LLM returned JSON that does not match ${kind} contract: ${describeStructuredDataIssues(kind, value, options).join(", ")}`,
    );
  }
}

function describeStructuredDataIssues(
  kind: TypedOutput["kind"],
  value: unknown,
  options: UsableOptions = {},
): string[] {
  const requireSources = options.requireSources ?? true;
  const enabled = options.enabledBlocks;
  const data = structuredDataCandidate(value);
  if (!isRecord(data)) return ["not an object"];
  const issues: string[] = [];
  if ("score" in data || "problems" in data) issues.push("review wrapper returned");
  if (kind === "region") {
    if (!isRecord(data.regionSummary) || typeof data.regionSummary.name !== "string") issues.push("regionSummary missing");
    if (blockRequired(enabled, "industries") && (!Array.isArray(data.industryBreakdown) || data.industryBreakdown.length === 0)) issues.push("industryBreakdown empty");
    if (blockRequired(enabled, "scenarios") && (!Array.isArray(data.regionalScenarios) || data.regionalScenarios.length === 0)) issues.push("regionalScenarios empty");
    if (blockRequired(enabled, "competition") && (!Array.isArray(data.competitiveLandscape) || data.competitiveLandscape.length === 0)) issues.push("competitiveLandscape empty");
    if (blockRequired(enabled, "priorities") && (!isRecord(data.strategicPriorities) || !Array.isArray(data.strategicPriorities.confirmed))) issues.push("strategicPriorities missing");
    if (requireSources && (!Array.isArray(data.sources) || data.sources.length === 0)) issues.push("sources empty");
  }
  if (kind === "meeting") {
    if (typeof data.meetingGoal !== "string" || !data.meetingGoal.trim()) issues.push("meetingGoal empty");
    if (!blockRequired(enabled, "agenda")) {
      // Сценарий отключён в плане — отсутствие agenda не ошибка.
    } else if (!Array.isArray(data.agenda) || data.agenda.length === 0) {
      issues.push("agenda empty");
    } else if (
      !data.agenda.every(
        (block) =>
          isRecord(block) &&
          typeof block.topic === "string" &&
          block.topic.trim() &&
          typeof block.sberSays === "string" &&
          block.sberSays.trim(),
      )
    ) {
      issues.push("agenda has empty topic/sberSays");
    }
    if (
      Array.isArray(data.objections) &&
      !data.objections.every(
        (item) =>
          isRecord(item) &&
          typeof item.objection === "string" &&
          item.objection.trim() &&
          typeof item.response === "string" &&
          item.response.trim(),
      )
    ) {
      issues.push("objections have empty fields");
    }
  }
  return issues.length ? issues : ["unknown shape mismatch"];
}

/**
 * Санитайзер meeting-документа перед валидацией: убирает ПУСТЫЕ элементы массивов
 * (блоки сценария без темы/реплики, возражения без текста, участники/тезисы-пустышки).
 * Это гарантирует, что пустой сценарий не пройдёт валидацию и попадёт на дозаполнение,
 * а не отрисуется дырявым. Мутирует и возвращает тот же объект.
 */
function sanitizeMeetingShape(value: unknown): unknown {
  const data = structuredDataCandidate(value);
  if (!isRecord(data)) return value;

  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;

  if (Array.isArray(data.agenda)) {
    data.agenda = data.agenda.filter(
      (block) => isRecord(block) && nonEmpty(block.topic) && nonEmpty(block.sberSays),
    );
  }
  if (Array.isArray(data.objections)) {
    data.objections = data.objections.filter(
      (item) => isRecord(item) && nonEmpty(item.objection) && nonEmpty(item.response),
    );
  }
  if (Array.isArray(data.theses)) {
    data.theses = data.theses.filter((item) => isRecord(item) && nonEmpty(item.text));
  }
  if (Array.isArray(data.participants)) {
    data.participants = data.participants.filter(
      (item) => isRecord(item) && nonEmpty(item.role) && nonEmpty(item.whatMatters),
    );
  }
  return data;
}

async function repairStructuredShape({
  candidate,
  contract,
  kind,
  session,
  webEvidence,
  evidencePack,
  blueprint,
  enabledBlocks,
}: {
  candidate: unknown;
  contract: string;
  kind: TypedOutput["kind"];
  session: SessionProfile;
  webEvidence: string;
  evidencePack: string;
  blueprint: string;
  enabledBlocks?: Set<string>;
}): Promise<unknown> {
  if (kind === "meeting") candidate = sanitizeMeetingShape(candidate);
  if (isUsableStructuredData(kind, candidate, { requireSources: false, enabledBlocks }))
    return structuredDataCandidate(candidate);

  const raw = await callLLM({
    messages: [
      {
        role: "system",
        content: [
          "Ты исправляешь НЕ стиль, а форму structured JSON для интерфейса.",
          "Верни только финальный JSON документа по схеме. Не возвращай review, score, problems, comments или markdown.",
          "Запрещено оставлять обязательные массивы пустыми.",
          "Если регионального источника не хватает, формулируй пункт как рабочую гипотезу с nextCheck/dataGaps, но не как факт.",
          "Не используй заглушки и фразы вида 'материал требует повторной сборки'. Пользователь должен получить содержательный управленческий документ.",
          contract,
        ].join("\n\n"),
      },
      {
        role: "user",
        content: [
          `Тип документа: ${kind}`,
          `Регион: ${session.region || "федеральный уровень"}`,
          `Задача: ${session.focusTopic || "не указана"}`,
          "",
          `Blueprint:\n${blueprint}`,
          "",
          `Evidence pack:\n${evidencePack}`,
          "",
          `Сырые источники:\n${webEvidence}`,
          "",
          "Требования к полноте для region:",
          "- regionSummary обязателен.",
          "- industryBreakdown: 3-5 элементов.",
          "- regionalScenarios: 3-4 элемента.",
          "- competitiveLandscape: 4-6 элементов; если нет регионального подтверждения, пометь как отраслевая гипотеза и добавь nextCheck.",
          "- entryPoints: 2-4 элемента.",
          "- risks: 2-3 элемента.",
          "- nextSteps: 3-4 элемента.",
          "- sources: только из списка выше.",
          "",
          "Требования к полноте для meeting (КРИТИЧНО — устраняем баг пустого сценария):",
          "- meetingGoal непустой.",
          "- agenda: 4-5 блоков. У КАЖДОГО блока непустые topic, sberSays, askLpr, fixDecision. Пустых ячеек и подписей без содержания быть НЕ должно. Если блок пустой — заполни его осмысленно или удали.",
          "- objections: 3-5 возражений; у каждого непустые objection, response, factNeeded (и по возможности trueReason, fallback).",
          "- theses: 3-4 тезиса, каждый с tiedTo (к какому факту ЛПР привязан).",
          "- participants: 2-4 участника с role, stance, whatMatters.",
          "- ministryPortrait: если есть источники — заполни budgetWindow и 2-4 stats с tier и source.",
          "- Факты (tier='fact') — только из блока «Сырые источники» с реальным url. Чего нет — hypothesis/ask, без выдумки ФИО и цифр.",
          "- sources: только из списка выше.",
          "",
          `Частичный/неполный JSON, который нужно исправить:\n${JSON.stringify(candidate).slice(0, 18000)}`,
        ].join("\n"),
      },
    ],
    maxTokens: 8000,
    temperature: 0.08,
    responseFormat: "json_object",
  });

  const repaired = kind === "meeting" ? sanitizeMeetingShape(tryParseJson(raw)) : tryParseJson(raw);
  assertUsableStructuredData(kind, repaired, { requireSources: false, enabledBlocks });
  return structuredDataCandidate(repaired);
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

/** Паттерны текстовых плейсхолдеров, которыми LLM маскирует отсутствие данных */
const PLACEHOLDER_RE = /нужно снять|требует уточнения|нет данных|не подтверждена|не найдена|оценка не найдена|требуется сбор|требуется проверка|данные отсутствуют|пока не подтвержден|нужно собрать/i;

/**
 * Если строка содержит текстовый плейсхолдер, не маскируем его деловой фразой.
 * Возвращаем только извлеченное число, когда оно реально есть в тексте.
 */
function cleanPlaceholder(text: unknown): string | null {
  if (text == null) return null;
  const str = String(text).trim();
  if (!str) return null;
  if (!PLACEHOLDER_RE.test(str)) return str;
  // Попытка вытащить число из текста: «Доля ВРП не подтверждена, оценивается в 13.7%»
  const numMatch = str.match(/(\d[\d\s,.]*\d|\d)/);
  if (numMatch) {
    const cleaned = numMatch[1].replace(/\s/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (Number.isFinite(num)) return `${num}`;
  }
  return null;
}

/**
 * Гарантирует, что regionSummary содержит реальные значения, а не плейсхолдеры.
 * Вызывается ПОСЛЕ guardSourcesAndEvidence, ПЕРЕД assertUsable.
 */
function guardRegionPlaceholders(kind: TypedOutput["kind"], data: unknown) {
  if (kind !== "region") return data;
  const region = data as RegionAnalysisOutput;
  if (!region || typeof region !== "object") return data;

  // regionSummary — string-поля, которые LLM заполняет текстом
  if (region.regionSummary && typeof region.regionSummary === "object") {
    const rs = region.regionSummary as unknown as Record<string, unknown>;
    for (const key of ["federalDistrict", "population", "budgetTotal", "oneLiner"]) {
      if (typeof rs[key] === "string") {
        const cleaned = cleanPlaceholder(rs[key]);
        if (cleaned === null) {
          delete rs[key];
        }
      }
    }
  }

  if (Array.isArray(region.industryBreakdown)) {
    region.industryBreakdown.forEach((ind) => {
      if (typeof ind.currentDigitalState === "string") {
        const cleaned = cleanPlaceholder(ind.currentDigitalState);
        if (cleaned === null) {
          ind.currentDigitalState = "";
        }
      }
    });
  }

  return region;
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
          "Открытые источники за время поиска не дали проверяемых фактов по теме. Не заполняй числовые факт-поля; вынеси конкретные вопросы в dataGaps.",
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
      visuals: usefulVisuals(region.visuals),
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
    const guarded = guardRegionOutput(
      region,
      allowed
        .filter((s): s is typeof s & { url: string } => Boolean(s.url))
        .map((s) => ({ title: s.title, url: s.url, snippet: s.excerpt })),
    );
    return {
      ...guarded,
      sources: safeSources(guarded.sources, allowed),
      hypotheses: [
        ...guarded.hypotheses,
        ...evidencePack.gaps.filter((gap) => !guarded.hypotheses?.includes(gap)).slice(0, 3),
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
  enabledBlocks,
}: {
  parsed: unknown;
  contract: string;
  kind: TypedOutput["kind"];
  session: SessionProfile;
  webEvidence: string;
  blueprint: string;
  evidencePack: string;
  enabledBlocks?: Set<string>;
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
          "9a. Для регионального анализа: сначала подтверждённые факты, отрасли, приоритеты региона на 5 лет, бюджет, сценарии и конкурентная карта; только потом коммерческие гипотезы Сбера. Обязательно проверь наличие 3-4 regionalScenarios и 4-6 competitors.",
          "9b. Для регионального анализа запрещены слова 'боль', 'мотив', 'заход', 'пробелы' в пользовательском тексте. Замени на 'ограничение', 'управленческий интерес', 'коммерческая гипотеза', 'что дозапросить'.",
          "9c. Для конкурентов: если нет регионального источника, пометь как отраслевую гипотезу и добавь nextCheck; не выдавай гипотезу за факт.",
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
    responseFormat: "json_object",
  });

  const critique = tryParseJson(raw) as {
    score?: number;
    problems?: string[];
    revised?: unknown;
  };
  const revised = critique.revised ?? parsed;
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
      responseFormat: "json_object",
    });
    const secondPass = tryParseJson(secondRaw);
    if (isUsableStructuredData(kind, secondPass, { requireSources: false, enabledBlocks })) return secondPass;
    if (isUsableStructuredData(kind, revised, { requireSources: false, enabledBlocks })) return revised;
    return parsed;
  }
  if (!isUsableStructuredData(kind, revised, { requireSources: false, enabledBlocks })) return parsed;
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
    responseFormat: "json_object",
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
      responseFormat: "json_object",
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
  onProgress?: (percent: number, label: string) => void,
): Promise<TypedOutput> {
  const contract = getContract(session.taskType);
  const kind = getKind(session.taskType);
  const blueprint = getDocumentBlueprint(session);
  // Директива состава/порядка/объёма блоков из «Плана материала» (если задан).
  const materialPlanDirective = buildMaterialPlanDirective(
    session.taskType,
    session.materialPlan,
  );
  // Множество включённых блоков — ослабляет валидацию: отключённые пользователем
  // секции не считаются ошибкой. undefined = план не задан → строгая валидация.
  const planBlockList = session.materialPlan?.blocks;
  const enabledBlocks =
    Array.isArray(planBlockList) && planBlockList.length > 0
      ? new Set(planBlockList)
      : undefined;
  onProgress?.(30, "Извлечение подтверждённых фактов из источников");
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
    "Не выдумывай числа, проценты, статистику без источника. Если данных нет — пиши null (для числовых полей) или опускай поле. Никогда не пиши 'нужно снять', 'требует уточнения', 'не подтверждена' и подобные текстовые плейсхолдеры.",
    "Все публичные факты должны опираться на блок 'Открытые источники'. Если источника нет — это гипотеза, а не факт.",
    "Evidence-first правило: сначала используй Evidence pack. Сырые источники нужны только для сверки и ссылок.",
    "Источники и evidence: используй только URL и названия, которые есть в блоке 'Сырые открытые источники'. Запрещено добавлять источники из памяти модели.",
    "Каждая рекомендация должна иметь управленческую причину, владельца, проверку и роль Сбера.",
    "Роль Сбера не формулируй общими словами. Укажи актив Сбера, первые 2 недели, данные и артефакт для ЛПР.",
    "Не выдумывай внутренние доли Сбера, количество клиентов, количество предприятий и точные планы вроде '50 компаний', если это не было дано пользователем или источником.",
    "Не выдумывай размер пилота: без источника не пиши '5 объектов', '10 предприятий', '20 площадок'. Используй формулировки 'пилотная группа', 'перечень приоритетных объектов', 'первый контур участников'.",
    "Не предлагай сокращение штата.",
    // Состав/порядок/объём блоков из «Плана материала» руководителя (если задан).
    materialPlanDirective,
    contract,
  ]
    .filter(Boolean)
    .join("\n\n");

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
    formatRegionContext(region, { includeSberPortfolio: session.taskType === "sber_region_strategy" }),
    "",
    session.taskType === "sber_region_strategy"
      ? formatSberProjectsForPrompt(session.focusTopic, session.region, 7, sberCatalog)
      : "",
    "",
    `Правила агента (верхние — самые свежие, выученные на фидбеке):\n${activePlaybooks.map((p) => `• ${p.name}: ${p.rules.slice(0, 5).join("; ")}`).join("\n")}`,
    "",
    session.taskType === "region_strategy"
      ? "Память: не используется для фактов регионального анализа; факты брать только из открытых источников и карточки региона."
      : `Память:\n${memories.slice(0, 3).map((m) => `• ${m.title}: ${m.excerpt.slice(0, 200)}`).join("\n") || "нет релевантных записей"}`,
    "",
    `Evidence pack:\n${formattedEvidencePack}`,
    "",
    `Сырые открытые источники для ссылок и сверки:\n${webEvidence || "Источники не найдены. Не выдумывай факты."}`,
    "",
    "Качество ответа:",
    "- Сначала управленческое решение, потом доказательства.",
    "- Покажи альтернативы: процессная, финансовая, партнерская/организационная, технологическая. ИИ — только если уместен.",
    "- Для region_strategy / sber_region_strategy не начинай с предложения Сбера: сначала дай отраслевой срез, стратегические приоритеты региона на 5 лет, структуру бюджета и 3-4 сценария развития региона.",
    "- Добавь 2-4 содержательные visuals в реальных величинах: матрица эффект×реализуемость (item.x/y), сравнение в деньгах (bar с valueRaw+unit), воронка follow-up (funnel), KPI baseline→target (scorecard). Никаких value:null и декоративной 'готовности/силы аргумента'. Если совсем нет чисел — [].",
    session.taskType === "sber_region_strategy"
      ? "- Если региональная карточка содержит проекты Сбера, используй их как точку входа и предложи, что дозаполнить в карточке."
      : "- Для анализа региона не формулируй коммерческие действия Сбера; сначала бюджет, отрасли, приоритеты, ЛПР, поставщики и сценарии региона.",
    "- В sources включи только реально использованные источники из блока выше.",
    "",
    `Запрос: ${userPrompt || session.focusTopic || "Сформируй материал"}`,
    "",
    "Верни JSON строго по схеме выше. Ничего кроме JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  onProgress?.(40, "Генерация основного анализа");
  const parsed = await repairStructuredShape({
    candidate: await callAndParseStructured(systemMessage, userMessage),
    contract,
    kind,
    session,
    webEvidence,
    blueprint,
    evidencePack: formattedEvidencePack,
    enabledBlocks,
  });
  onProgress?.(55, "Ревизия и проверка качества");
  const reviewed = await reviewAndReviseStructured({
    parsed,
    contract,
    kind,
    session,
    webEvidence,
    blueprint,
    evidencePack: formattedEvidencePack,
    enabledBlocks,
  }).catch((error) => {
    console.warn(`[structured] review step skipped: ${error instanceof Error ? error.message : error}`);
    return parsed;
  });
  onProgress?.(70, "Исправление формы по контракту");
  const revised = await repairStructuredShape({
    candidate: reviewed,
    contract,
    kind,
    session,
    webEvidence,
    blueprint,
    evidencePack: formattedEvidencePack,
    enabledBlocks,
  });

  const guarded = guardSourcesAndEvidence({
    kind,
    data: revised,
    evidencePack,
    webEvidence,
  });
  const cleaned = guardRegionPlaceholders(kind, guarded);

  assertUsableStructuredData(kind, cleaned, { requireSources: false, enabledBlocks });

  // Прокидываем порядок/состав блоков из плана в вывод, чтобы дашборд рендерил
  // секции в выбранном порядке и пропускал отключённые. Для meeting и region
  // (region single-shot fallback; основной путь региона — блочный orchestrator).
  if (enabledBlocks && planBlockList && isRecord(cleaned)) {
    if (kind === "meeting" || kind === "region") {
      (cleaned as Record<string, unknown>).sectionOrder = planBlockList;
    }
  }

  return { kind, data: cleaned } as TypedOutput;
}
