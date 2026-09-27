// Close-ups of a real melee and a cavalry charge.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const { browser, page, errors } = await launch();
await page.evaluate(() => { window.__g.brief(1); window.__g.go(); window.__g.autoplay(); window.__g.setSpeed(3); });
let n = 0;
for (let k = 0; k < 40 && n < 4; k++) {
  await page.waitForTimeout(4000);
  const ok = await page.evaluate((k) => {
    const b = window.__g.battle;
    const cands = [];
    for (let i = 0; i < b.n; i++) if (b.alive[i] && b.target[i] >= 0) cands.push(i);
    if (cands.length < 30) return false;
    const i = cands[Math.floor(cands.length / 2)];
    Object.assign(window.__g.cam, { x: b.x[i], z: b.z[i], dist: 14 + (k % 3) * 10, pitch: 0.16 + (k % 2) * 0.12, yaw: k * 1.3 });
    return true;
  }, k);
  if (!ok) continue;
  await page.evaluate(() => window.__g.setSpeed(0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${O}/m${n++}.png` });
  await page.evaluate(() => window.__g.setSpeed(3));
}
console.log(n, errors.slice(0, 3));
await browser.close();
