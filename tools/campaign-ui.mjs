// Click through the campaign UI: diplomacy, learning, a city (build + recruit), an army march by clicking.
import { launch } from "./gpu.mjs";
const O = process.argv[2] ?? "shots";
const { browser, page, errors } = await launch();
await page.evaluate(() => { try { localStorage.clear(); } catch {} window.__g.startCampaign("642"); });
await page.waitForTimeout(3500);
const clickModal = async (prefer) => {
  const btns = await page.$$("#cmodal:not(.off) .mbtns button");
  if (!btns.length) return false;
  let pick = btns[0];
  for (const b of btns) { const t = await b.textContent(); if (prefer && t.includes(prefer)) pick = b; }
  await pick.click();
  await page.waitForTimeout(400);
  return true;
};
await page.screenshot({ path: `${O}/ui-0-event.png` });
while (await clickModal()) {}
await page.click("#cdip");
await page.waitForTimeout(500);
await page.screenshot({ path: `${O}/ui-1-dip.png` });
await clickModal("닫기");
await page.click("#ctech");
await page.waitForTimeout(500);
await page.screenshot({ path: `${O}/ui-2-tech.png` });
await page.click("#cbox .tech:not(.done):not(.locked)");
await page.waitForTimeout(300);
// A city: build and recruit through the panel.
await page.evaluate(() => { const c = window.__g.campaign; const cc = c.game.cities.find((x) => x.name === "국내성"); c.select({ kind: "city", id: cc.id }); const h = c.game.hexes[cc.hex]; Object.assign(c.cam, { x: h.x, z: h.z + 40, dist: 300 }); });
await page.waitForTimeout(700);
await page.click("#cpanel [data-b]:not([disabled])");
await page.waitForTimeout(200);
await page.click("#cpanel [data-r]:not([disabled])");
await page.waitForTimeout(500);
await page.screenshot({ path: `${O}/ui-3-city.png` });
// An army: click a lit hex to march.
const pt = await page.evaluate(() => {
  const c = window.__g.campaign; const g = c.game;
  const a = g.armies.find((x) => x.owner === "goguryeo");
  c.select({ kind: "army", id: a.id });
  const h = g.hexes[a.hex];
  Object.assign(c.cam, { x: h.x, z: h.z + 40, dist: 320 });
  const far = [...c.reach.entries()].filter(([i]) => i !== a.hex).sort((x, y) => y[1].cost - x[1].cost)[0][0];
  return { far, from: a.hex, id: a.id };
});
await page.waitForTimeout(900);
const scr = await page.evaluate((far) => { const c = window.__g.campaign; const h = c.game.hexes[far]; const v = new window.__g.stage.camera.position.constructor(h.x, c.view.heightAt(h.x, h.z), h.z).project(window.__g.stage.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, pt.far);
await page.screenshot({ path: `${O}/ui-4-reach.png` });
await page.mouse.move(scr[0], scr[1]);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(1500);
console.log("moved", await page.evaluate((id) => window.__g.campaign.game.armies.find((a) => a.id === id)?.hex, pt.id), "target", pt.far, "from", pt.from);
await page.screenshot({ path: `${O}/ui-5-moved.png` });
console.log(errors.slice(0, 5));
await browser.close();
