/**
 * Headless browser search — поиск в DuckDuckGo через общий stealth-браузер.
 * DuckDuckGo не блокирует headless и хорошо ищет на русском.
 * Парсим результаты CSS-селекторами.
 *
 * Инстанс браузера общий для всего проекта (см. headless-browser.ts), чтобы
 * не плодить несколько процессов Chrome.
 */

import type { WebEvidence } from "./web-retrieval";
import { withPage, closeSharedBrowser } from "./headless-browser";

function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "open web";
  }
}

/**
 * Поиск через DuckDuckGo с headless браузером.
 * DDG не блокирует headless и хорошо ищет на русском.
 */
async function searchDDG(query: string, limit = 8): Promise<WebEvidence[]> {
  return withPage(async (page) => {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=ru-ru&ia=web`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    // Ждём появления результатов
    await page.waitForSelector('[data-testid="result"]', { timeout: 8000 }).catch(() => null);

    // Парсим CSS-селекторами
    const raw = await page.evaluate((maxItems: number) => {
      const items: Array<{ title: string; url: string; snippet: string }> = [];

      document.querySelectorAll('[data-testid="result"]').forEach((el, i) => {
        if (i >= maxItems) return;

        const titleEl = el.querySelector('[data-testid="result-title-a"]') as HTMLAnchorElement | null;
        const snippetEl = el.querySelector('[data-result="snippet"]');

        const title = titleEl?.textContent?.trim() ?? "";
        const href = titleEl?.href ?? "";
        const snippet = snippetEl?.textContent?.trim() ?? "";

        if (title && href && href.startsWith("http") && !href.includes("duckduckgo")) {
          items.push({ title, url: href, snippet });
        }
      });

      return items;
    }, limit);

    return raw.map((r) => ({
      ...r,
      source: sourceFromUrl(r.url),
    }));
  });
}

export async function browserSearch(query: string, limit = 6): Promise<WebEvidence[]> {
  return searchDDG(query, limit);
}

/** @deprecated Используйте closeSharedBrowser из headless-browser.ts. */
export async function closeBrowser() {
  await closeSharedBrowser();
}
