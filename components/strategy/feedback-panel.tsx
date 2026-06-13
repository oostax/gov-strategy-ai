"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { feedbackTags } from "@/lib/schemas/feedback";

export function FeedbackPanel({
  disabled,
  loading,
  onFeedback,
}: {
  disabled: boolean;
  loading: boolean;
  onFeedback: (rating: number, tags: string[], comment: string) => void;
}) {
  const [rating, setRating] = useState(4);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-3 p-4">
        <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)}>
          <div>
            <p className="font-semibold">Обратная связь</p>
            <p className="text-xs text-muted-foreground">Оценка запускает эволюцию правил</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{rating}/5</Badge>
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </button>
        <div className="flex items-center justify-between gap-2 rounded-xl border p-2">
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" onClick={() => setRating(value)} className="rounded-md p-1 hover:bg-muted">
                <Star className={value <= rating ? "size-4 fill-primary text-primary" : "size-4 text-muted-foreground"} />
              </button>
            ))}
          </div>
          <Button size="sm" className="h-8 rounded-xl" disabled={disabled || loading} onClick={() => onFeedback(rating, tags, comment)}>
            <Brain className="size-3.5" />
            Сохранить оценку
          </Button>
        </div>
        {open && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {feedbackTags.map((tag) => (
                <label
                  key={tag}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted/50"
                >
                  <Checkbox
                    checked={tags.includes(tag)}
                    onCheckedChange={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
                  />
                  {tag}
                </label>
              ))}
            </div>
            <Textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Что следует улучшить в материале?" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
