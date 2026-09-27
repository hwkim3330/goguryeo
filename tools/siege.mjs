// The Ansi siege: views of the fortress, then both sides on AI at speed, with shots along the way.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const fast = process.argv.includes("--fast");
const { browser, page, errors } = await launch();
const idx = await page.evaluate(() => 2);
await page.evaluate((i) => window.__g.brief(i), idx);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("brief").classList.add("off"));
const view = async (name, x, z, dist, pitch, yaw) => {
  await page.evaluate(([x, z, d, p, y]) => Object.assign(window.__g.cam, { x, z, dist: d, pitch: p, yaw: y }), [x, z, dist, pitch, yaw]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${O}/s-${name}.png` });
};
if (!fast) {
  await view("wide", 0, -40, 700, 0.55, 0.3);
  await view("gate", 0, 110, 90, 0.25, 0.1);
  await view("wall", 60, 100, 45, 0.18, -0.9);
}
await page.evaluate(() => { window.__g.go(); window.__g.autoplay(); window.__g.setSpeed(3); });
const t0 = Date.now();
let k = 0;
for (;;) {
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => { const b = window.__g.battle; const f = b.field.fort; const side = (s) => b.units.filter((u) => u.side === s).map((u) => `${u.name.slice(0, 4)}:${b.livingMen(u)}${u.state.slice(0,2)}`).join(" "); let climbing = 0; for (let i = 0; i < b.n; i++) if (b.alive[i] && b.climb[i] > 0) climbing++; return { t: Math.round(b.time), res: b.result, gate: Math.round(f.gateHp), walls: b.ev.walls, climbing, s0: side(0), s1: side(1) }; });
  console.log(JSON.stringify(st));
  if (!fast && k < 3 && st.t > 60 + k * 120) {
    await page.evaluate(() => window.__g.setSpeed(0));
    await view(`fight${k}`, [0, 70, 20][k], [150, 110, 140][k], [120, 70, 200][k], [0.35, 0.3, 0.45][k], [0.2, -0.6, 0.4][k]);
    await page.evaluate(() => window.__g.setSpeed(3));
    k++;
  }
  if (st.res >= 0 || Date.now() - t0 > 280000) break;
}
console.log(errors.slice(0, 5));
await browser.close();
