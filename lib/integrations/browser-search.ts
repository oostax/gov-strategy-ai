/**
 * Headless browser search — аналог go-rod/stealth из статьи на Habr.
 * Используем puppeteer + CDP stealth patches.
 * DuckDuckGo как поисковик — не блокирует headless, хорошо ищет на русском.
 * Парсим результаты CSS-селекторами.
 */

import type { WebEvidence } from "./web-retrieval";

let browserInstance: import("puppeteer").Browser | null = null;

async function getBrowser(): Promise<import("puppeteer").Browser> {
  if (browserInstance) {
    try {
      await browserInstance.version();
      return browserInstance;
    } catch {
      browserInstance = null;
    }
  }

  const puppeteer = (await import("puppeteer")).default;

  browserInstance = await puppeteer.launch({
    headless: "new" as unknown as boolean,
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--lang=ru-RU",
    ],
  });

  process.on("exit", () => { browserInstance?.close().catch(() => {}); });

  return browserInstance;
}

/**
 * Stealth-патчи через CDP — скрываем автоматизацию.
 */
async function applyStealthPatches(page: import("puppeteer").Page) {
  const client = await page.createCDPSession();
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en'] });
      window.chrome = { runtime: {} };
    `,
  });
}

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
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await applyStealthPatches(page);
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
    await page.setViewport({ width: 1280, height: 800 });

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
  } finally {
    await page.close();
  }
}

export async function browserSearch(query: string, limit = 6): Promise<WebEvidence[]> {
  return searchDDG(query, limit);
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
