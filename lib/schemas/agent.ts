import { z } from "zod";
import { sessionProfileSchema } from "./session";
import { agentOutputSchema } from "./output";

export const actionTypes = [
  "shorten_for_vp",
  "add_economic_effect",
  "add_8_week_mvp",
  "add_risks",
  "make_roadmap",
  "meeting_talking_points",
  "presentation_format",
  "save_to_playbook",
  "improve_and_remember",
] as const;

export const actionRequestSchema = z.object({
  sessionId: z.string(),
  outputId: z.string(),
  actionType: z.enum(actionTypes),
  currentContent: z.string(),
  sessionProfile: sessionProfileSchema,
});

export const generateRequestSchema = z.object({
  sessionId: z.string(),
  prompt: z.string().optional(),
});

export const llmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const llmCallSchema = z.object({
  messages: z.array(llmMessageSchema),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

export const sessionBundleSchema = z.object({
  session: sessionProfileSchema,
  outputs: z.array(agentOutputSchema),
});

export type ActionType = (typeof actionTypes)[number];
export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type LlmMessage = z.infer<typeof llmMessageSchema>;
export type LlmCall = z.infer<typeof llmCallSchema>;
