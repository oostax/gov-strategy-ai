export type MemoryUsage = "user_input" | "crm" | "quality_rule" | "generated" | "unknown";

export function classifyMemorySource(sourceFile?: string): MemoryUsage {
  if (sourceFile === "gov-strategy-ai/session") return "user_input";
  if (sourceFile === "gov-strategy-ai/confirmed_crm") return "crm";
  if (
    sourceFile === "gov-strategy-ai/decision_feedback" ||
    sourceFile === "gov-strategy-ai/evolution"
  ) {
    return "quality_rule";
  }
  if (
    sourceFile === "gov-strategy-ai/agent_output" ||
    sourceFile?.startsWith("gov-strategy-ai/meeting_facts") ||
    sourceFile?.startsWith("gov-strategy-ai/region_facts")
  ) {
    return "generated";
  }
  return "unknown";
}

export function canUseAsHistoricalUserInput(sourceFile?: string): boolean {
  return classifyMemorySource(sourceFile) === "user_input";
}

/** CRM is allowed only for a future explicitly confirmed provenance class. */
export function canUseAsCrmFact(sourceFile?: string): boolean {
  return classifyMemorySource(sourceFile) === "crm";
}
