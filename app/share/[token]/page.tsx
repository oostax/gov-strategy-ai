import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StrategyOutput } from "@/components/strategy/strategy-output";
import { taskLabels } from "@/lib/schemas/session";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const details = await getStorage().getSessionByShareToken(token);
  if (!details) return notFound();
  const output = details.outputs[0] ?? null;
  const { session } = details;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">ИИ-штаб госсектора · поделено</p>
              <h1 className="text-sm font-semibold">
                {session.title?.trim() || session.focusTopic || "Стратегический материал"}
              </h1>
            </div>
          </div>
          <Link
            href="/"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Открыть приложение <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Card className="mb-4 rounded-2xl">
          <CardContent className="flex flex-wrap gap-3 p-4 text-sm">
            <Badge variant="secondary">{taskLabels[session.taskType]}</Badge>
            {session.region && <Badge variant="outline">{session.region}</Badge>}
            {session.audience && (
              <span className="text-muted-foreground">Для: {session.audience}</span>
            )}
            {session.focusTopic && (
              <span className="text-muted-foreground">{session.focusTopic}</span>
            )}
          </CardContent>
        </Card>

        {output ? (
          <StrategyOutput output={output} />
        ) : (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Материал ещё не сформирован автором сессии.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
