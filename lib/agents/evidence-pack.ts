import type { SessionProfile } from "@/lib/schemas/session";
import { callLLM } from "./llm-client";

export interface EvidencePack {
  facts: Array<{
    claim: string;
    sourceTitle: string;
    sourceUrl?: string;
    relevance: string;
  }>;
  gaps: string[];
  sberAngles: string[];
  forbiddenClaims: string[];
  sourceSummary: string;
}

const emptyEvidencePack: EvidencePack = {
  facts: [],
  gaps: [
    "Открытые источники не дали достаточной фактологической базы за время поиска.",
    "Все количественные утверждения нужно оформить как baseline для проверки.",
  ],
  sberAngles: [
    "Сформулировать роль Сбера через конкретный актив, данные, артефакт и следующий коммерческий шаг.",
  ],
  forbiddenClaims: [
    "Не указывать проценты, суммы, рейтинги, фамилии и сроки как факт без источника.",
  ],
  sourceSummary: "Источники недоступны или недостаточны.",
};

function repairJson(raw: string) {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");
}

function parsePack(raw: string): EvidencePack {
  const cleaned = repairJson(raw);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned) as Partial<EvidencePack>;
  return {
    facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 8) as EvidencePack["facts"] : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 8).map(String) : emptyEvidencePack.gaps,
    sberAngles: Array.isArray(parsed.sberAngles)
      ? parsed.sberAngles.slice(0, 6).map(String)
      : emptyEvidencePack.sberAngles,
    forbiddenClaims: Array.isArray(parsed.forbiddenClaims)
      ? parsed.forbiddenClaims.slice(0, 8).map(String)
      : emptyEvidencePack.forbiddenClaims,
    sourceSummary: typeof parsed.sourceSummary === "string" ? parsed.sourceSummary : emptyEvidencePack.sourceSummary,
  };
}

export async function buildEvidencePack({
  session,
  webEvidence,
  memories,
}: {
  session: SessionProfile;
  webEvidence: string;
  memories: Array<{ title: string; excerpt: string }>;
}): Promise<EvidencePack> {
  if (!webEvidence.trim() || webEvidence.includes("Открытые источники недоступны")) {
    return emptyEvidencePack;
  }

  const raw = await callLLM({
    temperature: 0.05,
    maxTokens: 3500,
    messages: [
      {
        role: "system",
        content: [
          "Ты — аналитик fact-check для стратегического материала Сбера.",
          "Извлеки только факты, которые прямо подтверждены фрагментами источников.",
          "Не делай выводов шире источника. Не добавляй внешние знания.",
          "Верни только JSON.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Схема JSON:",
          `{"facts":[{"claim":"факт до 180 символов","sourceTitle":"источник","sourceUrl":"url","relevance":"зачем важно для документа"}],"gaps":["что нужно проверить"],"sberAngles":["предметные углы Сбера, выведенные из задачи и памяти, не из воздуха"],"forbiddenClaims":["что нельзя утверждать без данных"],"sourceSummary":"1-2 предложения о качестве источников"}`,
          "",
          `Тип материала: ${session.taskType}`,
          `Регион: ${session.region || "федеральный уровень"}`,
          `Задача: ${session.focusTopic || "не указана"}`,
          "",
          `Память агента:\n${memories.map((item) => `- ${item.title}: ${item.excerpt.slice(0, 240)}`).join("\n") || "нет"}`,
          "",
          `Открытые источники:\n${webEvidence}`,
        ].join("\n"),
      },
    ],
  });

  try {
    return parsePack(raw);
  } catch (error) {
    console.warn(`[evidence-pack] parse failed: ${error instanceof Error ? error.message : error}`);
    return emptyEvidencePack;
  }
}

export function formatEvidencePack(pack: EvidencePack) {
  return [
    `Качество источников: ${pack.sourceSummary}`,
    "",
    "Подтвержденные факты:",
    ...(pack.facts.length
      ? pack.facts.map(
          (fact, index) =>
            `${index + 1}. ${fact.claim}\nИсточник: ${fact.sourceTitle}${fact.sourceUrl ? `\nURL: ${fact.sourceUrl}` : ""}\nЗачем важно: ${fact.relevance}`,
        )
      : ["нет подтвержденных фактов"]),
    "",
    "Пробелы и проверки:",
    ...pack.gaps.map((gap) => `- ${gap}`),
    "",
    "Предметные углы Сбера:",
    ...pack.sberAngles.map((angle) => `- ${angle}`),
    "",
    "Запрещенные утверждения без данных:",
    ...pack.forbiddenClaims.map((claim) => `- ${claim}`),
  ].join("\n");
}
