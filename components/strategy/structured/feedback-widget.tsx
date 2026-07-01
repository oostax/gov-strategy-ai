"use client";

import { useState } from "react";
import { MessageSquare, Star, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const feedbackTags = [
  "Недостаточная детализация",
  "Недостаточно источников",
  "Слабая проверка фактов",
  "Поверхностный бюджетный анализ",
  "Не хватает отраслевой конкретики",
  "Слабая структура материала",
  "Недостаточно управленческих выводов",
  "Не соответствует уровню руководителя",
  "Недостаточно деловой язык",
  "Есть заглушки или неподтверждённые формулировки",
  "Слишком много внутренних терминов",
  "Эталонный результат — закрепить подход",
];

export function FeedbackWidget({
  sessionId,
  outputId,
  onEvolved,
}: {
  sessionId: string;
  outputId?: string;
  onEvolved?: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function submit() {
    if (rating === 0) {
      toast.error("Поставьте оценку от 1 до 5");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          outputId: outputId || "structured_output",
          rating,
          tags,
          comment,
        }),
      });
      const data = (await response.json()) as { error?: string; evolution?: unknown };
      if (!response.ok) throw new Error(data.error || "Ошибка");
      setSubmitted(true);
      if (data.evolution) {
        toast.success("Агент улучшил ответ и обновил правила");
        onEvolved?.();
      } else {
        toast.success("Оценка сохранена");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <Card className="rounded-2xl border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex size-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
            <Star className="size-4 text-emerald-600" />
          </span>
          <div>
            <p className="text-sm font-semibold">Спасибо за оценку</p>
            <p className="text-xs text-muted-foreground">
              {rating >= 4
                ? "Правила агента обновлены на основе вашей положительной оценки"
                : "Агент учтёт замечания при последующих генерациях"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Оцените материал</h3>
          <p className="text-xs text-muted-foreground">
            Оценка используется для дообучения агента
          </p>
        </div>

        {/* Stars */}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              className="rounded-lg p-1 transition hover:bg-muted"
            >
              <Star
                className={cn(
                  "size-6 transition",
                  (hoverRating || rating) >= value
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/30",
                )}
              />
            </button>
          ))}
          {rating > 0 && (
            <span className="ml-2 text-sm font-medium">
              {rating === 5
                ? "Отлично"
                : rating === 4
                  ? "Хорошо"
                  : rating === 3
                    ? "Удовлетворительно"
                    : rating === 2
                      ? "Ниже ожидаемого"
                      : "Неудовлетворительно"}
            </span>
          )}
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {feedbackTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition",
                tags.includes(tag)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted/50",
              )}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Comment */}
        <Textarea
          rows={2}
          placeholder="Что следует улучшить? Какой подход закрепить как успешный?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="resize-none"
        />

        {/* Submit */}
        <Button
          onClick={submit}
          disabled={loading || rating === 0}
          className="w-full"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {loading ? "Обработка..." : "Отправить оценку"}
        </Button>
      </CardContent>
    </Card>
  );
}
