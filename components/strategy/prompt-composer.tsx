"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PromptComposer({ onGenerate, loading }: { onGenerate: (prompt: string) => void; loading: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          <span className="truncate text-sm font-semibold">Уточнить и пересобрать документ</span>
        </button>
        <Button className="shrink-0 rounded-xl" size="sm" onClick={() => onGenerate(prompt.trim())} disabled={loading}>
          {loading ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {loading ? "Готовлю материал..." : "Пересобрать"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 rounded-xl border bg-background p-2">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Что изменить в текущем документе: аудитория, акцент, формат, ограничения..."
            className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
      )}
    </div>
  );
}
