import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { roleLabels, taskLabels, type SessionProfile } from "@/lib/schemas/session";

export function SessionCard({ session }: { session: SessionProfile }) {
  return (
    <Link href={`/sessions/${session.id}`}>
      <Card className="rounded-2xl transition hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Badge variant="secondary">{roleLabels[session.userRole]}</Badge>
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold">{session.focusTopic}</h3>
          <p className="mt-2 text-xs text-muted-foreground">{taskLabels[session.taskType]} · {session.region || "регион не указан"}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
