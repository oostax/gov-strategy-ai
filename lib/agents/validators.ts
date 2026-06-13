import { agentOutputSchema, type AgentOutput } from "@/lib/schemas/output";
import { createId } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  // Try fenced code block first
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  // Then try raw JSON object
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to find and parse the largest JSON object
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseAgentOutput(raw: string, sessionId: string, type: string): AgentOutput {
  const parsed = tryParseJson(raw);
  const result = agentOutputSchema.safeParse(parsed);
  if (result.success) {
    return {
      ...result.data,
      id: result.data.id || createId("out"),
      sessionId,
      createdAt: result.data.createdAt || nowIso(),
    };
  }

  // If JSON parsed but schema failed, try to extract useful fields
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    const summary = typeof p.summary === "string" ? p.summary : raw.slice(0, 600);
    const sections = Array.isArray(p.sections) ? p.sections : [];
    return {
      id: createId("out"),
      sessionId,
      title: typeof p.title === "string" ? p.title : "Стратегический материал",
      type,
      summary,
      sections: sections.length > 0 ? sections as AgentOutput["sections"] : [
        { id: createId("sec"), title: "Ответ агента", content: summary, type: "text" },
      ],
      recommendations: Array.isArray(p.recommendations) ? p.recommendations as string[] : ["Проверить исходные допущения"],
      risks: Array.isArray(p.risks) ? p.risks as string[] : ["Ответ требует ручной проверки"],
      nextSteps: Array.isArray(p.nextSteps) ? p.nextSteps as string[] : ["Уточнить вводные и перегенерировать"],
      markdown: typeof p.markdown === "string" ? p.markdown : summary,
      createdAt: nowIso(),
      sources: Array.isArray(p.sources) ? p.sources as AgentOutput["sources"] : [],
    };
  }

  // Fallback: raw text
  return {
    id: createId("out"),
    sessionId,
    title: "Стратегический материал",
    type,
    summary: raw.slice(0, 600),
    sections: [
      { id: createId("sec"), title: "Ответ агента", content: raw, type: "text" },
    ],
    recommendations: ["Проверить исходные допущения", "Согласовать следующий управленческий шаг"],
    risks: ["Ответ требует ручной проверки структуры"],
    nextSteps: ["Уточнить вводные и перегенерировать материал"],
    markdown: raw,
    createdAt: nowIso(),
    sources: [],
  };
}
