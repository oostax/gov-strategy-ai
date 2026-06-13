"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  GripVertical,
  History,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Playbook } from "@/lib/schemas/playbook";

export function PlaybookEditor({ id }: { id: string }) {
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newRule, setNewRule] = useState("");

  useEffect(() => {
    fetch(`/api/playbooks/${id}`)
      .then((response) => response.json())
      .then((data: { playbook: Playbook }) => {
        setPlaybook(data.playbook);
        setRules(data.playbook.rules);
      });
  }, [id]);

  function updateRule(index: number, value: string) {
    const next = [...rules];
    next[index] = value;
    setRules(next);
    setDirty(true);
  }

  function removeRule(index: number) {
    setRules(rules.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addRule() {
    const text = newRule.trim();
    if (!text) return;
    setRules([...rules, text]);
    setNewRule("");
    setDirty(true);
  }

  async function save() {
    if (!playbook) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/playbooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playbook.name,
          description: playbook.description,
          rules: rules.filter(Boolean),
          template: playbook.template,
        }),
      });
      const data = (await response.json()) as { playbook?: Playbook; error?: string };
      if (!response.ok || !data.playbook) {
        throw new Error(data.error || "Не удалось сохранить");
      }
      setPlaybook(data.playbook);
      setRules(data.playbook.rules);
      setDirty(false);
      toast.success("Правила сохранены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  if (!playbook) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Правила, выученные из оценок (есть в провенансе истории) — подсветим их.
  const learnedRules = new Set(
    playbook.history.map((entry) => entry.rule).filter((rule): rule is string => Boolean(rule)),
  );
  const learnedCount = playbook.history.filter((entry) => entry.rating !== undefined).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/playbooks"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Правила
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">{playbook.name}</h1>
          <Badge variant="secondary">v{playbook.version}</Badge>
        </div>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Сохранить
        </Button>
      </div>

      {/* Meta */}
      <Card className="rounded-2xl">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Название</p>
            <Input
              value={playbook.name}
              onChange={(e) => {
                setPlaybook({ ...playbook, name: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Шаблон ответа</p>
            <Input
              value={playbook.template}
              onChange={(e) => {
                setPlaybook({ ...playbook, template: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Описание</p>
            <Textarea
              rows={2}
              value={playbook.description}
              onChange={(e) => {
                setPlaybook({ ...playbook, description: e.target.value });
                setDirty(true);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Rules — each as a separate editable card */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-muted-foreground" />
            Правила ({rules.length})
          </h2>
          {learnedCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {learnedCount} выучено из оценок
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          {rules.map((rule, idx) => (
            <div
              key={idx}
              className="group flex items-start gap-2 rounded-xl border bg-background p-3 transition hover:border-primary/20"
            >
              <span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-muted-foreground">
                {idx + 1}
              </span>
              <Textarea
                rows={1}
                value={rule}
                onChange={(e) => updateRule(idx, e.target.value)}
                className="min-h-8 flex-1 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              {learnedRules.has(rule) && (
                <span
                  title="Правило выучено из оценок сессий"
                  className="mt-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                >
                  выучено
                </span>
              )}
              <button
                type="button"
                onClick={() => removeRule(idx)}
                className="mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add new rule */}
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Новое правило..."
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRule();
              }
            }}
          />
          <Button variant="outline" onClick={addRule} disabled={!newRule.trim()}>
            <Plus className="size-4" /> Добавить
          </Button>
        </div>
      </div>

      {/* History */}
      {playbook.history.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-muted-foreground" />
              История изменений
            </h2>
            <div className="space-y-2">
              {playbook.history.slice(0, 10).map((entry) => (
                <div
                  key={`${entry.version}-${entry.createdAt}`}
                  className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    v{entry.version}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {entry.direction === "reinforce" && (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          ↑ усиление
                        </span>
                      )}
                      {entry.direction === "correct" && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          ⚙ коррекция
                        </span>
                      )}
                      {entry.rating !== undefined && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {entry.rating}/5 ★
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-snug">{entry.change}</p>
                    {entry.rule && (
                      <p className="mt-1 rounded bg-primary/5 px-2 py-1 text-[11px] italic leading-snug text-primary">
                        + {entry.rule}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
