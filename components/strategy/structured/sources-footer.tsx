"use client";

import { AlertCircle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Source } from "@/lib/schemas/structured-output";

export function SourcesFooter({
  sources,
  hypotheses,
}: {
  sources: Source[];
  hypotheses: string[];
}) {
  const verified = sources.filter((s) => s.isVerified);
  const unverified = sources.filter((s) => !s.isVerified);

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <ShieldCheck className="size-4" /> Источники и проверки
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Verified sources */}
        <Card className="rounded-xl">
          <CardContent className="p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Подтверждённые источники
            </p>
            {verified.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Открытые источники не найдены за время поиска.
              </p>
            ) : (
              <div className="space-y-1.5">
                {verified.map((src, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/20 px-2.5 py-2">
                    <div className="flex items-start gap-1.5">
                      {src.url ? (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <ExternalLink className="size-3 shrink-0" />
                          {src.title}
                        </a>
                      ) : (
                        <p className="text-xs font-medium">{src.title}</p>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {src.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hypotheses */}
        <Card className="rounded-xl">
          <CardContent className="p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <AlertCircle className="size-3.5 text-amber-600" /> Гипотезы — нужно проверить
            </p>
            {hypotheses.length === 0 && unverified.length === 0 ? (
              <p className="text-xs text-muted-foreground">Все утверждения подтверждены.</p>
            ) : (
              <div className="space-y-1.5">
                {hypotheses.map((h, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-lg border border-amber-200/50 bg-amber-50/30 px-2.5 py-2 dark:border-amber-900/30 dark:bg-amber-950/20"
                  >
                    <Badge
                      variant="outline"
                      className="mt-0.5 shrink-0 border-amber-300 text-[9px] text-amber-700 dark:text-amber-300"
                    >
                      ?
                    </Badge>
                    <p className="text-xs leading-snug">{h}</p>
                  </div>
                ))}
                {unverified.map((src, idx) => (
                  <div
                    key={`uv-${idx}`}
                    className="rounded-lg border bg-muted/20 px-2.5 py-2"
                  >
                    <p className="text-xs font-medium">{src.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{src.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
