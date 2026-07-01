/**
 * Shared JSON repair utilities.
 * Consolidates duplicate repairJson/repairJsonText/extractJson implementations.
 */

import { jsonrepair } from "jsonrepair";

export function repairJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");
}

export function tryParseJson<T = unknown>(raw: string): T {
  const cleaned = repairJson(raw);
  const parseWithRepair = (candidate: string) => {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return JSON.parse(jsonrepair(candidate)) as T;
    }
  };
  try {
    return parseWithRepair(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No valid JSON found in response");
    return parseWithRepair(repairJson(match[0]));
  }
}

export function extractJsonFromText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON found in response. Start: ${candidate.slice(0, 100)}`);
  }
  return candidate.slice(start, end + 1);
}

export function sourceFromUrl(url: string): { title: string; url: string } {
  let title: string;
  try {
    title = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    title = url.slice(0, 60);
  }
  return { title, url };
}
