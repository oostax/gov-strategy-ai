import Link from "next/link";
import { Home } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getStorage } from "@/lib/storage/local-json-storage";
import { EmptySessionsTrigger } from "@/components/session/new-session-trigger";
import { SessionRegistry } from "@/components/session/session-registry";

export default async function SessionsPage() {
  const sessions = await getStorage().listSessions();
  return (
    <AppShell>
      <div className="mb-3 rounded-2xl border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="secondary">История</Badge>
              <span className="text-xs text-muted-foreground">{sessions.length} сессий</span>
            </div>
            <h1 className="truncate text-lg font-semibold">Стратегические сессии</h1>
          </div>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Home className="size-4" />
            На главную
          </Link>
        </div>
      </div>
      {sessions.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Сессий пока нет.</p>
            <EmptySessionsTrigger />
          </CardContent>
        </Card>
      ) : (
        <SessionRegistry sessions={sessions} />
      )}
    </AppShell>
  );
}
