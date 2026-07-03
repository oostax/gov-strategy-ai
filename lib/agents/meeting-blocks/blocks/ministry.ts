import type { MeetingBlockDeps, MinistryBlockOutput } from "../types";
import type {
  MinistryItem,
  MinistryPortrait,
  MinistryStat,
  Source,
} from "@/lib/schemas/structured-output";
import {
  prepareBlockSources,
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  normalizeFactSource,
  coerceTier,
  buildContextPreamble,
  isRecord,
} from "./base";
import { MINISTRY_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";

export async function generateMinistryBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<MinistryBlockOutput> {
  let { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "ministry",
    limit: 6,
  });

  let userMessage = buildUserMessage(deps, webEvidence);
  let raw = await callBlockLLM(MINISTRY_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "ministry",
    maxTokens: 1800,
  });
  let parsed = parseBlockJson(raw) as { ministryPortrait?: unknown; meetingGoalSeed?: unknown; sources?: unknown; hypotheses?: unknown };

  // Паттерн budget.ts: если нет ни одного факта портрета — fallback-поиск со skipCache.
  if (!hasMinistryFact(parsed)) {
    await logBlockEvent({
      sessionId: deps.session.id,
      runId: deps.runId,
      scope: "meeting.block",
      message: "ministry_fallback_start",
      data: { reason: "no_ministry_fact" },
    });
    const year = new Date().getFullYear();
    const subject = deps.ministry || `${deps.region} цифровое развитие`;
    ({ webEvidence, sources } = await prepareBlockSources(
      deps,
      [
        `${deps.region} бюджет ${year} доходы расходы дефицит официальный`,
        `${subject} ${deps.region} расходы информатизация ИТ контракт`,
        `${deps.region} обращения граждан платформа обратной связи объём`,
        `${subject} ${deps.region} официальный сайт инициативы ${year}`,
      ],
      { kind: "ministry", skipCache: true, limit: 6 },
    ));
    userMessage = buildUserMessage(deps, webEvidence);
    raw = await callBlockLLM(MINISTRY_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "ministry_fallback",
      maxTokens: 1800,
    });
    parsed = parseBlockJson(raw) as typeof parsed;
  }

  const portrait = normalizePortrait(parsed.ministryPortrait);

  return {
    ministryPortrait: portrait,
    meetingGoalSeed: hasUsefulText(parsed.meetingGoalSeed) ? parsed.meetingGoalSeed.trim() : undefined,
    sources: dedupeSources([...normalizeSources(parsed.sources), ...sources]),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function buildUserMessage(deps: MeetingBlockDeps, webEvidence: string): string {
  return [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    deps.lprName ? `ЛПР: ${deps.lprName}${deps.lprRole ? `, ${deps.lprRole}` : ""}` : "",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    "",
    buildContextPreamble(deps),
    "",
    `Сырые открытые источники:\n${webEvidence}`,
    "",
    "Собери экономическую рамку сделки: бюджет региона (точный знак дефицит/профицит и сумма), объём ИТ-расходов и подрядчиков, обращения граждан, инициативы ведомства, рейтинги.",
    "Если в источниках есть цифры бюджета — используй их точно. Чего нет — не выдумывай, помечай hypothesis/ask.",
  ]
    .filter(Boolean)
    .join("\n");
}

function hasMinistryFact(parsed: { ministryPortrait?: unknown }): boolean {
  const p = parsed.ministryPortrait;
  if (!isRecord(p)) return false;
  const bw = p.budgetWindow;
  const hasWindow = isRecord(bw) && (hasUsefulText(bw.signal) || hasUsefulText(bw.tension));
  const hasStats = Array.isArray(p.stats) && p.stats.some((s) => isRecord(s) && hasUsefulText(s.value));
  const hasInit = Array.isArray(p.initiatives) && p.initiatives.some((i) => isRecord(i) && hasUsefulText(i.title));
  return hasWindow || hasStats || hasInit;
}

function normalizeStats(value: unknown): MinistryStat[] {
  if (!Array.isArray(value)) return [];
  const result: MinistryStat[] = [];
  for (let i = 0; i < value.length && result.length < 6; i++) {
    const item = value[i];
    if (!isRecord(item)) continue;
    if (!hasUsefulText(item.value) && !hasUsefulText(item.label)) continue;
    const source = normalizeFactSource(item.source);
    result.push({
      id: hasUsefulText(item.id) ? item.id : `st_${result.length + 1}`,
      label: hasUsefulText(item.label) ? item.label.trim() : "",
      value: hasUsefulText(item.value) ? item.value.trim() : "",
      caption: hasUsefulText(item.caption) ? item.caption.trim() : "",
      tier: coerceTier(item.tier, Boolean(source?.url)),
      source,
    });
  }
  return result;
}

function normalizeItems(value: unknown): MinistryItem[] {
  if (!Array.isArray(value)) return [];
  const result: MinistryItem[] = [];
  for (let i = 0; i < value.length && result.length < 4; i++) {
    const item = value[i];
    if (!isRecord(item) || !hasUsefulText(item.title)) continue;
    const source = normalizeFactSource(item.source);
    result.push({
      id: hasUsefulText(item.id) ? item.id : `item_${result.length + 1}`,
      title: item.title.trim(),
      detail: hasUsefulText(item.detail) ? item.detail.trim() : "",
      tier: coerceTier(item.tier, Boolean(source?.url)),
      source,
    });
  }
  return result;
}

function normalizePortrait(value: unknown): MinistryPortrait {
  if (!isRecord(value)) return {};
  const bw = value.budgetWindow;
  const budgetWindow =
    isRecord(bw) && (hasUsefulText(bw.signal) || hasUsefulText(bw.tension) || hasUsefulText(bw.decision))
      ? {
          signal: hasUsefulText(bw.signal) ? bw.signal.trim() : "",
          tension: hasUsefulText(bw.tension) ? bw.tension.trim() : "",
          decision: hasUsefulText(bw.decision) ? bw.decision.trim() : "",
          sources: normalizeSources(bw.sources).filter((s) => s.url || s.title),
        }
      : undefined;
  return {
    budgetWindow,
    stats: normalizeStats(value.stats),
    initiatives: normalizeItems(value.initiatives),
    incumbents: normalizeItems(value.incumbents),
  };
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const result: Source[] = [];
  for (const source of sources) {
    const key = (source.url || source.title || "").trim().replace(/\/$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result.slice(0, 8);
}
