import { z } from "zod";

export const outputSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.enum(["text", "table", "roadmap", "risks", "metrics", "actions"]),
});

export const outputSourceSchema = z.object({
  title: z.string(),
  type: z.enum(["session_input", "playbook", "memory", "external_required"]),
  excerpt: z.string(),
  status: z.enum(["used", "needs_check"]),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
});

export const agentOutputSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  type: z.string(),
  summary: z.string(),
  sections: z.array(outputSectionSchema),
  recommendations: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
  markdown: z.string(),
  createdAt: z.string(),
  sources: z.array(outputSourceSchema).optional(),
});

export type OutputSection = z.infer<typeof outputSectionSchema>;
export type OutputSource = z.infer<typeof outputSourceSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
