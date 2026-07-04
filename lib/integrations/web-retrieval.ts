/**
 * Поиск открытых источников для агента.
 *
 * Стратегия (по статье с Habr):
 * 1. Headless браузер + stealth (puppeteer-extra) — основной метод, обходит детекцию
 * 2. HTTP-запрос к DuckDuckGo — быстрый fallback если браузер недоступен
 */

import { browserSearch } from "./browser-search";
import { fetchSourceContent } from "./content-fetcher";
import { callLLM } from "@/lib/agents/llm-client";
import { searchZakupki, searchWikipedia, jinaReader, isTrustedOpenData } from "./open-data-retrieval";

const nativeFetch: typeof fetch = fetch;

export interface WebEvidence {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query?: string;
  fetchedAt?: string;
  /** Оценка релевантности теме 0–1 (проставляется проверкой релевантности). */
  relevance?: number;
  /** Полный текст первоисточника (PDF/HTML), если удалось извлечь. Содержит точные цифры. */
  fullText?: string;
  /** Удалось открыть страницу/документ, а не только получить поисковый сниппет. */
  contentFetched?: boolean;
}

// ── Свойство-ориентированная модель доверия (без хардкода регионов) ───────────
// Источник оценивается по ВЫЧИСЛИМЫМ признакам домена, а не по членству в
// захардкоженном whitelist. Это работает для любого из 89 субъектов РФ
// одинаково: официальный портал нового региона распознаётся по зоне, а не по
// тому, что кто-то внёс его руками.

/** Настраиваемые пороги — вынесены наверх, чтобы крутить без переписывания логики. */
export const RELEVANCE_THRESHOLD = 0.35;
export const MAX_PER_HOST = 3;

/** Федеральные официальные/первичные домены (немного, стабильны, не региональные). */
const FEDERAL_OFFICIAL = [
  "gov.ru",
  "gosuslugi.ru",
  "pravo.gov.ru",
  "publication.pravo.gov.ru",
  "consultant.ru",
  "garant.ru",
  "cbr.ru",
  "rosstat.gov.ru",
  "gks.ru",
  "zakupki.gov.ru",
  "budget.gov.ru",
  "kremlin.ru",
];

/** Деловые СМИ: полезны как контекст, но НЕ дают официального флора релевантности. */
const MEDIA_OUTLETS = [
  "tass.ru",
  "rbc.ru",
  "vedomosti.ru",
  "kommersant.ru",
  "interfax-russia.ru",
  "interfax.ru",
  "rg.ru",
  "ria.ru",
  "iz.ru",
  "fontanka.ru",
  "ru.wikipedia.org",
];

const SEARCH_JUNK_HOSTS = [
  "dzen.ru",
  "pinterest.com",
  "pinterest.ru",
  "ok.ru",
  "rutube.ru",
  "youtube.com",
  "youtu.be",
  "vk.com",
  "market.yandex.ru",
  "ozon.ru",
  "wildberries.ru",
];

function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "open web";
  }
}

function hostMatches(host: string, domains: string[]) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** СМИ — по списку выше (их немного и они федеральные, не региональные). */
function isMediaOutlet(url: string) {
  return hostMatches(sourceFromUrl(url), MEDIA_OUTLETS);
}

/**
 * Официальный/государственный источник — по ВЫЧИСЛИМЫМ признакам зоны, а не по
 * whitelist. Покрывает любой регион: gov.ru, gks.ru, муниципальные/региональные
 * госпорталы (.gov.spb.ru, mos.ru-подобные), статорганы (NN.rosstat.gov.ru),
 * домены «бюджет/openbudget» и т.п.
 */
function isOfficialByZone(url: string) {
  const host = sourceFromUrl(url);
  if (hostMatches(host, FEDERAL_OFFICIAL)) return true;
  // Госзоны: что-то.gov.ru, что-то.gov.<регион>.ru, *.gks.ru
  if (/(^|\.)gov\.ru$/.test(host)) return true;
  if (/(^|\.)gov\.[a-z-]+\.ru$/.test(host)) return true; // gov.spb.ru и аналоги
  if (/(^|\.)gks\.ru$/.test(host)) return true; // территориальные органы Росстата
  if (/(^|\.)rosstat\.gov\.ru$/.test(host)) return true; // NN.rosstat.gov.ru
  // Тематические госпризнаки в самом домене (бюджет/закупки/минфин/администрация).
  if (/(^|[.-])(openbudget|budget|minfin|admkrai|adm|government|duma|oblduma|mosreg)/.test(host)) return true;
  return false;
}

/** Доверенный = официальный по зоне ИЛИ деловое СМИ (для бакетирования/страховки). */
function isTrusted(url: string) {
  return isOfficialByZone(url) || isMediaOutlet(url);
}

function isProcurementRecord(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (!host.endsWith("zakupki.gov.ru")) return false;
    return /\/epz\/(?:contract|contractfz223|order|complaint)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isJunkSearchResult(item: WebEvidence) {
  const host = sourceFromUrl(item.url);
  if (hostMatches(host, SEARCH_JUNK_HOSTS)) return true;
  if (!item.title?.trim()) return true;
  if (!item.snippet?.trim() && !isOfficialByZone(item.url) && !isTrustedOpenData(item.url)) return true;
  if (isBlockedPageText(`${item.title}\n${item.snippet}`)) return true;
  try {
    if (/\/video|\/clip|\/shorts|\/images?\//i.test(new URL(item.url).pathname)) return true;
  } catch {
    return true;
  }
  return false;
}

function isBlockedPageText(text: string) {
  return /проверка браузера|подождите несколько секунд|request id|checking your browser|enable javascript|captcha/i.test(text);
}

function hasUsableFetchedContent(item: WebEvidence) {
  if (!item.contentFetched) return false;
  return !isBlockedPageText(`${item.snippet}\n${item.fullText ?? ""}`);
}

// ── Региональные токены из НАЗВАНИЯ (без справочника) ─────────────────────────
// Для гейта релевантности числовых предложений и для site:-подсказок нужны
// словоформы региона, выведенные из самого названия сессии, а не из карты.

/** Стоп-слова в названии региона, которые не несут смысла для матчинга. */
const REGION_STOPWORDS = /\b(область|обл|край|республика|респ|округ|автономный|город|г|федерального|значения)\b/gi;

/**
 * Возвращает строчные токены-основы региона для матчинга в тексте.
 * «Волгоградская область» → ["волгоград"]; «Республика Татарстан» → ["татарстан"];
 * «Ханты-Мансийский АО» → ["ханты", "мансийск"]. Берём основу (убираем типовые
 * окончания прилагательных), чтобы ловить «волгоградской», «волгоградского» и т.п.
 */
function regionTokens(region?: string): string[] {
  if (!region) return [];
  const cleaned = region
    .toLowerCase()
    .replace(REGION_STOPWORDS, " ")
    .replace(/[^a-zа-яё\s-]/gi, " ");
  const parts = cleaned.split(/[\s-]+/).filter((p) => p.length >= 4);
  const stems = parts.map((p) =>
    // срезаем типовые окончания прилагательных/род.падежа, оставляем основу ≥4 букв
    p.replace(/(ская|ский|ское|ской|скую|ого|его|ая|ий|ое|ой|ую|инская|инский)$/u, "")
  );
  return Array.from(new Set(stems.map((s) => s.slice(0, 12)).filter((s) => s.length >= 4)));
}

function textMentionsRegion(text: string, region?: string) {
  const toks = regionTokens(region);
  if (!toks.length) return true;
  const low = text.toLowerCase();
  return toks.some((token) => low.includes(token));
}

function queryDemandsRegion(query: string) {
  return regionTokens(query).length > 0;
}

/** Канонизация URL для дедупа: убираем www, hash, трекинг-параметры, хвостовой слеш. */
function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|yclid|gclid|fbclid|_openstat|from|ref|spm)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

function buildQueries(region?: string, focusTopic?: string): string[] {
  const topic = focusTopic?.trim() || "цифровизация госсектора";
  const regionStr = region?.trim() || "";
  const year = new Date().getFullYear();
  const prevYear = year - 1;
  const lowerTopic = topic.toLowerCase();
  const rq = regionStr ? `"${regionStr}" ` : "";

  const queries: string[] = [];

  queries.push(`${rq}${topic} ${year}`.trim());
  queries.push(`${rq}${topic} ${prevYear} ${year} итоги результаты`.trim());

  if (regionStr) {
    queries.push(`${rq}бюджет ${year} расходы доходы структура млрд`);
    queries.push(`${rq}закон о бюджете ${prevYear} ${year} доходы расходы дефицит`);
    queries.push(`${rq}бюджет ${year} структура расходов образование здравоохранение`);
    queries.push(`${rq}бюджет для граждан ${year} ${year + 1} ${year + 2}`);
    queries.push(`${rq}открытый бюджет госпрограммы расходы`);

    queries.push(`${rq}стратегия социально-экономического развития до 2030 приоритеты`);
    queries.push(`${rq}закон стратегия социально-экономического развития цели`);
    queries.push(`${rq}губернатор приоритеты национальные проекты ${year}`);
    queries.push(`${rq}инвестиционная стратегия приоритетные отрасли проекты`);

    queries.push(`${rq}ВРП структура экономики доли отраслей процент`);
    queries.push(`${rq}экономика ВРП население ${year}`);
    queries.push(`${rq}промышленность сельское хозяйство статистика ${year}`);
    queries.push(`${rq}социально-экономическое положение статистика ${year}`);
    queries.push(`${rq}паспорт региона Росстат экономика отрасли`);

    queries.push(`site:gov.ru "${regionStr}" ${topic}`);
    queries.push(`"${regionStr}" site:gov.ru бюджет ${year}`);
    queries.push(`"${regionStr}" site:rosstat.gov.ru статистика`);
    queries.push(`"${regionStr}" официальный сайт правительство бюджет ${year} filetype:pdf`);
    queries.push(`"${regionStr}" стратегия социально-экономического развития filetype:pdf`);
  } else {
    queries.push(`site:government.ru ${topic} ${year}`);
    queries.push(`site:digital.gov.ru ${topic}`);
  }

  queries.push(`Сбер ${topic} ${regionStr} ${year}`.trim());
  queries.push(`Сбербанк госсектор ${regionStr}`.trim());

  if (regionStr) {
    queries.push(`${rq}цифровизация региона поставщик платформа контракт`);
    queries.push(`${rq}государственные информационные системы поставщик внедрение`);
    queries.push(`${rq}закупки ИТ услуги информационная система ${year}`);
    queries.push(`${rq}конкурс информационная система цифровая платформа ${year}`);
    queries.push(`${rq}Ростелеком БФТ 1С VK Яндекс 2ГИС региональная платформа`);
    queries.push(`${rq}ГосТех цифровая платформа регион внедрение`);
    queries.push(`${rq}ЦУР Диалог Регионы цифровые сервисы`);
  }

  if (/апк|сельск|земледел|урожай|агро/.test(lowerTopic)) {
    queries.push(`${rq}сельское хозяйство производство зерно ${year}`);
    queries.push(`${rq}АПК цифровизация точное земледелие`);
  }
  if (/жкх|коммунален|водоснабжен/.test(lowerTopic)) {
    queries.push(`${rq}ЖКХ реформа инфраструктура ${year}`);
    queries.push(`${rq}водоснабжение водоотведение капитальный ремонт`);
  }
  if (/туризм|курорт|отдых/.test(lowerTopic)) {
    queries.push(`${rq}туризм туристический поток ${prevYear} ${year}`);
    queries.push("Сбер эквайринг туризм СберБизнес");
  }
  if (/логистик|порт|транспорт/.test(lowerTopic)) {
    queries.push(`${rq}порт логистика грузооборот ${year}`);
    queries.push(`${rq}транспорт инфраструктура дороги ${year}`);
  }
  if (/цифров|ит|технолог/.test(lowerTopic)) {
    queries.push(`${rq}цифровая экономика IT-специалисты ${year}`);
    queries.push(`${rq}технопарк IT-парк кластер`);
  }

  return Array.from(new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))).slice(0, 32);
}

function searxngBases() {
  const configured = (process.env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!configured) return [];
  const bases = [configured];
  try {
    const parsed = new URL(configured);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      bases.push(parsed.toString().replace(/\/$/, ""));
    }
  } catch {
    /* noop */
  }
  return Array.from(new Set(bases));
}

// ── Реальный search-API (SearXNG self-hosted / Tavily / Serper) ──────────────
// Главный рычаг качества: если задан провайдер, поиск идёт через нормальный API,
// а не через скрейпинг. Приоритет — бесплатный self-hosted SearXNG (агрегатор
// Google/Bing/DDG без ключей и лимитов). Без провайдера — скрейпинг-контур ниже.
function hasSearchProvider() {
  return Boolean(
    process.env.SEARXNG_URL ||
      process.env.LANGSEARCH_API_KEY ||
      process.env.TAVILY_API_KEY ||
      process.env.SERPER_API_KEY,
  );
}

// SearXNG: бесплатный self-hosted метапоисковик. JSON API: GET /search?format=json.
// Возвращает агрегированную выдачу нескольких движков → выше шанс найти цифры
// и первоисточники (законы о бюджете, стратегии СЭР, открытый бюджет региона).
let lastSearxngTime = 0;
async function searxngSearch(query: string, limit: number): Promise<WebEvidence[]> {
  const bases = searxngBases();
  if (!bases.length) return [];
  const timeoutMs = Number(process.env.SEARCH_TIMEOUT_MS || 3500);
  const now = Date.now();
  const elapsed = now - lastSearxngTime;
  const minIntervalMs = Number(process.env.SEARXNG_MIN_INTERVAL_MS || 1200);
  if (elapsed < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
  }
  lastSearxngTime = Date.now();
  for (const base of bases) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=ru&safesearch=2`;
      const res = await nativeFetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          publishedDate?: string;
        }>;
      };
      const items = (data.results ?? [])
        .filter((r) => r.url && /^https?:\/\//.test(r.url))
        .map((r) => ({
          title: r.title ?? sourceFromUrl(r.url as string),
          url: r.url as string,
          snippet: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
          source: sourceFromUrl(r.url as string),
          query,
          fetchedAt: r.publishedDate || new Date().toISOString(),
        }))
        .slice(0, limit);
      return items;
    } catch (err) {
      console.warn(`[web-retrieval] SearXNG failed (${base}): ${err instanceof Error ? err.message : err}`);
    }
  }
  return [];
}

async function langSearch(query: string, limit: number): Promise<WebEvidence[]> {
  const apiKey = process.env.LANGSEARCH_API_KEY;
  if (!apiKey) return [];
  const timeoutMs = Number(process.env.LANGSEARCH_TIMEOUT_MS || 12000);
  try {
    const res = await nativeFetch("https://api.langsearch.com/v1/web-search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "gov-strategy-ai/1.0",
      },
      body: JSON.stringify({
        query,
        freshness: "noLimit",
        summary: true,
        count: Math.min(Math.max(limit, 5), 10),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[web-retrieval] LangSearch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      code?: number;
      msg?: string | null;
      data?: {
        webPages?: {
          value?: Array<{
            name?: string;
            url?: string;
            displayUrl?: string;
            snippet?: string;
            summary?: string;
            datePublished?: string | null;
            dateLastCrawled?: string | null;
          }>;
        };
      };
    };
    if (data.code && data.code !== 200) {
      console.warn(`[web-retrieval] LangSearch failed: ${data.msg || data.code}`);
      return [];
    }
    return (data.data?.webPages?.value ?? [])
      .filter((r) => r.url && /^https?:\/\//.test(r.url))
      .map((r) => {
        const url = r.url as string;
        return {
          title: r.name ?? sourceFromUrl(url),
          url,
          snippet: (r.summary || r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 1200),
          source: sourceFromUrl(url),
          query,
          fetchedAt: r.datePublished || r.dateLastCrawled || new Date().toISOString(),
        };
      })
      .slice(0, limit);
  } catch (err) {
    console.warn(`[web-retrieval] LangSearch failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function queryCategory(query?: string) {
  const q = (query ?? "").toLowerCase();
  if (/бюджет|расход|доход|госпрограмм|закуп|тендер/.test(q)) return "budget";
  if (/стратег|приоритет|нацпроект|губернатор|инвестицион/.test(q)) return "strategy";
  if (/врп|экономик|отрасл|промышлен|сельск|статист|паспорт/.test(q)) return "industry";
  if (/конкур|поставщик|платформ|гостех|ростелеком|бфт|яндекс|vk|2гис|1с|цур|диалог/.test(q)) return "competition";
  if (/апк|туризм|порт|логист|жкх|транспорт|цифров|ит|технопарк/.test(q)) return "sector";
  if (/сбер|sber/.test(q)) return "sber";
  return "general";
}

function diversifyCandidates(items: WebEvidence[], max: number) {
  const categories = ["budget", "strategy", "industry", "competition", "sector", "sber", "general"];
  const picked: WebEvidence[] = [];
  const used = new Set<string>();

  for (const category of categories) {
    const match = items.find((item) => queryCategory(item.query) === category && !used.has(item.url));
    if (match) {
      picked.push(match);
      used.add(match.url);
    }
  }

  for (const item of items) {
    if (picked.length >= max) break;
    if (used.has(item.url)) continue;
    picked.push(item);
    used.add(item.url);
  }
  return picked;
}

async function providerSearch(query: string, limit: number): Promise<WebEvidence[]> {
  // SearXNG — дешёвый сборщик ссылок; LangSearch добирает качество и summaries.
  const [searx, lang] = await Promise.all([
    searxngSearch(query, limit),
    langSearch(query, limit),
  ]);
  if (searx.length || lang.length) return [...searx, ...lang].slice(0, Math.max(limit, 6));

  const tavily = process.env.TAVILY_API_KEY;
  if (tavily) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavily,
          query,
          search_depth: "advanced",
          max_results: Math.min(limit, 8),
          days: 540, // приоритет свежим материалам (~1.5 года)
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
        };
        return (data.results ?? [])
          .filter((r) => r.url)
          .map((r) => ({
            title: r.title ?? sourceFromUrl(r.url as string),
            url: r.url as string,
            snippet: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
            source: sourceFromUrl(r.url as string),
            query,
            fetchedAt: r.published_date || new Date().toISOString(),
          }));
      }
    } catch {
      /* падаем на скрейпинг */
    }
  }

  const serper = process.env.SERPER_API_KEY;
  if (serper) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": serper },
        body: JSON.stringify({ q: query, gl: "ru", hl: "ru", num: Math.min(limit, 10) }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
        };
        return (data.organic ?? [])
          .filter((r) => r.link)
          .map((r) => ({
            title: r.title ?? sourceFromUrl(r.link as string),
            url: r.link as string,
            snippet: (r.snippet ?? "").trim(),
            source: sourceFromUrl(r.link as string),
            query,
            fetchedAt: r.date || new Date().toISOString(),
          }));
      }
    } catch {
      /* падаем на скрейпинг */
    }
  }

  return [];
}

// Свежесть: выше очки за упоминание текущего/прошлого года, штраф за явно старое.
function recencyScore(item: WebEvidence): number {
  const year = new Date().getFullYear();
  const text = `${item.title} ${item.snippet} ${item.fetchedAt ?? ""}`;
  if (text.includes(String(year))) return 3;
  if (text.includes(String(year - 1))) return 2;
  if (text.includes(String(year - 2))) return 1;
  if (/\b20(1\d|2[0-2])\b/.test(text)) return -1; // 2010–2022 — устаревшее
  return 0;
}

// ── HTTP fallback (DuckDuckGo) ────────────────────────────────────────────────

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

function unwrapDuckUrl(url: string) {
  try {
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const parsed = new URL(normalized);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : normalized;
  } catch {
    return url;
  }
}

function parseDuckDuckGo(html: string, query: string): WebEvidence[] {
  if (/anomaly-modal|Unfortunately, bots use DuckDuckGo too/i.test(html)) {
    return [];
  }
  const items: WebEvidence[] = [];
  const pattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)(?:<\/a>|<\/div>)/g;
  for (const match of html.matchAll(pattern)) {
    const url = unwrapDuckUrl(decodeHtml(match[1]));
    if (!/^https?:\/\//.test(url)) continue;
    if (items.some((i) => i.url === url)) continue;
    items.push({
      title: decodeHtml(match[2]),
      url,
      snippet: decodeHtml(match[3]),
      source: sourceFromUrl(url),
      query,
      fetchedAt: new Date().toISOString(),
    });
  }
  return items;
}

function parseBingRss(xml: string, query: string): WebEvidence[] {
  const items: WebEvidence[] = [];
  const pattern =
    /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g;
  for (const match of xml.matchAll(pattern)) {
    const title = decodeHtml(match[1]);
    const url = decodeHtml(match[2]);
    const snippet = decodeHtml(match[3]);
    if (!/^https?:\/\//.test(url)) continue;
    if (!isRelevantToQuery(query, `${title} ${snippet}`)) continue;
    if (items.some((item) => item.url === url)) continue;
    items.push({
      title,
      url,
      snippet,
      source: sourceFromUrl(url),
      query,
      fetchedAt: new Date().toISOString(),
    });
  }
  return items;
}

function isRelevantToQuery(query: string, text: string) {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (needle.includes("тульск") && !/тул|tula/.test(haystack)) return false;
  if (needle.includes("туризм") && !/тур|tour|маршрут|посещ|travel/.test(haystack)) return false;
  if (needle.includes("сбер") && !/сбер|sber|эквайр|pay|бизнес/.test(haystack)) return false;
  const stems = queryStems(query);
  if (!stems.length) return true;
  const hits = stems.filter((stem) => haystack.includes(stem)).length;
  const required = stems.length <= 2 ? 1 : 2;
  return hits >= required || (isOfficialByZone(text) && hits >= 1);
}

function queryStems(query: string): string[] {
  return keywordTokens(query)
    .filter((token) => !/^\d{4}$/.test(token))
    .filter((token) => !["site", "filetype", "официальный", "сайт"].includes(token))
    .map((token) => (/[а-яё]/i.test(token) && token.length >= 6 ? token.slice(0, 5) : token))
    .filter((token) => token.length >= 4);
}

async function bingRssFallback(query: string): Promise<WebEvidence[]> {
  try {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&mkt=ru-RU&setlang=ru`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal: AbortSignal.timeout(Number(process.env.SEARCH_FALLBACK_TIMEOUT_MS || 6000)),
    });
    if (!response.ok) return [];
    return parseBingRss(await response.text(), query);
  } catch {
    return [];
  }
}

async function httpFallback(query: string): Promise<WebEvidence[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=ru-ru`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal: AbortSignal.timeout(Number(process.env.SEARCH_FALLBACK_TIMEOUT_MS || 6000)),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const parsed = parseDuckDuckGo(html, query);
    if (parsed.length > 0) return parsed;
    // Если старый парсер ничего не дал — пробуем улучшенный
    return parseDuckDuckGoImproved(html, query);
  } catch {
    return [];
  }
}

// DDG HTML fallback — улучшенный парсер
function parseDuckDuckGoImproved(html: string, query: string): WebEvidence[] {
  const items: WebEvidence[] = [];
  const seen = new Set<string>();
  // DDG может отдавать результаты в разных форматах — пробуем все варианты
  const patterns = [
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)(?:<\/a>|<\/div>)/g,
    /<a[^>]+class="[^"]*result-link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    /<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const [_, rawUrl, rawTitle, rawSnippet] = match;
      const url = rawUrl.replace(/&[^;]+;/g, "").trim();
      const title = rawTitle.replace(/<[^>]+>/g, "").trim();
      if (!url.startsWith("http")) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const snippet = rawSnippet?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "";
      items.push({
        title,
        url,
        snippet: snippet.slice(0, 500),
        source: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "ddg"; } })(),
        query,
        fetchedAt: new Date().toISOString(),
      });
      if (items.length >= 8) break;
    }
    if (items.length > 0) break;
  }
  return items;
}

/**
 * Выбирает информативные предложения из текста источника для сниппета.
 * Гейт по региону: предложение с числом принимается, ТОЛЬКО если оно упоминает
 * регион (по основам из regionTokens). Это не даёт федеральным числам из чужого
 * контекста (напр. «187 трлн ₽» из статьи про федеральный бюджет) всплыть как
 * факт о регионе. Если регион не задан или числовых предложений с упоминанием
 * региона нет — мягкий фолбэк на прежнее поведение, чтобы не остаться без сниппета.
 */
function pickSnippetSentences(text: string, regionToks: string[]): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  const numericRe = /(млрд|млн|трлн|%|руб|₽|тыс|год|бюджет|доход|расход|ВРП)/i;
  const hasNumeric = (s: string) => /\d/.test(s) && numericRe.test(s);
  const mentionsRegion = (s: string) => {
    if (!regionToks.length) return true; // регион не задан — гейт выключен
    const low = s.toLowerCase();
    return regionToks.some((t) => low.includes(t));
  };

  // Tier 1: числовые предложения, упоминающие регион — самые ценные и безопасные.
  const numericRegional = sentences.filter((s) => hasNumeric(s) && mentionsRegion(s));
  // Tier 2: любые предложения про регион (контекст без чужих чисел).
  const regional = sentences.filter((s) => regionToks.length > 0 && mentionsRegion(s));
  // Tier 3 (фолбэк): если про регион ничего не нашли — числовые без привязки,
  // но это значит, что регион в тексте не упомянут, и числам доверять нельзя —
  // поэтому фолбэк уходит на обычные предложения, а не на голые числа.
  const numericAny = sentences.filter(hasNumeric);

  const pool =
    numericRegional.length >= 2
      ? numericRegional
      : regional.length >= 2
        ? regional
        : regionToks.length === 0 && numericAny.length >= 2
          ? numericAny // регион не задавался вовсе — старое поведение допустимо
          : sentences;

  return pool.slice(0, 6).join(" ").slice(0, 900);
}

async function enrichEvidence(item: WebEvidence, regionToks: string[] = []): Promise<WebEvidence> {
  try {
    const content = await fetchSourceContent(item.url);
    if (content) {
      if (isBlockedPageText(content.text)) {
        return { ...item, contentFetched: false };
      }
      const picked = pickSnippetSentences(content.text, regionToks);
      return {
        ...item,
        snippet: picked || item.snippet,
        fullText: content.kind === "pdf" || content.text.length > 1500 ? content.text : undefined,
        fetchedAt: new Date().toISOString(),
        contentFetched: true,
      };
    }
  } catch { }

  try {
    const jinaText = await jinaReader(item.url);
    if (jinaText) {
      if (isBlockedPageText(jinaText)) {
        return { ...item, contentFetched: false };
      }
      const picked = pickSnippetSentences(jinaText, regionToks);
      return {
        ...item,
        snippet: picked || item.snippet,
        fullText: jinaText.length > 1500 ? jinaText : undefined,
        fetchedAt: new Date().toISOString(),
        contentFetched: true,
      };
    }
  } catch { }

  return { ...item, contentFetched: false };
}

// ── Проверка релевантности ────────────────────────────────────────────────────
// Поиск приносит много мусора: новостные дайджесты, рекламу, страницы не по теме.
// Перед тем как отдать источники в генерацию, оцениваем каждый кандидат на
// соответствие теме сессии. Основной путь — LLM-скоринг (понимает смысл, а не
// только слова); fallback — пересечение ключевых слов, если LLM недоступен.

function keywordTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4),
    ),
  );
}

function keywordRelevance(item: WebEvidence, topicTokens: string[]): number {
  if (!topicTokens.length) return 0.5;
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  const hits = topicTokens.filter((token) => haystack.includes(token)).length;
  return hits / topicTokens.length;
}

async function scoreRelevanceByLLM(
  items: WebEvidence[],
  topic: string,
  region: string,
): Promise<Map<string, number>> {
  const list = items
    .map(
      (item, index) =>
        `${index + 1}. URL: ${item.url}\nЗаголовок: ${item.title}\nФрагмент: ${item.snippet.slice(0, 280)}`,
    )
    .join("\n\n");

  const raw = await callLLM({
    temperature: 0,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "Ты оцениваешь, насколько каждый источник релевантен теме стратегической задачи.",
          "Релевантно = помогает ответить на задачу по этому региону/тематике (факты, данные, контекст, стейкхолдеры).",
          "Не релевантно = другая тема, другой регион, реклама, общий новостной шум, нерабочая страница.",
          'Верни ТОЛЬКО JSON: {"scores":[{"i":1,"score":0-100}, ...]}. Без текста вокруг.',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Тема задачи: ${topic || "цифровизация госсектора"}`,
          `Регион: ${region || "не указан"}`,
          "",
          "Источники:",
          list,
        ].join("\n"),
      },
    ],
  });

  const scores = new Map<string, number>();
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as {
      scores?: Array<{ i?: number; score?: number }>;
    };
    for (const entry of parsed.scores ?? []) {
      const idx = (entry.i ?? 0) - 1;
      if (idx >= 0 && idx < items.length && Number.isFinite(entry.score)) {
        scores.set(items[idx].url, Math.max(0, Math.min(100, entry.score as number)) / 100);
      }
    }
  } catch (err) {
    console.warn(`[web-retrieval] relevance LLM parse failed: ${err instanceof Error ? err.message : err}`);
  }
  return scores;
}

/**
 * Фильтрует кандидатов по релевантности теме. Каждому источнику проставляется
 * `relevance` (0–1). Отсеиваются явно нерелевантные (< порога). Если после
 * фильтра почти ничего не осталось — возвращаем исходный набор с оценками
 * (лучше слабые источники, чем пустота), но честно логируем, что отсеяли.
 */
async function filterByRelevance(
  items: WebEvidence[],
  topic: string,
  region: string,
  minKeep: number,
): Promise<WebEvidence[]> {
  if (items.length <= 1) return items.map((item) => ({ ...item, relevance: 1 }));

  const topicTokens = keywordTokens(`${topic} ${region}`);
  let llmScores = new Map<string, number>();
  try {
    llmScores = await scoreRelevanceByLLM(items, topic, region);
  } catch (err) {
    console.warn(`[web-retrieval] relevance scoring skipped: ${err instanceof Error ? err.message : err}`);
  }

  const scored = items.map((item) => {
    const llm = llmScores.get(item.url);
    // LLM-оценка приоритетна; иначе — ключевые слова. Флор даём ТОЛЬКО официальным
    // по зоне источникам (gov.ru, статорганы, бюджетные порталы), чтобы не выбросить
    // первичный документ со скудным сниппетом. СМИ (TASS/РБК/Википедия) флора НЕ
    // получают — они должны зарабатывать релевантность содержанием, а не доменом.
    const base = llm ?? keywordRelevance(item, topicTokens);
    const relevance = isOfficialByZone(item.url) ? Math.max(base, 0.4) : base;
    return { ...item, relevance };
  });

  const THRESHOLD = RELEVANCE_THRESHOLD;
  const relevant = scored.filter((item) => (item.relevance ?? 0) >= THRESHOLD);
  const sorted = scored.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

  const dropped = scored.length - relevant.length;
  if (relevant.length >= minKeep) {
    if (dropped > 0) {
      console.log(`[web-retrieval] relevance filter: kept ${relevant.length}, dropped ${dropped} (< ${THRESHOLD})`);
    }
    return relevant.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  }

  // Релевантных слишком мало — не оставляем генерацию без фактов, но логируем.
  console.log(
    `[web-retrieval] relevance filter: only ${relevant.length} above ${THRESHOLD}; keeping top ${Math.min(minKeep, sorted.length)} by score`,
  );
  return sorted.slice(0, Math.max(minKeep, relevant.length));
}

// ── Основная функция ──────────────────────────────────────────────────────────

export async function retrieveOpenSources({
  region,
  focusTopic,
  queries: explicitQueries,
  limit = 6,
}: {
  region?: string;
  focusTopic?: string;
  queries?: string[];
  limit?: number;
}): Promise<WebEvidence[]> {
  const startedAt = Date.now();
  const explicitMode = Boolean(explicitQueries?.length);
  const queries = explicitMode
    ? Array.from(new Set((explicitQueries || []).map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 8)
    : buildQueries(region, focusTopic);
  const seen = new Set<string>();
  const hostCounts = new Map<string, number>();
  const official: WebEvidence[] = [];
  const other: WebEvidence[] = [];

  console.log(
    `[web-retrieval] start region="${region || ""}" focus="${(focusTopic || "").slice(0, 120)}" mode=${explicitMode ? "explicit" : "broad"} queries=${queries.length} limit=${limit}`,
  );

  function addResult(item: WebEvidence) {
    if (isJunkSearchResult(item)) return;
    const searchText = `${item.title} ${item.snippet} ${item.url}`;
    const query = item.query || "";
    if (region && !textMentionsRegion(searchText, region)) {
      if (isProcurementRecord(item.url)) return;
      if (!isOfficialByZone(item.url) && !isTrustedOpenData(item.url)) return;
    }
    if (query && !isRelevantToQuery(query, searchText) && !isOfficialByZone(item.url) && !isTrustedOpenData(item.url)) {
      return;
    }
    const key = canonicalUrl(item.url);
    if (seen.has(key)) return;
    const host = sourceFromUrl(item.url);
    const hostCount = hostCounts.get(host) ?? 0;
    if (hostCount >= MAX_PER_HOST) return;
    seen.add(key);
    hostCounts.set(host, hostCount + 1);
    if (isOfficialByZone(item.url) || isTrustedOpenData(item.url)) official.push(item);
    else other.push(item);
  }

  // Статья региона в Википедии — надёжная база фактов (губернатор, министры,
  // бюджет, экономика, крупные предприятия) для ЛЮБОГО блока. Раньше в
  // explicit-режиме она подключалась только для «экономических» запросов, из-за
  // чего stakeholders/competition оставались на генерик-страницах новостей и
  // выходили пустыми. Включаем всегда, когда регион известен (живой источник).
  const shouldUseWikipedia = Boolean(region);

  if (shouldUseWikipedia && region) {
    try {
      const wikiResults = await searchWikipedia(region);
      wikiResults.forEach(addResult);
      if (wikiResults.length > 0) {
        console.log(`[web-retrieval] wikipedia returned ${wikiResults.length} results`);
      }
    } catch (err) {
      console.warn(`[web-retrieval] wikipedia failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (hasSearchProvider()) {
    if (explicitMode) {
      const providerStartedAt = Date.now();
      const batches: WebEvidence[][] = [];
      for (const query of queries) {
        const queryStartedAt = Date.now();
        try {
          const results = await providerSearch(query, 6);
          console.log(
            `[web-retrieval] provider query done in ${Date.now() - queryStartedAt}ms results=${results.length}: ${query.slice(0, 90)}`,
          );
          batches.push(results);
        } catch (err) {
          console.warn(`[web-retrieval] provider search failed: ${err instanceof Error ? err.message : err}`);
          batches.push([]);
        }
      }
      batches.flat().forEach(addResult);
      console.log(
        `[web-retrieval] explicit provider batch done in ${Date.now() - providerStartedAt}ms total=${official.length + other.length}`,
      );
    } else {
      for (const query of queries) {
        if (official.length + other.length >= Math.max(limit + 14, 28)) break;
        try {
          const queryStartedAt = Date.now();
          const results = await providerSearch(query, 4);
          results.forEach(addResult);
          console.log(
            `[web-retrieval] provider query done in ${Date.now() - queryStartedAt}ms results=${results.length} total=${official.length + other.length}: ${query.slice(0, 90)}`,
          );
        } catch (err) {
          console.warn(`[web-retrieval] provider search failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    if (official.length + other.length > 0) {
      console.log(`[web-retrieval] search API returned ${official.length + other.length} results`);
    }
  }

  // Прямые fallback-поиски нужны в широком режиме. В explicit-режиме они
  // подключаются только если основной провайдер почти ничего не нашёл.
  const needFallback = !explicitMode || official.length + other.length < Math.min(3, limit);

  // Прямой Bing RSS — находит больше региональных документов, чем SearXNG через Bing
  if (needFallback) {
    for (const query of queries.slice(0, explicitMode ? 2 : 5)) {
      if (official.length + other.length >= limit + 8) break;
      const queryStartedAt = Date.now();
      const results = await bingRssFallback(query.split(" ").slice(0, 6).join(" "));
      results.forEach(addResult);
      console.log(
        `[web-retrieval] bing query done in ${Date.now() - queryStartedAt}ms results=${results.length} total=${official.length + other.length}`,
      );
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (official.length + other.length > 0) {
    console.log(`[web-retrieval] bing RSS added results, total ${official.length + other.length}`);
  }

  // DuckDuckGo HTML — прямой скрейпинг (обходит капчу SearXNG)
  if (needFallback) {
    for (const query of queries.slice(0, explicitMode ? 1 : 3)) {
      if (official.length + other.length >= limit + 8) break;
      const queryStartedAt = Date.now();
      const results = await httpFallback(query);
      results.forEach(addResult);
      console.log(
        `[web-retrieval] duck query done in ${Date.now() - queryStartedAt}ms results=${results.length} total=${official.length + other.length}`,
      );
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (official.length + other.length > 0) {
    console.log(`[web-retrieval] duckduckgo added results, total ${official.length + other.length}`);
  }

  if (region && (!explicitMode || queries.some((query) => /закуп|контракт|поставщик|информационная система|цифровая платформа/i.test(query)))) {
    try {
      const procurementTerms = explicitMode
        ? queries.filter((query) => /закуп|контракт|поставщик|информационная система|цифровая платформа/i.test(query)).slice(0, 4)
        : ["информационная система", "цифровая платформа", "IT услуги", "облачные сервисы"];
      for (const term of procurementTerms) {
        if (official.length + other.length >= limit + 6) break;
        const results = await searchZakupki(term.includes(region) ? term : `${region} ${term}`);
        results.forEach(addResult);
      }
      console.log(`[web-retrieval] zakupki added results, total ${official.length + other.length}`);
    } catch (err) {
      console.warn(`[web-retrieval] zakupki failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!explicitMode || official.length + other.length < Math.min(2, limit)) {
    for (const query of queries.slice(0, explicitMode ? 1 : 3)) {
      if (official.length >= limit) break;
      try {
        const queryStartedAt = Date.now();
        const results = await browserSearch(query, limit);
        results.map((item) => ({ ...item, query, fetchedAt: new Date().toISOString() })).forEach(addResult);
        if (results.length > 0) {
          console.log(`[web-retrieval] browser query done in ${Date.now() - queryStartedAt}ms results=${results.length}: ${query.slice(0, 50)}`);
        }
      } catch (err) {
        console.warn(`[web-retrieval] browser search failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Свежесть и официальность в приоритете: сортируем внутри групп по recencyScore.
  const byRecency = (a: WebEvidence, b: WebEvidence) => recencyScore(b) - recencyScore(a);
  official.sort(byRecency);
  other.sort(byRecency);

  // Проверка релевантности: берём чуть больше кандидатов, отсеиваем не по теме,
  // и только потом сужаем до limit и обогащаем сниппеты.
  const candidates = diversifyCandidates([...official, ...other], limit + 8);
  let relevant: WebEvidence[];
  if (explicitMode) {
    relevant = await filterByRelevance(
      candidates,
      [focusTopic ?? "", ...queries].join(" "),
      region ?? "",
      Math.min(4, candidates.length),
    );
  } else {
    relevant = await filterByRelevance(
      candidates,
      focusTopic ?? "",
      region ?? "",
      Math.min(3, candidates.length),
    );
  }

  const regionToks = regionTokens(region);
  const selected = relevant.slice(0, limit + 4);
  const enrichStartedAt = Date.now();
  const toEnrich = explicitMode
    ? selected
        .filter((item) => isOfficialByZone(item.url) || isTrustedOpenData(item.url) || isMediaOutlet(item.url))
        .slice(0, Math.max(limit, 6))
    : selected;
  const enrichedMap = new Map<string, WebEvidence>();
  await Promise.all(toEnrich.map(async (item) => {
    const enrichedItem = await enrichEvidence(item, regionToks);
    enrichedMap.set(canonicalUrl(item.url), enrichedItem);
  }));
  const enriched = selected
    .map((item) => enrichedMap.get(canonicalUrl(item.url)) ?? item)
    .filter((item) => !isBlockedPageText(`${item.title}\n${item.snippet}\n${item.fullText ?? ""}`))
    .filter((item) => {
      if (!region) return true;
      if (isTrustedOpenData(item.url) && !isProcurementRecord(item.url)) return true;
      return textMentionsRegion(`${item.title}\n${item.snippet}\n${item.fullText ?? ""}`, region);
    });
  console.log(`[web-retrieval] enriched ${toEnrich.length}/${selected.length} sources in ${Date.now() - enrichStartedAt}ms`);
  const verified = enriched.filter(
    (item) => hasUsableFetchedContent(item) || isTrusted(item.url) || isTrustedOpenData(item.url),
  );
  const final = explicitMode ? enriched : (verified.length >= Math.min(3, limit) ? verified : enriched);
  const result = final.slice(0, limit);
  console.log(
    `[web-retrieval] done in ${Date.now() - startedAt}ms candidates=${candidates.length} selected=${selected.length} returned=${result.length}`,
  );
  return result;
}

export function formatEvidenceForPrompt(evidence: WebEvidence[], maxFullTextChars = 4000) {
  if (!evidence.length) {
    return [
      "Открытые источники недоступны за время поиска.",
      "ВАЖНО: Не выдумывай статистику, проценты и факты.",
      "Не заполняй числовые поля без источника; перенеси вопрос в dataGaps.",
      "Формулируй гипотезы явно: 'предположительно', 'по оценкам', 'требует проверки'.",
    ].join("\n");
  }
  const checkedAt = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  });
  const year = new Date().getFullYear();
  return [
    `Источники проверены автоматически: ${checkedAt} МСК.`,
    "Правило: используй только факты из фрагментов ниже; если фрагмент не подтверждает утверждение — пометь как гипотезу.",
    `Актуальность: приоритет данным за ${year - 1}–${year}. Если факт старше — укажи его год и пометь как возможно устаревший; не выдавай старые цифры за текущие.`,
    "",
    ...evidence.map((item, i) => {
      const date = item.fetchedAt && /\d{4}-\d{2}-\d{2}/.test(item.fetchedAt) ? `\nДата материала: ${item.fetchedAt.slice(0, 10)}` : "";
      const rel = typeof item.relevance === "number" ? `\nРелевантность теме: ${Math.round(item.relevance * 100)}%` : "";
      // Полный текст первоисточника (PDF/документ) даём только для самых релевантных
      // источников — там точные цифры (структура бюджета, доли отраслей).
      const deep =
        item.fullText && i < 4
          ? `\nПолный текст первоисточника (используй цифры отсюда):\n${item.fullText.slice(0, maxFullTextChars)}`
          : "";
      const contentStatus =
        item.contentFetched === false
          ? "\nСтатус контента: открыт только поисковый сниппет; не используй как источник точных цифр."
          : "";
      return `${i + 1}. ${item.title}\nИсточник: ${item.source}\nURL: ${item.url}${date}${rel}${contentStatus}\nПоисковый запрос: ${item.query || "не указан"}\nФрагмент: ${item.snippet}${deep}`;
    }),
  ].join("\n\n");
}
