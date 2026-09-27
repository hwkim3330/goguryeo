// A campaign battle fought on the field: march into an enemy army, lead it, come back to the map.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const siege = process.argv.includes("--siege");
const { browser, page, errors } = await launch();
await page.evaluate(() => { try { localStorage.clear(); } catch {} window.__g.startCampaign("598"); });
await page.waitForTimeout(2500);
const clickModal = async (prefer) => {
  const btns = await page.$$("#cmodal:not(.off) .mbtns button");
  if (!btns.length) return false;
  let pick = btns[0];
  for (const b of btns) { const t = await b.textContent(); if (prefer && t.includes(prefer)) pick = b; }
  await pick.click();
  await page.waitForTimeout(400);
  return true;
};
await clickModal();
const info = await page.evaluate((siege) => {
  const c = window.__g.campaign;
  const g = c.game;
  const a = g.armies.find((x) => x.owner === "goguryeo" && x.general === "강이식");
  g.declare("goguryeo", "sui");
  let target;
  if (siege) {
    target = g.cities.find((x) => x.name === "무려라");
    target.owner = "sui";
    target.walls = 2;
    target.garrison = [g.unit("sui", "suiSpear"), g.unit("sui", "suiBow"), g.unit("sui", "suiSword")];
    g.recomputeTerritory();
    // Stand next to it.
    const h = g.hexes[target.hex];
    a.hex = [...g.hexes].filter((o) => o.terrain !== "sea" && Math.abs(o.col - h.col) <= 1 && Math.abs(o.row - h.row) <= 1 && o.i !== h.i && !g.cityAt(o.i))[0].i;
    a.moves = 4;
    c.view.sync();
    c.select({ kind: "army", id: a.id });
    c.siegeChoice(a, target);
    return { siege: true };
  }
  const h = g.hexes[a.hex];
  const n = g.hexes.find((o) => o.terrain !== "sea" && Math.abs(o.col - h.col) === 1 && o.row === h.row && !g.cityAt(o.i));
  const e = g.spawnArmy("sui", n.i, ["suiSpear", "suiSword", "suiBow", "suiCav"], "시험 장수");
  c.view.sync();
  c.select({ kind: "army", id: a.id });
  c.order(a, n);
  return { from: a.hex, to: n.i };
}, siege);
console.log(info);
await page.waitForTimeout(800);
await page.screenshot({ path: `${O}/cb-0-prompt.png` });
await clickModal(siege ? "성을 친다" : "직접");
await page.waitForTimeout(800);
if (siege) { await clickModal("직접"); await page.waitForTimeout(800); }
await page.waitForTimeout(2500);
await page.screenshot({ path: `${O}/cb-1-brief.png` });
await page.evaluate(() => { window.__g.go(); window.__g.autoplay(); window.__g.setSpeed(3); });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${O}/cb-2-fight.png` });
for (let k = 0; k < 70; k++) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => window.__g.battle?.result);
  if (r !== undefined && r >= 0) break;
}
await page.waitForTimeout(3500);
await page.screenshot({ path: `${O}/cb-3-end.png` });
await page.click("#again");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${O}/cb-4-back.png` });
console.log(await page.evaluate(() => { const g = window.__g.campaign.game; return { mode: window.__g.mode, log: g.log.slice(0, 4).map((l) => l.text), mine: g.armies.filter((a) => a.owner === "goguryeo").map((a) => `${a.general}:${a.units.map((u) => u.men).join(",")}`) }; }));
console.log(errors.slice(0, 5));
await browser.close();
