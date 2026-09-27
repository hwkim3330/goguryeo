// Start a campaign, shoot the map, play a few years (auto battles), shoot again.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const years = +(process.argv[3] ?? 4);
const { browser, page, errors } = await launch();
await page.evaluate(() => { try { localStorage.clear(); } catch {} window.__g.startCampaign("598"); });
await page.waitForTimeout(2500);
const clickModal = async (prefer) => {
  const btns = await page.$$("#cmodal:not(.off) .mbtns button");
  if (!btns.length) return false;
  let pick = btns[0];
  for (const b of btns) { const t = await b.textContent(); if (prefer && t.includes(prefer)) pick = b; }
  await pick.click();
  await page.waitForTimeout(300);
  return true;
};
const shot = async (n) => page.screenshot({ path: `${O}/camp-${n}.png` });
await shot("0-start");
await clickModal();
const cam = (x, z, dist) => page.evaluate(([x, z, d]) => { const c = window.__g.campaign; Object.assign(c.cam, { x, z, dist: d }); }, [x, z, dist]);
await cam(0, 0, 1500);
await page.waitForTimeout(800);
await shot("1-wide");
// Select the first army.
await page.evaluate(() => { const c = window.__g.campaign; const a = c.game.armies.find((a) => a.owner === "goguryeo"); c.select({ kind: "army", id: a.id }); const h = c.game.hexes[a.hex]; Object.assign(c.cam, { x: h.x, z: h.z + 60, dist: 420 }); });
await page.waitForTimeout(1000);
await shot("2-army");
await page.evaluate(() => { const c = window.__g.campaign; const cc = c.game.cities.find((x) => x.name === "평양성"); c.select({ kind: "city", id: cc.id }); const h = c.game.hexes[cc.hex]; Object.assign(c.cam, { x: h.x, z: h.z + 40, dist: 240 }); });
await page.waitForTimeout(1000);
await shot("3-city");
for (let y = 0; y < years; y++) {
  await page.evaluate(() => { window.__g.campaign.endTurn(); });
  for (let k = 0; k < 60; k++) {
    await page.waitForTimeout(250);
    if (await clickModal("장수에게")) continue;
    const busy = await page.evaluate(() => !document.getElementById("cbusy").classList.contains("off"));
    if (!busy) break;
  }
  await clickModal("장수에게");
}
await cam(0, -100, 1300);
await page.waitForTimeout(800);
await shot("4-later");
console.log(await page.evaluate(() => { const g = window.__g.campaign.game; return g.year + " " + g.log.slice(0, 8).map((l) => l.text).join(" | "); }));
console.log(errors.slice(0, 5));
await browser.close();
