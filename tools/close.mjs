// Close-ups of the troops before the battle starts, and one of a melee.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const { browser, page, errors } = await launch();
await page.evaluate(() => window.__g.brief(0));
await page.waitForTimeout(1200);
await page.evaluate(() => { document.getElementById("brief").classList.add("off"); });
const shot = async (name, unitName, dist, pitch, yaw) => {
  await page.evaluate(([n, d, p, y]) => { const b = window.__g.battle; const u = b.units.find((q) => q.name === n); const [x, z] = b.pos(u); Object.assign(window.__g.cam, { x, z, dist: d, pitch: p, yaw: y }); }, [unitName, dist, pitch, yaw]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${O}/c-${name}.png` });
};
await shot("gaema", "개마무사 제1대", 22, 0.2, 2.2);
await shot("sword", "환도수 제1대", 16, 0.18, 2.8);
await shot("spear", "창수 제1대", 18, 0.2, 2.6);
await shot("bow", "맥궁 궁수 제1대", 16, 0.22, 3.4);
await shot("wide", "환도수 제1대", 160, 0.4, 3.1);
console.log(errors.slice(0, 3));
await browser.close();
