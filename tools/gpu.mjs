import { chromium } from "playwright";
export async function launch(url = process.env.G_URL ?? "http://localhost:5451/", w = 1600, h = 900) {
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--mute-audio"] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(0, 4).join(" | ")));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__g && window.__g.battle, null, { timeout: 60000 });
  return { browser, page, errors };
}
