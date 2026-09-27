// Both sides on AI, fast-forward to the end: does every battle finish, and who wins?
import { launch } from "./gpu.mjs";
const { browser, page, errors } = await launch();
for (const i of [0, 1]) {
  await page.evaluate((i) => { window.__g.brief(i); window.__g.go(); window.__g.autoplay(); window.__g.setSpeed(3); }, i);
  const t0 = Date.now();
  let st;
  for (;;) {
    await page.waitForTimeout(3000);
    st = await page.evaluate(() => { const b = window.__g.battle; const side = (s) => b.units.filter((u) => u.side === s).map((u) => `${u.name.slice(0, 4)}:${b.livingMen(u)}${u.state[0]}`).join(" "); return { t: Math.round(b.time), res: b.result, a: Math.round(b.strength(0)), b: Math.round(b.strength(1)), routs: b.ev.routs.length, s0: side(0), s1: side(1) }; });
    if (st.res >= 0 || Date.now() - t0 > 150000) break;
  }
  console.log("scenario", i, JSON.stringify(st));
}
console.log(errors.slice(0, 3));
await browser.close();
