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
import type { BlockKind } from "@/lib/agents/region-blocks/types";

const GENERAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const BUDGET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Версия схемы/логики сбора доказательств. Повышать при изменениях, которые
 * делают старые кэши некорректными по СОСТАВУ (не только по свежести).
 * v2: статья региона в Википедии подключается ко всем блокам (иначе
 *     competition/stakeholders оставались на генерик-страницах и выходили
 *     пустыми). Записи со старой версией принудительно считаются устаревшими,
 *     чтобы регион пересобрался с полноценными источниками — без ручной чистки.
 */
const CACHE_VERSION = 2;

const BLOCK_QUERIES: Record<BlockKind, (region: string) => string[]> = {
  summary: (r) => [
    `${r} официальный паспорт региона население экономика`,
    `${r} население Росстат ${new Date().getFullYear() - 1}`,
    `${r} ВРП структура экономики Росстат`,
    `${r} бюджет 2026 доходы расходы`,
    `${r} социально-экономическое положение`,
    `${r} население ВРП экономика`,
  ],
  industries: (r) => [
    `${r} структура экономики ВРП отрасли`,
    `${r} промышленность крупнейшие предприятия официальный сайт`,
    `${r} сельское хозяйство производство официальный сайт`,
    `${r} инвестиционный паспорт промышленность предприятия`,
    `${r} социально-экономическое положение промышленность сельское хозяйство строительство торговля статистика`,
    `${r} реестр промышленных предприятий`,
  ],
  budget: (r) => {
    const year = new Date().getFullYear();
    return [
      `${r} закон о бюджете ${year} доходы расходы млрд официальный`,
      `${r} бюджет для граждан ${year} ${year + 1} ${year + 2} pdf`,
      `${r} министерство финансов бюджет ${year} доходы расходы`,
      `${r} структура расходов бюджета ${year} образование здравоохранение социальная политика`,
      `${r} государственные программы бюджет ${year} расходы`,
      `${r} поправки в бюджет ${year} доходы расходы дефицит`,
    ];
  },
  scenarios: (r) => [
    `${r} стратегия социально-экономического развития до 2030 pdf`,
    `${r} прогноз социально-экономического развития ${new Date().getFullYear()} ${new Date().getFullYear() + 2}`,
    `${r} государственные программы до 2030 приоритеты`,
    `${r} приоритеты развития на 5 лет губернатор`,
  ],
  competition: (r) => [
    `${r} закупки информационная система цифровая платформа`,
    `${r} контракт внедрение информационной системы регион`,
    `${r} оператор цифровой платформы регион`,
    `${r} Ростелеком БФТ 1С Диалог Регионы информационная система`,
  ],
  stakeholders: (r) => [
    `${r} губернатор официальный сайт биография`,
    `${r} правительство заместители председателя официальный сайт`,
    `${r} комитет информационных технологий руководитель официальный сайт`,
    `${r} министерство финансов руководитель официальный сайт`,
    `${r} комитет экономической политики руководитель официальный сайт`,
    `${r} губернатор заместители руководители`,
  ],
  priorities: (r) => [
    `${r} стратегия социально-экономического развития до 2030 pdf`,
    `${r} план мероприятий стратегия социально-экономического развития`,
    `${r} национальные проекты регион ${new Date().getFullYear()}`,
    `${r} государственные программы ${new Date().getFullYear()} ${new Date().getFullYear() + 2}`,
    `${r} приоритеты развития на 5 лет`,
  ],
};

export interface BlockCacheEntry {
  evidence: WebEvidence[];
  evidenceText: string;
  sources: Source[];
  fetchedAt: string;
  /** Версия логики сбора (см. CACHE_VERSION). Отсутствие = довирусная запись. */
  v?: number;
}

export interface RegionCache {
  regionId: string;
  regionName: string;
  fetchedAt: string;
  blocks: Partial<Record<BlockKind, BlockCacheEntry>>;
}

export function cacheKeyForRegion(regionId: string | undefined | null, regionName: string): string {
  const id = regionId?.trim();
  if (id) return id;
  return regionNameToSlug(canonicalRegionName(regionName));
}

function cacheDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "region-cache");
}

function cachePath(regionId: string): string {
  return path.join(cacheDir(), `${regionId}.json`);
}

function ttlForBlock(kind: BlockKind): number {
  return kind === "budget" ? BUDGET_TTL_MS : GENERAL_TTL_MS;
}

export function isBlockFresh(entry: BlockCacheEntry | undefined, kind: BlockKind): boolean {
  if (!entry) return false;
  // Записи со старой версией логики сбора считаем устаревшими (принудительный
  // рефреш с актуальными источниками, напр. Википедией для всех блоков).
  if ((entry.v ?? 1) < CACHE_VERSION) return false;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  return age < ttlForBlock(kind);
}

function isBlockUseful(entry: BlockCacheEntry | undefined, kind: BlockKind): boolean {
  if (!entry) return false;
  const evidence = entry.evidence ?? [];
  const verified = evidence.filter((item) => item.contentFetched || /(^|\.)gov\.ru|rosstat|gks|pravo|budget|zakupki/i.test(item.url));
  if (["budget", "industries", "priorities", "stakeholders"].includes(kind)) {
    return evidence.length >= 4 && verified.length >= 2;
  }
  return evidence.length >= 3 && verified.length >= 1;
}

export function isCacheFresh(cache: RegionCache | null): boolean {
  if (!cache) return false;
  const criticalBlocks: BlockKind[] = ["summary", "industries", "budget", "scenarios"];
  return criticalBlocks.every((kind) => {
    const entry = cache.blocks[kind];
    return isBlockFresh(entry, kind) && isBlockUseful(entry, kind);
  });
}

export async function readRegionCache(regionId: string): Promise<RegionCache | null> {
  try {
    const raw = await fs.readFile(cachePath(regionId), "utf-8");
    return JSON.parse(raw) as RegionCache;
  } catch {
    return null;
  }
}

export async function writeRegionCache(cache: RegionCache): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  const tmp = `${cachePath(cache.regionId)}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), "utf-8");
  await fs.rename(tmp, cachePath(cache.regionId));
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

async function directSearxng(query: string, limit: number): Promise<WebEvidence[]> {
  return retrieveOpenSources({
    region: query.split(" ").slice(0, 2).join(" "),
    focusTopic: query,
    queries: [query],
    limit,
  });
}

export async function fetchBlockEvidence(
  regionName: string,
  kind: BlockKind,
): Promise<BlockCacheEntry> {
  const queries = BLOCK_QUERIES[kind](regionName);
  const evidence = await retrieveOpenSources({
    region: regionName,
    focusTopic: queries.slice(0, 2).join(" "),
    queries,
    limit: 8,
  });
  return {
    evidence,
    evidenceText: formatEvidenceForPrompt(evidence),
    sources: toSources(evidence),
    fetchedAt: new Date().toISOString(),
    v: CACHE_VERSION,
  };
}

export async function refreshRegionCache(
  regionId: string,
  regionName: string,
  blockKinds?: BlockKind[],
): Promise<RegionCache> {
  const canonical = canonicalRegionName(regionName);
  const existing = await readRegionCache(regionId);
  const canReuseExisting = !existing || canonicalRegionName(existing.regionName) === canonical;
  const kinds = blockKinds ?? (["summary", "budget", "industries", "priorities", "scenarios", "competition", "stakeholders"] as BlockKind[]);

  console.log(`[region-cache] refreshing ${regionId} (${canonical}): ${kinds.join(", ")}`);

  const blocks: RegionCache["blocks"] = canReuseExisting ? { ...(existing?.blocks || {}) } : {};
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const entry = await fetchBlockEvidence(canonical, kind);
      blocks[kind] = entry;
    } catch (err) {
      console.warn(`[region-cache] failed ${kind}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const cache: RegionCache = {
    regionId,
    regionName: canonical,
    fetchedAt: new Date().toISOString(),
    blocks,
  };

  await writeRegionCache(cache);
  console.log(`[region-cache] saved ${regionId}: ${Object.keys(blocks).length} blocks`);
  return cache;
}

export async function getOrRefreshBlockEvidence(
  regionId: string,
  regionName: string,
  kind: BlockKind,
): Promise<BlockCacheEntry | null> {
  const canonical = canonicalRegionName(regionName);
  const cache = await readRegionCache(regionId);
  if (cache && canonicalRegionName(cache.regionName) !== canonical) {
    console.warn(`[region-cache] ignored cache with another region: key=${regionId} cached="${cache.regionName}" requested="${canonical}"`);
    const refreshed = await refreshRegionCache(regionId, canonical, [kind]);
    return refreshed.blocks[kind] ?? null;
  }
  const entry = cache?.blocks[kind];
  if (isBlockFresh(entry, kind) && isBlockUseful(entry, kind)) return entry!;
  if (entry && isBlockFresh(entry, kind)) {
    console.log(`[region-cache] refreshing weak fresh block kind=${kind} sources=${entry.evidence?.length ?? 0}`);
  }

  const refreshed = await refreshRegionCache(regionId, regionName, [kind]);
  return refreshed.blocks[kind] ?? null;
}

export function getStaleBlocks(cache: RegionCache | null): BlockKind[] {
  if (!cache) return ["summary", "budget", "industries", "priorities", "scenarios", "competition", "stakeholders"] as BlockKind[];
  const all: BlockKind[] = ["summary", "budget", "industries", "priorities", "scenarios", "competition", "stakeholders"];
  return all.filter((kind) => {
    const entry = cache.blocks[kind];
    return !isBlockFresh(entry, kind) || !isBlockUseful(entry, kind);
  });
}

export function getCacheStatus(cache: RegionCache | null): {
  exists: boolean;
  fetchedAt: string | null;
  fresh: boolean;
  staleBlocks: BlockKind[];
  blockCount: number;
} {
  if (!cache) {
    return { exists: false, fetchedAt: null, fresh: false, staleBlocks: getStaleBlocks(null), blockCount: 0 };
  }
  const stale = getStaleBlocks(cache);
  return {
    exists: true,
    fetchedAt: cache.fetchedAt,
    fresh: stale.length === 0,
    staleBlocks: stale,
    blockCount: Object.keys(cache.blocks).length,
  };
}
