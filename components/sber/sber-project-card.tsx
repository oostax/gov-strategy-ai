import { AlertCircle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SberGovProject } from "@/lib/storage/sber-projects";

const statusTone: Record<string, string> = {
  анонс: "bg-muted text-muted-foreground",
  пилот: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "в работе": "bg-primary/10 text-primary",
  масштабирование: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  реализован: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

function toneFor(status: string) {
  const key = Object.keys(statusTone).find((k) => status.toLowerCase().includes(k));
  return key ? statusTone[key] : "bg-muted text-muted-foreground";
}

export function SberProjectCard({ project }: { project: SberGovProject }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{project.name}</h3>
          <Badge variant="secondary" className={`shrink-0 text-[10px] ${toneFor(project.status)}`}>
            {project.status}
          </Badge>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{project.summary}</p>

        <div className="mt-2.5 flex flex-wrap gap-1">
          {project.sberProducts.slice(0, 4).map((prod) => (
            <span
              key={prod}
              className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium"
            >
              {prod}
            </span>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{project.scope}</span>
          <a
            href={project.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" />
            источник
          </a>
        </div>

        {project.caveat && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200/50 bg-amber-50/30 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertCircle className="mt-0.5 size-3 shrink-0" />
            {project.caveat}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
