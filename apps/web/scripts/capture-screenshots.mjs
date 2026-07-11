import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outputDir = join(appDir, "artifacts", "screenshots");
const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const routes = [
  { path: "/", name: "landing" },
  { path: "/dashboard", name: "dashboard" },
  { path: "/dashboard#connector", name: "dashboard-connector" }
];
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 740 }
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const route of routes) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await page.goto(new URL(route.path, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > viewport.width + 1) {
        throw new Error(
          `${route.name} ${viewport.width}x${viewport.height} has horizontal overflow: ${scrollWidth}`
        );
      }
      const file = join(outputDir, `${route.name}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      console.log(`Captured ${file}`);
    }
  }
} finally {
  await browser.close();
}
