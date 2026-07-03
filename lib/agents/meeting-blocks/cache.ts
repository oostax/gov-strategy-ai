/**
 * Ведомственный кэш открытых источников для встречи (аналог region-cache.ts).
 * Ключ = slug(регион)+slug(ведомство|ЛПР). TTL 7–14 дней. Резко снижает время и
 * стоимость повторных прогонов по тому же ведомству: сырые источники по блокам
 * (ministry/dossier/…) переиспользуются между сессиями. Кэш хранит СЫРЫЕ
 * источники; извлечённые факты — забота блоков и (в след. фазе) MemPalace.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  retrieveOpenSources,
  formatEvidenceForPrompt,
  type WebEvidence,
} from "@/lib/integrations/web-retrieval";
import { canonicalRegionName } from "@/lib/data/region-normalization";
import { regionNameToSlug } from "@/lib/storage/region-resolver";
import type { Source } from "@/lib/schemas/structured-output";
import type { MeetingBlockKind } from "./types";

const GENERAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MINISTRY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface MeetingBlockCacheEntry {
  evidence: WebEvidence[];
  evidenceText: string;
  sources: Source[];
  fetchedAt: string;
}

export interface MinistryCache {
  cacheKey: string;
  region: string;
  ministry: string;
  fetchedAt: string;
  blocks: Partial<Record<MeetingBlockKind, MeetingBlockCacheEntry>>;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'`]/g, "")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Стабильный ключ кэша по региону и ведомству/ЛПР. */
export function cacheKeyForMinistry(
  region: string,
  ministryOrLpr: string,
): string {
  const regionSlug = regionNameToSlug(canonicalRegionName(region)) || slug(region) || "fed";
  const subject = slug(ministryOrLpr) || "ministry";
  return `${regionSlug}__${subject}`;
}

function cacheDir(): string {
  return path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "meeting-cache",
  );
}

function cachePath(cacheKey: string): string {
  return path.join(cacheDir(), `${cacheKey}.json`);
}

function ttlForBlock(kind: MeetingBlockKind): number {
  return kind === "ministry" ? MINISTRY_TTL_MS : GENERAL_TTL_MS;
}

function isFresh(entry: MeetingBlockCacheEntry | undefined, kind: MeetingBlockKind): boolean {
  if (!entry) return false;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  return age < ttlForBlock(kind);
}

/** Полезность записи: достаточно источников и есть открытые (contentFetched/оф.домены). */
function isUseful(entry: MeetingBlockCacheEntry | undefined, kind: MeetingBlockKind): boolean {
  if (!entry) return false;
  const evidence = entry.evidence ?? [];
  const verified = evidence.filter(
    (item) =>
      item.contentFetched ||
      /(^|\.)gov\.ru|rosstat|gks|pravo|budget|zakupki|tatarstan|digital/i.test(item.url),
  );
  if (kind === "ministry") return evidence.length >= 3 && verified.length >= 1;
  return evidence.length >= 2;
}

async function readCache(cacheKey: string): Promise<MinistryCache | null> {
  try {
    const raw = await fs.readFile(cachePath(cacheKey), "utf-8");
    return JSON.parse(raw) as MinistryCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: MinistryCache): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  const tmp = `${cachePath(cache.cacheKey)}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), "utf-8");
  await fs.rename(tmp, cachePath(cache.cacheKey));
}

function toSources(evidence: WebEvidence[]): Source[] {
  return evidence
    .slice(0, 6)
    .filter((e) => e.contentFetched || /^https?:\/\//.test(e.url))
    .map((e) => ({
      title: e.title,
      url: e.url,
      excerpt: e.snippet.slice(0, 220),
      isVerified: e.contentFetched || false,
    }));
}

/**
 * Достаёт evidence блока из кэша или ищет свежее и кэширует. Именные/тематические
 * запросы формирует сам блок (передаются сюда). Пустой результат не кэшируем.
 */
export async function getOrRefreshMeetingEvidence(
  cacheKey: string,
  region: string,
  ministry: string,
  kind: MeetingBlockKind,
  queries: string[],
): Promise<MeetingBlockCacheEntry | null> {
  const cache = await readCache(cacheKey);
  const entry = cache?.blocks[kind];
  if (isFresh(entry, kind) && isUseful(entry, kind)) return entry!;

  const evidence = await retrieveOpenSources({
    region,
    focusTopic: queries.slice(0, 2).join(" "),
    queries,
    limit: kind === "ministry" ? 6 : 4,
  });
  if (!evidence.length) return entry ?? null;

  const fresh: MeetingBlockCacheEntry = {
    evidence,
    evidenceText: formatEvidenceForPrompt(evidence),
    sources: toSources(evidence),
    fetchedAt: new Date().toISOString(),
  };

  try {
    const base: MinistryCache = cache ?? {
      cacheKey,
      region: canonicalRegionName(region),
      ministry,
      fetchedAt: new Date().toISOString(),
      blocks: {},
    };
    base.blocks[kind] = fresh;
    base.fetchedAt = new Date().toISOString();
    await writeCache(base);
  } catch (err) {
    console.warn(`[meeting-cache] write failed: ${err instanceof Error ? err.message : err}`);
  }

  return fresh;
}
