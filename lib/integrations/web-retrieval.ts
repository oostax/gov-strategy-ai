/**
 * Поиск открытых источников для агента.
 *
 * Стратегия (по статье с Habr):
 * 1. Headless браузер + stealth (puppeteer-extra) — основной метод, обходит детекцию
 * 2. HTTP-запрос к DuckDuckGo — быстрый fallback если браузер недоступен
 */

import { browserSearch } from "./browser-search";
import { callLLM } from "@/lib/agents/llm-client";

export interface WebEvidence {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query?: string;
  fetchedAt?: string;
  /** Оценка релевантности теме 0–1 (проставляется проверкой релевантности). */
  relevance?: number;
}

const trustedDomains = [
  // Federal
  "gov.ru",
  "gosuslugi.ru",
  "gogov.ru",
  "digital.gov.ru",
  "economy.gov.ru",
  "minfin.gov.ru",
  "rosstat.gov.ru",
  "cbr.ru",
  "zakupki.gov.ru",
  "ac.gov.ru",
  "kremlin.ru",
  "government.ru",
  "duma.gov.ru",
  "consultant.ru",
  "publication.pravo.gov.ru",
  "minpromtorg.gov.ru",
  "minzdrav.gov.ru",
  "edu.gov.ru",
  "ach.gov.ru",
  // Sber
  "sber.ru",
  "sberbank.com",
  // Media
  "tass.ru",
  "rbc.ru",
  "vedomosti.ru",
  "kommersant.ru",
  "interfax-russia.ru",
  "rg.ru",
  "ria.ru",
  "iz.ru",
  "fontanka.ru",
  // Regional stats (rosstat territorial offices)
  "rosstat.gov.ru",
  // Tatarstan
  "tatarstan.ru",
  "digital.tatarstan.ru",
  "minfin.tatarstan.ru",
  "tatstat.gks.ru",
  // Tula
  "tularegion.ru",
  "visittula.com",
  "tsn24.ru",
  "myslo.ru",
  // Krasnodar
  "admkrai.krasnodar.ru",
  "kubregionstat.ru",
  "budget.krasnodar.ru",
  "minfin.krasnodar.ru",
  "mxd.krsk.ru",
  // Moscow
  "mos.ru",
  "data.mos.ru",
  // SPb
  "gov.spb.ru",
  "visit-petersburg.ru",
  // Nizhny Novgorod
  "government-nnov.ru",
  "nobl.ru",
  //通用 regional government domains
  "gov.by",
  "government.org.ru",
];

const regionSearchDomains: Record<string, string[]> = {
  "тульская область": ["tularegion.ru", "visittula.com", "71.rosstat.gov.ru"],
  "республика татарстан": ["tatarstan.ru", "digital.tatarstan.ru", "tatstat.gks.ru"],
  "москва": ["mos.ru", "data.mos.ru"],
  "санкт-петербург": ["gov.spb.ru", "visit-petersburg.ru"],
  "нижегородская область": ["government-nnov.ru", "nobl.ru"],
  "краснодарский край": [
    "admkrai.krasnodar.ru",
    "kubregionstat.ru",
    "budget.krasnodar.ru",
    "minfin.krasnodar.ru",
    "mxd.krsk.ru",
    "kuban.ru",
  ],
  "свердловская область": [" gobierno66.ru", "mid66.ru", "66.gov.ru"],
  "новосибирская область": ["novosibirsk-region.ru", "dns.gov.ru"],
  "самарская область": ["samregion.ru", "mid-nvolga.gov.ru"],
  "ростовская область": ["donland.ru", "rostov.gov.ru"],
  "волгоградская область": ["adminvolga.ru", "vlregion.ru"],
  "республика крым": ["crimea.gov.ru", "fst-crimea.ru"],
  "хабаровский край": ["khvadm.ru", "khabkrai.ru"],
  "приморский край": ["primorsky.ru", "primorsky.ru"],
};

function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "open web";
  }
}

function isTrusted(url: string) {
  const source = sourceFromUrl(url);
  return trustedDomains.some((d) => source === d || source.endsWith(`.${d}`));
}

function buildQueries(region?: string, focusTopic?: string): string[] {
  const topic = focusTopic?.trim() || "цифровизация госсектора";
  const regionStr = region?.trim() || "";
  const year = new Date().getFullYear();
  const prevYear = year - 1;
  const normalizedRegion = regionStr.toLowerCase();
  const lowerTopic = topic.toLowerCase();
  const rq = regionStr ? `"${regionStr}" ` : "";

  const queries: string[] = [];

  // 1. Основной запрос по теме + регион + свежесть
  queries.push(`${rq}${topic} ${year}`.trim());
  queries.push(`${rq}${topic} ${prevYear} ${year} итоги результаты`.trim());

  // 2. Бюджет региона — критически важно для госсектора.
  // Региональные .ru-сайты часто блокируют прямой доступ, поэтому целимся
  // и в доступные зеркала первоисточников (pravo.gov.ru, consultant, garant, СМИ).
  if (regionStr) {
    queries.push(`${rq}бюджет ${year} расходы доходы структура млрд`);
    queries.push(`${rq}закон о бюджете ${prevYear} ${year} доходы расходы дефицит`);
    queries.push(`${rq}бюджет ${year} структура расходов образование здравоохранение`);
  }

  // 3. Стратегия / приоритеты региона — целимся в текст стратегии (закон/документ).
  if (regionStr) {
    queries.push(`${rq}стратегия социально-экономического развития до 2030 приоритеты`);
    queries.push(`${rq}закон стратегия социально-экономического развития цели`);
    queries.push(`${rq}губернатор приоритеты национальные проекты ${year}`);
  }

  // 4. Статистика / ВРП / отраслевая структура.
  // Wikipedia (ru) — доступный машиночитаемый источник долей ВРП и отраслей.
  if (regionStr) {
    queries.push(`${rq}ВРП структура экономики доли отраслей процент`);
    queries.push(`${rq}википедия экономика ВРП население ${year}`);
    queries.push(`${rq}промышленность сельское хозяйство статистика ${year}`);
  }

  // 5. Официальные источники
  if (regionStr) {
    queries.push(`site:gov.ru "${regionStr}" ${topic}`);
  } else {
    queries.push(`site:government.ru ${topic} ${year}`);
    queries.push(`site:digital.gov.ru ${topic}`);
  }
  for (const domain of regionSearchDomains[normalizedRegion] ?? []) {
    queries.push(`site:${domain} ${topic} ${year}`);
  }

  // 6. Сбер + регион + госсектор
  queries.push(`Сбер ${topic} ${regionStr} ${year}`.trim());
  queries.push(`Сбербанк госсектор ${regionStr}`.trim());

  // 7. Новости
  queries.push(`${rq}${topic} новости ${year}`.trim());

  // 8. Тематические усиления
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

  return Array.from(new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))).slice(0, 12);
}

function isUsefulSnippet(snippet: string) {
  return snippet.trim().length >= 120 && !/javascript|cookie|captcha/i.test(snippet);
}

// ── Реальный search-API (SearXNG self-hosted / Tavily / Serper) ──────────────
// Главный рычаг качества: если задан провайдер, поиск идёт через нормальный API,
// а не через скрейпинг. Приоритет — бесплатный self-hosted SearXNG (агрегатор
// Google/Bing/DDG без ключей и лимитов). Без провайдера — скрейпинг-контур ниже.
function hasSearchProvider() {
  return Boolean(
    process.env.SEARXNG_URL || process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY,
  );
}

// SearXNG: бесплатный self-hosted метапоисковик. JSON API: GET /search?format=json.
// Возвращает агрегированную выдачу нескольких движков → выше шанс найти цифры
// и первоисточники (законы о бюджете, стратегии СЭР, открытый бюджет региона).
async function searxngSearch(query: string, limit: number): Promise<WebEvidence[]> {
  const base = (process.env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!base) return [];
  try {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=ru&safesearch=0`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "gov-strategy-ai/1.0" },
      signal: AbortSignal.timeout(15000),
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
    return (data.results ?? [])
      .filter((r) => r.url && /^https?:\/\//.test(r.url))
      .slice(0, Math.max(limit, 10))
      .map((r) => ({
        title: r.title ?? sourceFromUrl(r.url as string),
        url: r.url as string,
        snippet: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
        source: sourceFromUrl(r.url as string),
        query,
        fetchedAt: r.publishedDate || new Date().toISOString(),
      }));
  } catch (err) {
    console.warn(`[web-retrieval] SearXNG failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function providerSearch(query: string, limit: number): Promise<WebEvidence[]> {
  // SearXNG — приоритетный бесплатный провайдер.
  const searx = await searxngSearch(query, limit);
  if (searx.length) return searx;

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
  return true;
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
      signal: AbortSignal.timeout(10000),
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
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    return parseDuckDuckGo(await response.text(), query);
  } catch {
    return [];
  }
}

async function enrichEvidence(item: WebEvidence): Promise<WebEvidence> {
  if (isUsefulSnippet(item.snippet)) return item;
  try {
    const response = await fetch(item.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return item;
    const html = await response.text();
    const cleaned = decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
    );
    const compact = cleaned
      .split(/(?<=[.!?])\s+/)
      .filter((part) => part.length > 40)
      .slice(0, 5)
      .join(" ")
      .slice(0, 700);
    return {
      ...item,
      snippet: compact || item.snippet,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return item;
  }
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
    // LLM-оценка приоритетна; иначе — ключевые слова. Доверенному домену даём
    // небольшую страховку, чтобы не выбросить официальный источник со скудным сниппетом.
    const base = llm ?? keywordRelevance(item, topicTokens);
    const relevance = isTrusted(item.url) ? Math.max(base, 0.35) : base;
    return { ...item, relevance };
  });

  const THRESHOLD = 0.4;
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
  limit = 6,
}: {
  region?: string;
  focusTopic?: string;
  limit?: number;
}): Promise<WebEvidence[]> {
  const queries = buildQueries(region, focusTopic);
  const seen = new Set<string>();
  const official: WebEvidence[] = [];
  const other: WebEvidence[] = [];

  function addResult(item: WebEvidence) {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    if (isTrusted(item.url)) official.push(item);
    else other.push(item);
  }

  // 0. Если задан реальный search-API — он основной источник (качество + свежесть).
  if (hasSearchProvider()) {
    for (const query of queries) {
      if (official.length + other.length >= limit + 4) break;
      try {
        const results = await providerSearch(query, limit);
        results.forEach(addResult);
      } catch (err) {
        console.warn(`[web-retrieval] provider search failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (official.length + other.length > 0) {
      console.log(`[web-retrieval] search API returned ${official.length + other.length} results`);
    }
  }

  // Пробуем headless браузер для основных запросов, HTTP fallback добирает факты.
  for (const query of queries.slice(0, 3)) {
    if (official.length >= limit) break;
    try {
      const results = await browserSearch(query, limit);
      results.map((item) => ({ ...item, query, fetchedAt: new Date().toISOString() })).forEach(addResult);
      if (results.length > 0) {
        console.log(`[web-retrieval] browser search found ${results.length} results for: ${query.slice(0, 50)}`);
      }
    } catch (err) {
      console.warn(`[web-retrieval] browser search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Если браузер не дал достаточно — добираем через HTTP
  if (official.length + other.length < limit) {
    console.log(`[web-retrieval] falling back to Bing RSS search (have ${official.length + other.length} results)`);
    for (const query of queries) {
      if (official.length + other.length >= limit) break;
      const results = await bingRssFallback(query);
      results.forEach(addResult);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // DuckDuckGo HTML часто даёт капчу, но оставляем как дополнительный канал.
  if (official.length + other.length < limit) {
    console.log(`[web-retrieval] falling back to DuckDuckGo HTML (have ${official.length + other.length} results)`);
    for (const query of queries) {
      if (official.length + other.length >= limit) break;
      const results = await httpFallback(query);
      results.forEach(addResult);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Свежесть и официальность в приоритете: сортируем внутри групп по recencyScore.
  const byRecency = (a: WebEvidence, b: WebEvidence) => recencyScore(b) - recencyScore(a);
  official.sort(byRecency);
  other.sort(byRecency);

  // Проверка релевантности: берём чуть больше кандидатов, отсеиваем не по теме,
  // и только потом сужаем до limit и обогащаем сниппеты.
  const candidates = [...official, ...other].slice(0, limit + 6);
  const relevant = await filterByRelevance(
    candidates,
    focusTopic ?? "",
    region ?? "",
    Math.min(3, candidates.length),
  );

  const selected = relevant.slice(0, limit);
  const enriched = await Promise.all(selected.map(enrichEvidence));
  return enriched;
}

export function formatEvidenceForPrompt(evidence: WebEvidence[]) {
  if (!evidence.length) {
    return [
      "Открытые источники недоступны за время поиска.",
      "ВАЖНО: Не выдумывай статистику, проценты и факты.",
      "Все числовые утверждения помечай как 'нужно снять базовую линию'.",
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
      return `${i + 1}. ${item.title}\nИсточник: ${item.source}\nURL: ${item.url}${date}${rel}\nПоисковый запрос: ${item.query || "не указан"}\nФрагмент: ${item.snippet}`;
    }),
  ].join("\n\n");
}
