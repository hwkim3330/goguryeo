// Title, briefing, and moments of the Salsu battle (fast-forwarded), as screenshots.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const { browser, page, errors } = await launch();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${O}/0-title.png` });
await page.evaluate(() => window.__g.brief(0));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${O}/1-brief.png` });
await page.evaluate(() => window.__g.go());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${O}/2-start.png` });
// Order everyone to attack the nearest Sui unit, fast forward.
await page.evaluate(() => { const b = window.__g.battle; for (const u of b.units) if (u.side === 0) { let best = null, bd = 1e9; const [x, z] = b.pos(u); for (const e of b.units) if (e.side === 1) { const [ex, ez] = b.pos(e); const d = Math.hypot(ex - x, ez - z); if (d < bd) { bd = d; best = e; } } b.order(u, { k: "attack", unit: best.id, run: true }); } window.__g.setSpeed(3); });
const fps = [];
for (let s = 0; s < 6; s++) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const b = window.__g.battle; let alive = 0; for (let i = 0; i < b.n; i++) alive += b.alive[i]; return { t: Math.round(b.time), alive, n: b.n, deaths: b.ev.deaths, routs: b.ev.routs.length, res: b.result, clash: b.ev.clash }; });
  const f = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const g = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(g); else r(n); }; requestAnimationFrame(g); }));
  fps.push(f);
  console.log(JSON.stringify(st), "fps", f);
  if (s === 2) {
    // Fly the camera to the fighting.
    await page.evaluate(() => { const b = window.__g.battle; let x = 0, z = 0, n = 0; for (let i = 0; i < b.n; i++) if (b.alive[i] && b.target[i] >= 0) { x += b.x[i]; z += b.z[i]; n++; } if (n) { window.__g.cam.x = x / n; window.__g.cam.z = z / n; } window.__g.cam.dist = 90; window.__g.cam.pitch = 0.35; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${O}/3-melee.png` });
    await page.evaluate(() => { window.__g.cam.dist = 26; window.__g.cam.pitch = 0.18; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${O}/4-close.png` });
    await page.evaluate(() => { window.__g.cam.dist = 420; window.__g.cam.pitch = 0.6; });
  }
}
await page.screenshot({ path: `${O}/5-late.png` });
console.log(errors.slice(0, 5));
await browser.close();
