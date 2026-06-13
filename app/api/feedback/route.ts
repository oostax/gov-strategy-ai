import { NextResponse } from "next/server";
import { callCloudEvolution } from "@/lib/integrations/cloud-evolution";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import { getRuntimeStatus } from "@/lib/integrations/runtime-status";
import { createFeedbackSchema } from "@/lib/schemas/feedback";
import { getStorage } from "@/lib/storage/local-json-storage";
import { createId } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { mergeRule } from "@/lib/agents/playbook-learning";
import type { EvolutionResult, Playbook } from "@/lib/schemas/playbook";
import type { Feedback } from "@/lib/schemas/feedback";
import type { AgentOutput } from "@/lib/schemas/output";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import type { SessionProfile } from "@/lib/schemas/session";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 120;

const structuredDir = path.join(process.cwd(), "data", "structured");

function structuredToAgentOutput(
  structured: TypedOutput,
  session: SessionProfile,
  outputId: string,
): AgentOutput {
  const title = session.title || session.focusTopic || "Structured output";
  let summary: string;
  let recommendations: string[];
  let risks: string[];
  let nextSteps: string[];
  let sources: AgentOutput["sources"];

  if (structured.kind === "brief") {
    const data = structured.data;
    summary = data.decision;
    recommendations = [data.decision];
    risks = data.risks.map((risk) => risk.title);
    nextSteps = [data.nextStep.action];
    sources = data.sources?.map((source) => ({
      title: source.title,
      type: "external_required",
      excerpt: source.excerpt,
      status: source.isVerified ? "used" : "needs_check",
      url: source.url,
    }));
  } else if (structured.kind === "meeting") {
    const data = structured.data;
    summary = data.mainThesis;
    recommendations = [data.proposal];
    risks = data.objections.map((item) => item.objection);
    nextSteps = [...data.ifYes, ...data.ifPause, ...data.ifNo].map((step) => step.action);
    sources = data.sources?.map((source) => ({
      title: source.title,
      type: "external_required",
      excerpt: source.excerpt,
      status: source.isVerified ? "used" : "needs_check",
      url: source.url,
    }));
  } else if (structured.kind === "region") {
    const data = structured.data;
    summary = data.regionSummary?.oneLiner ?? "Региональный анализ";
    recommendations = data.entryPoints?.map((ep) => `${ep.regionNeed}: ${ep.firstAction}`) ?? [];
    risks = data.risks?.map((risk) => risk.title) ?? [];
    nextSteps = data.nextSteps?.map((step) => step.action) ?? [];
    sources = data.sources?.map((source) => ({
      title: source.title,
      type: "external_required",
      excerpt: source.excerpt,
      status: source.isVerified ? "used" : "needs_check",
      url: source.url,
    }));
  } else {
    const data = structured.data;
    summary = data.decision;
    recommendations = data.bets.map((bet) => `${bet.title}: ${bet.logic}`);
    risks = data.risks.map((risk) => risk.title);
    nextSteps = data.nextSteps.map((step) => step.action);
    sources = data.sources?.map((source) => ({
      title: source.title,
      type: "external_required",
      excerpt: source.excerpt,
      status: source.isVerified ? "used" : "needs_check",
      url: source.url,
    }));
  }

  return {
    id: outputId,
    sessionId: session.id,
    title,
    type: session.taskType,
    summary,
    sections: [
      {
        id: "structured_json",
        title: "Текущий structured-документ",
        content: JSON.stringify(structured, null, 2),
        type: "text",
      },
    ],
    recommendations,
    risks,
    nextSteps,
    markdown: JSON.stringify(structured, null, 2),
    createdAt: nowIso(),
    sources,
  };
}

async function loadStructuredOutput(
  session: SessionProfile,
  outputId: string,
): Promise<AgentOutput | null> {
  try {
    const raw = await fs.readFile(path.join(structuredDir, `${session.id}.json`), "utf8");
    return structuredToAgentOutput(JSON.parse(raw) as TypedOutput, session, outputId);
  } catch {
    return null;
  }
}

async function persistEvolution(
  evolution: EvolutionResult,
  sessionId: string,
  outputId: string,
  activePlaybooks: Playbook[],
  feedback: Feedback,
) {
  const storage = getStorage();

  // Обновляем playbook — добавляем новое правило (с дедупом и провенансом)
  const target =
    activePlaybooks.find(
      (p) => p.name === evolution.playbookName || p.slug === evolution.playbookName,
    ) ??
    activePlaybooks[0] ??
    (await storage.getPlaybook("strategy_mode"));

  if (target) {
    // Полярность оценки определяет, усиливаем удачный приём или исправляем ошибку.
    const direction = feedback.rating >= 4 ? "reinforce" : "correct";
    // Свежее правило ставим В НАЧАЛО (генератор берёт верхние), схлопываем
    // почти-дубликаты и ограничиваем объём, чтобы playbook не разрастался.
    const rules = mergeRule(target.rules, evolution.newRule);
    const changeLabel =
      `${direction === "reinforce" ? "Усиление" : "Коррекция"} по оценке ${feedback.rating}/5` +
      (feedback.tags.length ? ` [${feedback.tags.join(", ")}]` : "") +
      `: ${evolution.improvement}`;
    await storage.updatePlaybook(
      target.id,
      {
        name: target.name,
        description: target.description,
        rules,
        template: target.template,
      },
      changeLabel,
      { direction, rating: feedback.rating, sessionId, rule: evolution.newRule },
    );
  }

  // Сохраняем переписанный ответ
  await storage.saveOutput(evolution.rewrittenAnswer);

  // Сохраняем запись об эволюции
  await storage.saveEvolution({
    id: createId("evo"),
    sessionId,
    outputId,
    result: evolution,
    createdAt: nowIso(),
  });

  // Запоминаем в MemPalace
  await getMemoryClient().rememberEvolution(evolution);
}

export async function POST(request: Request) {
  try {
    const input = createFeedbackSchema.parse(await request.json());
    const storage = getStorage();

    const details = await storage.getSession(input.sessionId);
    if (!details) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    // Для structured outputs outputId может быть placeholder
    let output = await storage.getOutput(input.outputId);
    if (!output && input.outputId === "structured_output") {
      output = await loadStructuredOutput(details.session, input.outputId);
    }
    if (!output) {
      // Берём последний output сессии или создаём минимальный
      output = details.outputs[0] ?? {
        id: input.outputId,
        sessionId: input.sessionId,
        title: details.session.title || details.session.focusTopic || "Structured output",
        type: details.session.taskType,
        summary: details.session.focusTopic || "",
        sections: [],
        recommendations: [],
        risks: [],
        nextSteps: [],
        markdown: "",
        createdAt: nowIso(),
      };
    }

    // Сохраняем feedback
    const feedback = await storage.saveFeedback({
      ...input,
      id: createId("fb"),
      createdAt: nowIso(),
    });
    await getMemoryClient().rememberFeedback(feedback);

    // Проверяем что LLM подключён
    const status = getRuntimeStatus();
    if (!status.llm.connected) {
      throw new Error(
        "Cloud.ru Foundation Models не подключен. Feedback evolution требует LLM.",
      );
    }

    // Запускаем эволюцию через Cloud.ru
    const playbooks = await storage.listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(details.session, playbooks);
    const evolution = await callCloudEvolution({
      sessionProfile: details.session,
      output,
      feedback,
      activePlaybooks,
    });

    await persistEvolution(evolution, details.session.id, output.id, activePlaybooks, feedback);

    return NextResponse.json({ feedback, evolution });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Feedback failed" },
      { status: 400 },
    );
  }
}
