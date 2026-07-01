const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const url = process.argv[2];
const output = process.argv[3] || "screenshot.png";

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector("[data-testid='structured-dashboard']", { timeout: 20000 }).catch(() => {});

  await page.evaluate(async () => {
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons.forEach((b) => {
      const text = b.textContent || "";
      if (
        text.includes("Развернуть") ||
        text.includes("Подробнее") ||
        text.includes("Показать") ||
        b.getAttribute("aria-expanded") === "false"
      ) {
        b.click();
      }
    });
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });

  await new Promise((r) => setTimeout(r, 800));

  await page.screenshot({ path: output, fullPage: true });
  console.log(`Screenshot saved to ${output}`);
  await browser.close();
})();
