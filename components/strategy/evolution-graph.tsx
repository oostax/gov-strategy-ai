import { ArrowRight, BrainCircuit, GitBranch, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvolutionResult } from "@/lib/schemas/playbook";

interface EvolutionItem {
  id: string;
  result: EvolutionResult;
  createdAt: string;
}

export function EvolutionGraph({ items }: { items: EvolutionItem[] }) {
  const unique = uniqueEvolution(items);
  if (items.length === 0) return null;

  const latest = unique[0];
  const learnedRules = unique.map((item) => item.result.newRule).slice(0, 3);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="size-4" />
          Обучение агента
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
          <Node icon={MessageSquareText} label="Обратная связь" value={`${items.length} циклов`} />
          <Arrow />
          <Node icon={BrainCircuit} label="Правила" value={`${learnedRules.length || 1} активных`} active />
          <Arrow />
          <Node icon={GitBranch} label="Playbook" value={latest?.result.playbookName || "Режим"} />
        </div>

        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Что изменилось в поведении</p>
            <Badge variant="secondary">{latest ? new Date(latest.createdAt).toLocaleDateString("ru-RU") : "дата не указана"}</Badge>
          </div>
          <div className="space-y-2">
            {learnedRules.map((rule) => (
              <p key={rule} className="rounded-lg bg-background px-3 py-2 leading-5">{compact(rule)}</p>
            ))}
          </div>
        </div>

        {latest && (
          <p className="rounded-xl border px-3 py-2 text-muted-foreground">
            Последний эффект: {compact(latest.result.improvement)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Node({ icon: Icon, label, value, active = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; active?: boolean }) {
  return (
    <div className={`rounded-xl border p-2.5 ${active ? "border-primary/30 bg-primary/5" : "bg-background"}`}>
      <Icon className={`mb-2 size-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function Arrow() {
  return <ArrowRight className="mt-8 size-4 text-muted-foreground" />;
}

function uniqueEvolution(items: EvolutionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.result.playbookName}:${item.result.newRule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compact(value: string) {
  return value.length > 180 ? `${value.slice(0, 177).trim()}...` : value;
}
