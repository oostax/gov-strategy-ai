/**
 * Единый менеджер headless-браузера для всего проекта.
 *
 * Раньше было ДВА независимых инстанса Chrome со stealth:
 *   - browser-search.ts (поиск в DuckDuckGo),
 *   - content-fetcher.ts (скачивание PDF/HTML первоисточников).
 * Каждый держал свой Chrome, дублировал конфиг запуска (UA, args, executablePath)
 * и имел собственный lifecycle (closeBrowser / closeContentBrowser), которые
 * нигде не вызывались согласованно. Это двойной расход памяти и копипаст.
 *
 * Здесь — один общий ленивый инстанс Chrome, единая конфигурация и один
 * lifecycle. Оба потребителя берут страницы отсюда.
 */

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--lang=ru-RU",
];

function executablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return undefined;
}

let browserPromise: Promise<import("puppeteer").Browser> | null = null;
let exitHookRegistered = false;

/**
 * Возвращает общий headless-браузер, создавая его лениво при первом вызове.
 * Если предыдущий инстанс умер — пересоздаёт.
 */
export async function getSharedBrowser(): Promise<import("puppeteer").Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      await existing.version(); // проверка, что процесс жив
      return existing;
    } catch {
      browserPromise = null; // умер — пересоздадим ниже
    }
  }

  browserPromise = (async () => {
    const puppeteer = (await import("puppeteer")).default;

    const launched = await puppeteer.launch({
      headless: true,
      executablePath: executablePath(),
      args: LAUNCH_ARGS,
    });

    if (!exitHookRegistered) {
      exitHookRegistered = true;
      process.once("exit", () => {
        launched.close().catch(() => {});
      });
    }

    return launched;
  })().catch((err) => {
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

/**
 * Открывает новую страницу с общими настройками (UA, язык, viewport)
 * и гарантированно закрывает её после работы `fn`, даже при ошибке.
 */
export async function withPage<T>(
  fn: (page: import("puppeteer").Page) => Promise<T>,
): Promise<T> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(BROWSER_UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
    await page.setViewport({ width: 1280, height: 800 });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Закрывает общий браузер. Вызывать при graceful shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* noop */
  } finally {
    browserPromise = null;
  }
}
