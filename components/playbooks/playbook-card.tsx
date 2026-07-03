import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Playbook } from "@/lib/schemas/playbook";

export function PlaybookCard({ playbook }: { playbook: Playbook }) {
  return (
    <Link href={`/playbooks/${playbook.slug}`}>
      <Card className="h-full rounded-2xl transition hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="flex h-full flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <Badge variant="outline">v{playbook.version}</Badge>
            <span className="text-xs text-muted-foreground">{new Date(playbook.updatedAt).toLocaleDateString("ru-RU")}</span>
          </div>
          <h3 className="font-semibold">{playbook.name}</h3>
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{playbook.description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
