// Headless campaign: the player idles (or plays a naive AI), every battle auto-resolves.
import { Game } from "../src/campaign/state";
const start = +(process.argv[2] ?? 598);
const g = Game.create(start);
g.autoPlayer = process.argv.includes("--ai");
g.onEvent = async (e) => { e.choices?.[0]?.apply(g); };
let battles = 0;
g.onBattle = async (s) => { battles++; return g.autoResolve(s); };
const t0 = Date.now();
while (!g.over && g.year <= 672) {
  // The player's cities recruit a bit so it isn't a pushover.
  if (!g.autoPlayer) for (const c of g.cities.filter((c) => c.owner === "goguryeo")) {
    if (!c.recruit) g.startRecruit(c, ["spear", "maekgung", "sword"][g.year % 3]);
    if (!c.build) g.startBuild(c, ["farm", "market", "barracks", "walls"][g.year % 4]);
  }
  await g.endTurn();
  if (g.year % 6 === 0 || g.over) {
    const own = (f) => g.cities.filter((c) => c.owner === f).length;
    console.log(g.year, "cities", ["goguryeo", "sui", "baekje", "silla", "malgal", "khitan"].map((f) => `${f[0]}${own(f)}`).join(" "), "armies", g.armies.length, "gold", Math.round(g.powers.goguryeo.gold), "battles", battles);
  }
}
console.log("over", g.over, "ms", Date.now() - t0);
console.log(g.log.slice(0, 25).map((l) => `${l.year} ${l.text}`).join("\n"));
console.log(g.log.filter((l) => l.text.includes("손에 들어")).reverse().slice(0, 40).map((l) => `${l.year} ${l.text}`).join("\n"));
