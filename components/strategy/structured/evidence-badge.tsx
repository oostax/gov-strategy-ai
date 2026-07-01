"use client";

import { ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";

interface EvidenceBadgeProps {
  source?: string | null;
  sourceUrl?: string | null;
  excerpt?: string | null;
}

export function EvidenceBadge({ source, sourceUrl, excerpt }: EvidenceBadgeProps) {
  if (!source && !sourceUrl) {
    return (
      <span
        title="Факт не подтверждён источником"
        className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
      >
        <AlertTriangle className="size-3" /> гипотеза
      </span>
    );
  }

  const domain = source || (sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : "источник");
  const children = (
    <span
      title={excerpt || `Источник: ${domain}`}
      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
    >
      <ShieldCheck className="size-3" /> {domain}
    </span>
  );

  if (!sourceUrl) return children;

  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:underline"
      title={excerpt || `Открыть источник: ${domain}`}
    >
      <ShieldCheck className="size-3" /> {domain} <ExternalLink className="size-2.5" />
    </a>
  );
}

export function UnsourcedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      нет источника
    </span>
  );
}
