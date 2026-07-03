/**
 * Синтез встречи (обогащающий, НЕ критичный слой). Вход — собранный черновой
 * MeetingOutput; на выходе — «шапка первого экрана», связывающая всё:
 *   - mainThesis — один главный тезис Сбера из бюджетного окна + сильнейшего theses;
 *   - meetingGoal — конкретный целевой исход, согласованный с askLadder;
 *   - proposal — короткий связный оффер.
 * Якорные цифры из ministryPortrait.stats[fact] используются как контекст, чтобы
 * весь материал держался на одних проверяемых числах. Единицы не меняем.
 * Сбой/таймаут синтеза не роняет прогон (как в region-synthesis).
 */

import type { MeetingOutput } from "@/lib/schemas/structured-output";
import { callLLM } from "@/lib/agents/llm-client";
import { tryParseJson } from "@/lib/utils/json";

const SYSTEM_PROMPT = `Ты — стратег по работе с госсектором. На основе СОБРАННЫХ ФАКТОВ встречи собери связную «шапку» материала. Верни СТРОГО JSON.

Правила: опирайся только на факты ниже; не выдумывай цифры, ФИО, законы; деловой русский без англицизмов; сохраняй единицы измерения из фактов (млрд остаётся млрд). mainThesis и meetingGoal — конкретные, не лозунги.

Верни объект строго по схеме:
{
  "mainThesis": "Один главный тезис Сбера одной фразой — из бюджетного окна и сильнейшего тезиса",
  "meetingGoal": "Конкретный целевой исход встречи (а не общий лозунг), согласованный с лестницей запросов",
  "proposal": "Что предлагаем — 2-3 предложения связного оффера"
}`;

function truncate(value: string | undefined | null, maxLen: number): string {
  if (!value) return "";
  return value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
}

function buildFactsContext(output: MeetingOutput): string {
  const lines: string[] = [];
  lines.push("=== ЦЕЛЬ И ТЕКУЩАЯ ШАПКА ===");
  if (output.meetingGoal) lines.push(`Цель (черновая): ${truncate(output.meetingGoal, 200)}`);
  if (output.mainThesis) lines.push(`Главный тезис (черновой): ${truncate(output.mainThesis, 200)}`);

  const p = output.ministryPortrait;
  if (p) {
    lines.push("\n=== ПОРТРЕТ ВЕДОМСТВА ===");
    if (p.budgetWindow) {
      if (p.budgetWindow.signal) lines.push(`Сигнал: ${truncate(p.budgetWindow.signal, 200)}`);
      if (p.budgetWindow.tension) lines.push(`Напряжение: ${truncate(p.budgetWindow.tension, 200)}`);
      if (p.budgetWindow.decision) lines.push(`Как заходить: ${truncate(p.budgetWindow.decision, 200)}`);
    }
    for (const stat of (p.stats ?? []).slice(0, 4)) {
      if (stat.tier === "fact" && stat.value) {
        lines.push(`Факт: ${truncate(stat.label, 60)} = ${stat.value} (${truncate(stat.caption, 80)})`);
      }
    }
  }

  if (output.theses?.length) {
    lines.push("\n=== ТЕЗИСЫ ===");
    for (const t of output.theses.slice(0, 4)) {
      lines.push(`- ${truncate(t.text, 140)} [привязка: ${truncate(t.tiedTo, 80)}]`);
    }
  }
  if (output.askLadder) {
    lines.push("\n=== ЛЕСТНИЦА ЗАПРОСОВ ===");
    if (output.askLadder.max) lines.push(`Максимум: ${truncate(output.askLadder.max, 120)}`);
    if (output.askLadder.target) lines.push(`Цель: ${truncate(output.askLadder.target, 120)}`);
  }
  if (output.proposal) lines.push(`\nОффер (черновой): ${truncate(output.proposal, 200)}`);
  return lines.join("\n");
}

export async function synthesizeMeetingHeader(output: MeetingOutput): Promise<{
  mainThesis?: string;
  meetingGoal?: string;
  proposal?: string;
}> {
  try {
    const facts = buildFactsContext(output);
    const raw = await callLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: facts },
      ],
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: "json_object",
    });
    const parsed = tryParseJson<{ mainThesis?: unknown; meetingGoal?: unknown; proposal?: unknown }>(raw);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return {
      mainThesis: str(parsed.mainThesis),
      meetingGoal: str(parsed.meetingGoal),
      proposal: str(parsed.proposal),
    };
  } catch (err) {
    console.warn("[meeting-blocks][synthesis] failed", err);
    return {};
  }
}
