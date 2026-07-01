/**
 * Универсальный загрузчик контента источника.
 *
 * Задача: получить ПОЛНЫЙ текст любого публичного источника (HTML-страница, PDF,
 * включая бюджеты и стратегии регионов), а не только сниппет из поисковой выдачи.
 * Это даёт точные цифры (структура бюджета, доли ВРП) прямо из первоисточника.
 *
 * Контур (по убыванию надёжности):
 *   1. PDF → скачать (browser-grade fetch, при блокировке — через headless Chrome
 *      со stealth) и распарсить через unpdf (чистый JS, без нативных бинарей).
 *   2. HTML → обычный fetch; если сайт блокирует (403/0/таймаут) — headless Chrome
 *      со stealth рендерит страницу и отдаёт текст.
 *
 * Никаких временных заглушек: при недоступности источника возвращаем null и
 * честно логируем — наверх это уходит как «контент недоступен», а не выдумка.
 */

import https from "https";
import { BROWSER_UA, withPage, closeSharedBrowser } from "./headless-browser";

const PDF_MAX_BYTES = 25 * 1024 * 1024;
const TEXT_LIMIT = 12_000;
const DIRECT_FETCH_TIMEOUT_MS = Number(process.env.CONTENT_FETCH_TIMEOUT_MS || 10_000);
const BROWSER_FETCH_TIMEOUT_MS = Number(process.env.CONTENT_BROWSER_TIMEOUT_MS || 8_000);

// Госсайты с проблемными SSL-сертификатами — скачиваем без проверки
const SSL_BYPASS_DOMAINS = [
  "rosstat.gov.ru",
  "34.rosstat.gov.ru",
  "volgastat.gks.ru",
  "kubregionstat.ru",
  "volgafin.volgograd.ru",
  "kit.volgograd.ru",
  "economics.volgograd.ru",
  "ktzn.volgograd.ru",
  "investvolga.volgograd.ru",
  "gavo.volgograd.ru",
  "obraz.volgograd.ru",
];

function needsSslBypass(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SSL_BYPASS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function sslBypassAgent() {
  return new https.Agent({ rejectUnauthorized: false, keepAlive: true });
}

export interface FetchedContent {
  url: string;
  kind: "pdf" | "html";
  text: string;
  truncated: boolean;
}

function isPdfUrl(url: string) {
  return /\.pdf(\?|#|$)/i.test(url);
}

function looksLikePdf(buf: Uint8Array) {
  // %PDF
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

function cleanText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return cleanText(body);
}

function decodeBuffer(buf: Uint8Array, contentType: string): string {
  const explicit = contentType.match(/charset=([^;]+)/i)?.[1]?.trim();
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 2048));
  const meta = head.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/i)?.[1]?.trim();
  const charset = (explicit || meta || "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

async function parsePdfBuffer(buf: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return cleanText(Array.isArray(text) ? text.join("\n") : text);
}

// ── Browser (stealth) — обход блокировок 403/0 ───────────────────────────────
// Используем ОБЩИЙ headless-браузер проекта (см. headless-browser.ts), а не
// отдельный инстанс Chrome.

/** Скачивает бинарь (PDF) через headless-браузер — обходит anti-bot защиту. */
async function browserDownload(url: string): Promise<Uint8Array | null> {
  try {
    return await withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_FETCH_TIMEOUT_MS });
      if (!response) return null;
      const buf = await response.buffer();
      return new Uint8Array(buf);
    });
  } catch (err) {
    console.warn(`[content-fetcher] browser download failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Рендерит HTML-страницу через headless-браузер и отдаёт видимый текст. */
async function browserRenderText(url: string): Promise<string | null> {
  try {
    return await withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_FETCH_TIMEOUT_MS });
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      return cleanText(text);
    });
  } catch (err) {
    console.warn(`[content-fetcher] browser render failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Прямой fetch ─────────────────────────────────────────────────────────────

async function directFetch(url: string): Promise<{ buf: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "ru-RU,ru;q=0.9" },
      signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const ab = await res.arrayBuffer();
    if (ab.byteLength > PDF_MAX_BYTES) return null;
    return { buf: new Uint8Array(ab), contentType };
  } catch {
    return null;
  }
}

/** Fallback для госсайтов с битыми SSL — используем Node.js https с rejectUnauthorized: false */
async function sslBypassFetch(url: string): Promise<{ buf: Uint8Array; contentType: string } | null> {
  return new Promise((resolve) => {
    try {
      https.get(url, { rejectUnauthorized: false, headers: { "User-Agent": BROWSER_UA } }, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > PDF_MAX_BYTES) { res.destroy(); resolve(null); return; }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const ct = res.headers["content-type"] ?? "";
          resolve({ buf: new Uint8Array(Buffer.concat(chunks)), contentType: ct });
        });
        res.on("error", () => resolve(null));
      }).on("error", () => resolve(null));
    } catch { resolve(null); }
  });
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const { jinaReader } = await import("./open-data-retrieval");
    return await jinaReader(url);
  } catch {
    return null;
  }
}

/**
 * Главная функция: вернуть полный текст источника или null.
 * Универсальна для всего проекта — region-autofill, structured-generator,
 * evidence-pack могут вызывать её для углубления в первоисточник.
 */
export async function fetchSourceContent(url: string): Promise<FetchedContent | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const wantsPdf = isPdfUrl(url);

  let direct = await directFetch(url);

  // SSL bypass для госсайтов с битыми сертификатами
  if (!direct && needsSslBypass(url)) {
    direct = await sslBypassFetch(url);
  }

  if (direct) {
    const isPdf = wantsPdf || direct.contentType.includes("pdf") || looksLikePdf(direct.buf);
    if (isPdf) {
      try {
        const text = await parsePdfBuffer(direct.buf);
        if (text.length > 80) return finalize(url, "pdf", text);
      } catch (err) {
        console.warn(`[content-fetcher] pdf parse failed (direct) ${url}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      const html = decodeBuffer(direct.buf, direct.contentType);
      const text = stripHtml(html);
      if (text.length > 120) return finalize(url, "html", text);
    }
  }

  // Jina Reader fallback — читает контент даже через блокировки
  if (!direct) {
    const jinaText = await fetchViaJina(url);
    if (jinaText && jinaText.length > 80) {
      return finalize(url, wantsPdf ? "pdf" : "html", jinaText);
    }
  }

  // Headless browser со stealth — обход блокировок
  if (wantsPdf) {
    const buf = await browserDownload(url);
    if (buf && (looksLikePdf(buf) || wantsPdf)) {
      try {
        const text = await parsePdfBuffer(buf);
        if (text.length > 80) return finalize(url, "pdf", text);
      } catch (err) {
        console.warn(`[content-fetcher] pdf parse failed (browser) ${url}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return null;
  }

  const rendered = await browserRenderText(url);
  if (rendered && rendered.length > 120) return finalize(url, "html", rendered);

  return null;
}

function finalize(url: string, kind: "pdf" | "html", text: string): FetchedContent {
  const truncated = text.length > TEXT_LIMIT;
  return { url, kind, text: truncated ? text.slice(0, TEXT_LIMIT) : text, truncated };
}

/** @deprecated Используйте closeSharedBrowser из headless-browser.ts. */
export async function closeContentBrowser() {
  await closeSharedBrowser();
}
