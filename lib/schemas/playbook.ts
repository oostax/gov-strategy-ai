import { z } from "zod";
import { agentOutputSchema } from "./output";

export const playbookHistorySchema = z.object({
  version: z.number(),
  change: z.string(),
  createdAt: z.string(),
  // ── Провенанс обучения (опционально, для записей из feedback) ───────────────
  /** Куда направлено изменение: усиление удачного подхода или коррекция ошибки. */
  direction: z.enum(["reinforce", "correct", "manual"]).optional(),
  /** Оценка сессии, породившей это изменение (1–5). */
  rating: z.number().min(1).max(5).optional(),
  /** Сессия-источник, из которой выучено правило. */
  sessionId: z.string().optional(),
  /** Само правило, добавленное в playbook этой версией. */
  rule: z.string().optional(),
});

export const playbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  rules: z.array(z.string()),
  template: z.string(),
  version: z.number(),
  updatedAt: z.string(),
  history: z.array(playbookHistorySchema),
  searchQueries: z.record(z.string(), z.array(z.string())).optional(),
});

export const updatePlaybookSchema = playbookSchema.pick({
  name: true,
  description: true,
  rules: true,
  template: true,
});

export const evolutionResultSchema = z.object({
  problem: z.string(),
  improvement: z.string(),
  newRule: z.string(),
  playbookName: z.string(),
  playbookUpdate: z.string(),
  rewrittenAnswer: agentOutputSchema,
});

export type Playbook = z.infer<typeof playbookSchema>;
export type PlaybookHistory = z.infer<typeof playbookHistorySchema>;
export type UpdatePlaybookInput = z.infer<typeof updatePlaybookSchema>;
export type EvolutionResult = z.infer<typeof evolutionResultSchema>;
