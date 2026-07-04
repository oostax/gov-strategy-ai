/**
 * Дополнительные бесплатные источники открытых данных.
 * Все провайдеры здесь — без free trial, с публичным доступом.
 */

import type { WebEvidence } from "./web-retrieval";

export interface OpenDataSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  fetchedAt: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

export function isTrustedOpenData(url: string) {
  const trusted = [
    "zakupki.gov.ru",
    "rosstat.gov.ru",
    "kubregionstat.ru",
    "openbudget23region.ru",
    "minfin.krasnodar.ru",
    "admkrai.krasnodar.ru",
    "pravo.gov.ru",
    "publication.pravo.gov.ru",
    "data.mos.ru",
    "cbr.ru",
  ];
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return trusted.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "open web";
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWebEvidence(items: OpenDataSource[]): WebEvidence[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    source: item.source,
    query: item.query,
    fetchedAt: item.fetchedAt,
  }));
}

function parseZakupkiHtml(html: string, query: string): OpenDataSource[] {
  const results: OpenDataSource[] = [];
  const regex =
    /<div[^>]*class="[^"]*registry-entry__header[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*registry-entry__header-mid__number[^"]*">([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="[^"]*registry-entry__body-value[^"]*">([\s\S]*?)<\/div>/g;
  for (const match of html.matchAll(regex)) {
    const href = match[1].trim();
    const url = href.startsWith("http") ? href : `https://zakupki.gov.ru${href}`;
    const number = decodeHtml(match[2]);
    const value = decodeHtml(match[3]);
    if (results.some((r) => r.url === url)) continue;
    results.push({
      title: `Закупка ${number}`,
      url,
      snippet: value || `Закупка по запросу: ${query}`,
      source: "zakupki.gov.ru",
      query,
      fetchedAt: new Date().toISOString(),
    });
    if (results.length >= 5) break;
  }
  return results;
}

export async function searchZakupki(query: string): Promise<WebEvidence[]> {
  try {
    const url = `https://zakupki.gov.ru/epz/order/extendedsearch/results.html?search-filter=Дате+размещения&pageNumber=1&sortDirection=false&recordsPerPage=10&sortBy=UPDATE_DATE&fz223=on&fz44=on&af=on&ca=on&pc=on&pa=on&currencyIdGeneral=-1&searchString=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html", "Accept-Language": "ru-RU,ru;q=0.9" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return toWebEvidence(parseZakupkiHtml(html, query));
  } catch (err) {
    console.warn(`[open-data] zakupki search failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

interface WikiSummary {
  title: string;
  extract: string;
  content_urls?: { desktop?: { page: string } };
}

export async function searchWikipedia(region: string): Promise<WebEvidence[]> {
  const results: OpenDataSource[] = [];
  try {
    const searchUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(region)}&format=json&origin=*&srlimit=3`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const titles = searchData.query?.search?.map((s) => s.title) ?? [];

    for (const title of titles.slice(0, 2)) {
      const summaryUrl = `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(summaryUrl, {
        headers: { "User-Agent": BROWSER_UA, "Accept-Language": "ru" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const summary = (await res.json()) as WikiSummary;
      if (!summary.extract) continue;
      const url = summary.content_urls?.desktop?.page || `https://ru.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      results.push({
        title: summary.title,
        url,
        snippet: summary.extract.slice(0, 700),
        source: "ru.wikipedia.org",
        query: region,
        fetchedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(`[open-data] wikipedia failed: ${err instanceof Error ? err.message : err}`);
  }
  return toWebEvidence(results);
}

/**
 * Достаёт из ПОЛНОЙ статьи Википедии региона тематические пассажи (бюджет,
 * ВРП, экономика, отрасли). Нужна, потому что summary — это лишь вступление
 * (география/население), а бюджетные цифры лежат глубоко в теле статьи и
 * обрезаются стандартным лимитом evidence. Возвращает WebEvidence с фактами,
 * пригодными для прямой подстановки в промпт блока (budget/industries).
 * Живой источник, без хардкода: работает для любого региона.
 */
/**
 * Полный плоский текст статьи региона через MediaWiki extracts API.
 * Тянем СРАЗУ по имени региона (redirects=1 сам разрешит перенаправление) —
 * без промежуточного list=search, который был лишней точкой отказа и делал
 * вызов флейки. Один ретрай на сетевую нестабильность. Заголовок берём из
 * ответа (нормализованный/после редиректа).
 */
async function fetchWikiExtract(region: string): Promise<{ title: string; extract: string } | null> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    redirects: "1",
    titles: region,
    format: "json",
  });
  const url = `https://ru.wikipedia.org/w/api.php?${params.toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> };
      };
      const pages = Object.values(data.query?.pages ?? {});
      const page = pages.find((p) => typeof p.extract === "string" && (p.extract as string).length >= 200);
      if (page) return { title: page.title || region, extract: page.extract as string };
    } catch {
      /* ретрай */
    }
  }
  return null;
}

export async function fetchWikiFacts(
  region: string,
  keywords: string[],
  maxChars = 3500,
): Promise<WebEvidence | null> {
  try {
    const article = await fetchWikiExtract(region);
    if (!article) return null;
    const title = article.title;
    const full = article.extract;

    // 3) Пассажи вокруг ключевых слов (до 2 вхождений на слово), дедуп, лимит.
    const lower = full.toLowerCase();
    const picks: string[] = [];
    const seen = new Set<string>();
    for (const kw of keywords) {
      const needle = kw.toLowerCase();
      let from = 0;
      for (let n = 0; n < 2; n++) {
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        const start = Math.max(0, idx - 200);
        const end = Math.min(full.length, idx + 400);
        const seg = full.slice(start, end).replace(/\s+/g, " ").trim();
        const key = seg.slice(0, 48);
        if (seg.length > 30 && !seen.has(key)) {
          seen.add(key);
          picks.push(seg);
        }
        from = idx + needle.length;
      }
    }
    if (picks.length === 0) return null;
    let excerpt = picks.join(" … ");
    if (excerpt.length > maxChars) excerpt = `${excerpt.slice(0, maxChars)}…`;

    const wikiUrl = `https://ru.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s/g, "_"))}`;
    return {
      title: `Википедия: ${title} — экономика и бюджет`,
      url: wikiUrl,
      snippet: excerpt,
      fullText: excerpt,
      source: "ru.wikipedia.org",
      contentFetched: true,
      query: region,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[open-data] wiki facts failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function jinaReader(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 80 ? text.slice(0, 12000) : null;
  } catch (err) {
    console.warn(`[open-data] jina reader failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function bingRssSearch(query: string): Promise<WebEvidence[]> {
  try {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&mkt=ru-RU&setlang=ru`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const results: OpenDataSource[] = [];
    const pattern =
      /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g;
    for (const match of xml.matchAll(pattern)) {
      const title = decodeHtml(match[1]);
      const link = decodeHtml(match[2]);
      const desc = decodeHtml(match[3]);
      if (!/^https?:\/\//.test(link)) continue;
      if (results.some((r) => r.url === link)) continue;
      results.push({
        title,
        url: link,
        snippet: desc,
        source: sourceFromUrl(link),
        query,
        fetchedAt: new Date().toISOString(),
      });
      if (results.length >= 6) break;
    }
    return toWebEvidence(results);
  } catch (err) {
    console.warn(`[open-data] bing rss failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
