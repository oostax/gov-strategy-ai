import type { Feedback } from "@/lib/schemas/feedback";
import type { AgentOutput } from "@/lib/schemas/output";
import { evolutionResultSchema, type EvolutionResult, type Playbook } from "@/lib/schemas/playbook";
import type { SessionProfile } from "@/lib/schemas/session";
import { nowIso } from "@/lib/utils/dates";
import { createId } from "@/lib/utils/ids";

export interface OuroborosEvolutionInput {
  sessionProfile: SessionProfile;
  output: AgentOutput;
  feedback: Feedback;
  activePlaybooks: Playbook[];
}

interface A2AResponse {
  jsonrpc: string;
  id: string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface ChatHistoryResponse {
  messages?: Array<{
    role?: string;
    text?: string;
    ts?: string;
    is_progress?: boolean;
    task_id?: string;
  }>;
}

function getEndpoint() {
  return (process.env.OUROBOROS_A2A_URL || "http://127.0.0.1:18800").replace(/\/$/, "");
}

function getDesktopEndpoint() {
  return (process.env.OUROBOROS_DESKTOP_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
}

function getHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const password = process.env.OUROBOROS_A2A_PASSWORD;
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`ouroboros:${password}`).toString("base64")}`;
  }
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function collectTextParts(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];

  const parts = Array.isArray(record.parts) ? record.parts : [];
  const direct = parts.flatMap((part) => {
    const partRecord = asRecord(part);
    return typeof partRecord?.text === "string" ? [partRecord.text] : [];
  });

  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const artifactTexts = artifacts.flatMap((artifact) => collectTextParts(artifact));

  return [...direct, ...artifactTexts];
}

function getTaskId(result: unknown) {
  const record = asRecord(result);
  return typeof record?.id === "string" ? record.id : null;
}

function getTaskState(result: unknown) {
  const record = asRecord(result);
  const status = asRecord(record?.status);
  return typeof status?.state === "string" ? status.state : null;
}

async function rpc(method: "message/send" | "tasks/get", params: unknown): Promise<A2AResponse> {
  const id = createId("a2a");
  const response = await fetch(`${getEndpoint()}/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Ouroboros A2A недоступен: HTTP ${response.status}. ${text}`);
  }
  const parsed = JSON.parse(text) as A2AResponse;
  if (parsed.error) {
    throw new Error(`Ouroboros A2A error: ${parsed.error.message || parsed.error.code || "unknown"}`);
  }
  return parsed;
}

export async function checkOuroborosA2A() {
  const response = await fetch(`${getEndpoint()}/.well-known/agent-card.json`, {
    headers: getHeaders(),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Ouroboros A2A agent card HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function sendTask(message: string) {
  const messageId = createId("msg");
  const first = await rpc("message/send", {
    message: {
      messageId,
      role: "user",
      parts: [{ kind: "text", text: message }],
    },
  });

  let result = first.result;
  let texts = collectTextParts(result);
  const taskId = getTaskId(result);

  for (let attempt = 0; texts.length === 0 && taskId && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const next = await rpc("tasks/get", { id: taskId });
    result = next.result;
    texts = collectTextParts(result);
    const state = getTaskState(result);
    if (state === "failed" || state === "canceled" || state === "rejected") {
      throw new Error(`Ouroboros A2A task ${state}`);
    }
  }

  const text = texts.join("\n").trim();
  if (!text) throw new Error("Ouroboros A2A вернул пустой ответ.");
  return text;
}

async function getDesktopHistory() {
  const response = await fetch(`${getDesktopEndpoint()}/api/chat/history`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Ouroboros Desktop history HTTP ${response.status}`);
  return (await response.json()) as ChatHistoryResponse;
}

async function clearDesktopChat(): Promise<void> {
  const os = await import("os");
  const fs = await import("fs/promises");
  const path = await import("path");
  const chatFile = path.join(os.homedir(), "Ouroboros", "data", "logs", "chat.jsonl");
  try {
    await fs.writeFile(chatFile, "");
  } catch {
    // ignore if file doesn't exist
  }
}

export async function sendDesktopCommand(message: string) {
  await clearDesktopChat();
  const startedAt = nowIso();
  const command = await fetch(`${getDesktopEndpoint()}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: message }),
    signal: AbortSignal.timeout(10000),
  });
  if (!command.ok) {
    throw new Error(`Ouroboros Desktop command HTTP ${command.status}: ${await command.text()}`);
  }

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const history = await getDesktopHistory();
    const match = [...(history.messages ?? [])].reverse().find((item) => {
      if (item.role !== "assistant" || item.is_progress || !item.text) return false;
      if (!item.ts) return true;
      return item.ts >= startedAt;
    });
    if (match?.text) return match.text.trim();
  }

  throw new Error("Ouroboros Desktop не вернул финальный ответ за 180 секунд.");
}

export function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    // Try to find partial JSON and close it
    if (start !== -1) {
      // Return what we have — caller will handle parse error
      return candidate.slice(start);
    }
    throw new Error("Ouroboros не вернул JSON с результатом эволюции.");
  }
  return candidate.slice(start, end + 1);
}

export function buildEvolutionPrompt(input: OuroborosEvolutionInput) {
  return `Ты — внешний Ouroboros Evolution Runtime для продукта gov-strategy-ai.
Задача: на основе обратной связи улучшить стратегический ответ, сформулировать новое правило playbook и вернуть строго JSON без Markdown.

Схема ответа:
{
  "problem": "что было не так",
  "improvement": "как улучшили",
  "newRule": "новое правило для playbook",
  "playbookName": "название одного из активных playbook",
  "playbookUpdate": "краткое описание обновления",
  "rewrittenAnswer": {
    "id": "будет заменен системой",
    "sessionId": "${input.sessionProfile.id}",
    "title": "название",
    "type": "${input.sessionProfile.taskType}",
    "summary": "краткое резюме",
    "sections": [
      {"id":"sec_1","title":"Executive Summary","content":"...","type":"text"},
      {"id":"sec_2","title":"Как Сбер может помочь","content":"...","type":"actions"},
      {"id":"sec_3","title":"Что проверить источниками","content":"...","type":"text"}
    ],
    "recommendations": ["..."],
    "risks": ["..."],
    "nextSteps": ["..."],
    "markdown": "полная версия ответа",
    "createdAt": "${nowIso()}"
  }
}

Профиль сессии:
${JSON.stringify(input.sessionProfile, null, 2)}

Активные playbook:
${JSON.stringify(input.activePlaybooks.map((item) => ({
    name: item.name,
    slug: item.slug,
    rules: item.rules,
  })), null, 2)}

Текущий ответ (краткий):
${JSON.stringify({
    title: input.output.title,
    summary: input.output.summary,
    sections: input.output.sections.map((s) => ({ title: s.title, content: s.content.slice(0, 600) })),
    recommendations: input.output.recommendations,
    risks: input.output.risks,
  }, null, 2)}

Feedback:
${JSON.stringify({ rating: input.feedback.rating, tags: input.feedback.tags, comment: input.feedback.comment }, null, 2)}

Правила:
- Не спорь с пользователем.
- Не выдумывай актуальные региональные факты. Если факты не проверены, явно пометь как гипотезу и добавь "Что проверить источниками".
- Обязательно добавь блок "Как Сбер может помочь".
- Верни только валидный JSON, без пояснений вокруг.`;
}

export async function callOuroborosEvolution(input: OuroborosEvolutionInput): Promise<EvolutionResult> {
  const prompt = buildEvolutionPrompt(input);
  let raw: string;

  if (process.env.OUROBOROS_A2A_ENABLED === "true") {
    raw = await sendTask(prompt);
  } else {
    throw new Error("Ouroboros A2A не включен. Desktop legacy /api/command не используется для синхронной эволюции, потому что запускает долгую агентскую задачу вместо быстрого JSON API.");
  }
  const parsed = evolutionResultSchema.parse(JSON.parse(extractJson(raw)));
  return {
    ...parsed,
    rewrittenAnswer: {
      ...parsed.rewrittenAnswer,
      id: createId("out"),
      sessionId: input.sessionProfile.id,
      type: input.sessionProfile.taskType,
      createdAt: nowIso(),
    },
  };
}

export async function getOuroborosDesktopState() {
  const response = await fetch(`${getDesktopEndpoint()}/api/state`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`Ouroboros Desktop state HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}
