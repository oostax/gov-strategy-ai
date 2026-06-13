import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 900})

        await page.goto("http://localhost:3000", wait_until="networkidle")
        btn = page.get_by_text("Создать стратегическую сессию").first
        await btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path="screenshots/ss-step1-new.png", full_page=True)
        print("step1 done")

        await page.get_by_text("Дальше").click()
        await page.wait_for_timeout(600)
        await page.screenshot(path="screenshots/ss-step2-new.png", full_page=True)
        print("step2 done")

        await page.get_by_text("Дальше").click()
        await page.wait_for_timeout(600)
        await page.screenshot(path="screenshots/ss-step3-new.png", full_page=True)
        print("step3 done")

        await browser.close()

asyncio.run(main())
