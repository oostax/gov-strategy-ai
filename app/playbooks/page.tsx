import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronRight, History, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function PlaybooksPage() {
  const playbooks = await getStorage().listPlaybooks();
  const totalRules = playbooks.reduce((sum, p) => sum + p.rules.length, 0);
  const totalLearned = playbooks.reduce(
    (sum, p) => sum + p.history.filter((h) => h.rating !== undefined).length,
    0,
  );

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Правила агента</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {playbooks.length} наборов · {totalRules} правил
              {totalLearned > 0
                ? ` · ${totalLearned} получено из оценок`
                : " · обучаются через оценки сессий"}
            </p>
          </div>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowLeft className="size-4" /> На главную
          </Link>
        </div>

        {/* Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {playbooks.map((playbook) => (
            <Link key={playbook.id} href={`/playbooks/${playbook.slug}`}>
              <Card className="h-full rounded-2xl transition hover:shadow-md">
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                        <BookOpen className="size-3.5 text-muted-foreground" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold leading-tight">
                          {playbook.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          v{playbook.version}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>

                  <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {playbook.description}
                  </p>

                  {/* Rules preview */}
                  <div className="space-y-1">
                    {playbook.rules.slice(0, 3).map((rule, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 text-[11px] leading-snug"
                      >
                        <Sparkles className="mt-0.5 size-3 shrink-0 text-primary/50" />
                        <span className="line-clamp-1">{rule}</span>
                      </div>
                    ))}
                    {playbook.rules.length > 3 && (
                      <p className="pl-4.5 text-[11px] text-muted-foreground">
                        +{playbook.rules.length - 3} ещё
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  {playbook.history.length > 1 && (
                    <div className="mt-auto flex items-center justify-between gap-1.5 border-t pt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <History className="size-3" />
                        {new Date(playbook.history[0]?.createdAt ?? playbook.updatedAt).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      {(() => {
                        const learned = playbook.history.filter((h) => h.rating !== undefined).length;
                        return learned > 0 ? (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                            {learned} из оценок
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
