import { z } from "zod";

export const feedbackTags = [
  "Недостаточная детализация",
  "Не показан экономический эффект",
  "Не определён пилотный проект (MVP)",
  "Нет связи с продуктами Сбера",
  "Слабая структура материала",
  "Недостаточно управленческих выводов",
  "Не соответствует уровню руководителя",
] as const;

export const feedbackSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  outputId: z.string(),
  rating: z.number().min(1).max(5),
  tags: z.array(z.string()),
  comment: z.string(),
  createdAt: z.string(),
});

export const createFeedbackSchema = feedbackSchema.omit({
  id: true,
  createdAt: true,
});

export type Feedback = z.infer<typeof feedbackSchema>;
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
