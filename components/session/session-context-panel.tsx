import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Playbook } from "@/lib/schemas/playbook";
import { roleLabels, taskLabels, type SessionProfile } from "@/lib/schemas/session";

export function SessionContextPanel({ session, playbooks }: { session: SessionProfile; playbooks: Playbook[] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Контекст</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge>{roleLabels[session.userRole]}</Badge>
          <Badge variant="secondary">{taskLabels[session.taskType]}</Badge>
          <Badge variant="outline">{horizonLabel(session.horizon)}</Badge>
        </div>
        <Info label="Для кого" value={session.audience} />
        <Info label="Регион" value={session.region || "не указан"} />
        <details className="rounded-2xl border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium">Правила агента · {playbooks.length || "будут выбраны"}</summary>
          <div className="mt-3 space-y-2">
            {playbooks.length === 0 ? <p className="text-xs text-muted-foreground">Появятся после генерации.</p> : playbooks.map((playbook) => (
              <div key={playbook.id} className="rounded-xl bg-background p-3">
                <p className="text-sm font-medium">{playbook.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{playbook.rules.join(" ")}</p>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function horizonLabel(value: string) {
  if (value === "12_months") return "12 месяцев";
  if (value === "3_months") return "3 месяца";
  if (value === "2028") return "до 2028";
  if (value === "2030") return "до 2030";
  return value;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
