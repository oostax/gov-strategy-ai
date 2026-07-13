"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { DataGap, Source } from "@/lib/schemas/structured-output";

// Руководителю показываем ТОЛЬКО источники — не список «что проверить».
// hypotheses/dataGaps принимаем для совместимости вызовов, но не рендерим как задачи:
// это внутренний сигнал системы для автодозапроса, а не домашка руководителя.
export function SourcesFooter({
  sources,
}: {
  sources: Source[];
  hypotheses?: string[];
  dataGaps?: DataGap[];
}) {
  const [open, setOpen] = useState(false);
  const verified = sources.filter((s) => s.isVerified);
  const unverified = sources.filter((s) => !s.isVerified);
  const previewSources = (verified.length ? verified : unverified).slice(0, 3);

  if (sources.length === 0) return null;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-muted-foreground" /> Источники
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700">
                текст извлечён: {verified.length}
              </span>
              {unverified.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                  без полного текста: {unverified.length}
                </span>
              )}
            </div>
          </div>
          {(verified.length > 3 || unverified.length > 0) && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
            >
              {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {open ? "Свернуть" : "Подробнее"}
            </button>
          )}
        </div>

        {previewSources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewSources.map((src, idx) => (
              <SourceLink key={idx} src={src} />
            ))}
          </div>
        )}

        {open && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-600" /> Страницы с извлечённым текстом
              </p>
              {verified.length === 0 ? (
                <p className="text-xs text-muted-foreground">Полный текст источников не извлечён.</p>
              ) : (
                verified.map((src, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/20 px-2.5 py-2">
                    <SourceTitle src={src} />
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{src.excerpt}</p>
                  </div>
                ))
              )}
            </div>

            {unverified.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <AlertCircle className="size-3.5 text-muted-foreground" /> Без полного текста
                </p>
                {unverified.map((src, idx) => (
                  <div key={`uv-${idx}`} className="rounded-lg border bg-muted/20 px-2.5 py-2">
                    <SourceTitle src={src} />
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{src.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SourceLink({ src }: { src: Source }) {
  if (!src.url) {
    return <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium">{src.title}</span>;
  }
  return (
    <a
      href={src.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/5"
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">{src.title}</span>
    </a>
  );
}

function SourceTitle({ src }: { src: Source }) {
  if (!src.url) return <p className="text-xs font-medium">{src.title}</p>;
  return (
    <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-xs font-medium text-primary hover:underline">
      <ExternalLink className="mt-0.5 size-3 shrink-0" />
      <span>{src.title}</span>
    </a>
  );
}
