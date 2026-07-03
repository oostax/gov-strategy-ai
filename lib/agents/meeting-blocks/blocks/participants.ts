import type { MeetingBlockDeps, ParticipantsBlockOutput } from "../types";
import type { MeetingParticipant } from "@/lib/schemas/structured-output";
import {
  prepareBlockSources,
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  coerceTier,
  buildContextPreamble,
  buildMinistryContext,
  isRecord,
} from "./base";
import { PARTICIPANTS_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

const VALID_STANCES = new Set(["ally", "skeptic", "neutral"]);

export async function generateParticipantsBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<ParticipantsBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "participants",
    limit: 4,
  });

  const userMessage = [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    deps.lprName ? `ЛПР: ${deps.lprName}${deps.lprRole ? `, ${deps.lprRole}` : ""}` : "",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    "",
    buildContextPreamble(deps),
    buildMinistryContext(deps),
    "",
    `Сырые открытые источники:\n${webEvidence}`,
    "",
    "Составь карту участников: роли выводи структурно (ЛПР, техпривратник, держатель бюджета, куратор Минфина). ФИО — только из источников.",
    "Отметь теневых ЛПР как гипотезу. Сторону Сбера не выдумывай — вынеси в hypotheses.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(PARTICIPANTS_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "participants",
    maxTokens: 1300,
  });
  const parsed = parseBlockJson(raw) as { participants?: unknown; sources?: unknown; hypotheses?: unknown };

  return {
    participants: normalizeParticipants(parsed.participants),
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function normalizeParticipants(value: unknown): MeetingParticipant[] {
  if (!Array.isArray(value)) return [];
  const result: MeetingParticipant[] = [];
  for (let i = 0; i < value.length && result.length < 6; i++) {
    const item = value[i];
    if (!isRecord(item)) continue;
    if (!hasUsefulText(item.role) || !hasUsefulText(item.whatMatters)) continue;
    const stanceRaw = typeof item.stance === "string" ? item.stance.trim().toLowerCase() : "neutral";
    result.push({
      id: hasUsefulText(item.id) ? item.id : `p_${result.length + 1}`,
      name: hasUsefulText(item.name) ? item.name.trim() : undefined,
      role: item.role.trim(),
      stance: (VALID_STANCES.has(stanceRaw) ? stanceRaw : "neutral") as MeetingParticipant["stance"],
      whatMatters: item.whatMatters.trim(),
      tier: coerceTier(item.tier, false),
    });
  }
  return result;
}
