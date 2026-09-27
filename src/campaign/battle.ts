/**
 * From the map to the field: a campaign encounter becomes a real-time battle. The ground comes
 * from the hex (hills for hills, forest for forest, a river with fords if one runs through);
 * a walled city becomes a fortress sized by its people and walls, its gate toward the
 * attacker, with the rams and the mound the besiegers had time to build. Each side deploys
 * its army — foot in the centre, archers behind, horse on the wings, the general at the back;
 * a city's defenders man the walls. What's left of every regiment afterwards goes back to the map.
 */
import type { Look } from "../engine/scene";
import type { Scenario } from "../scenarios";
import type { Battle, Unit } from "../sim/battle";
import { TYPES, type UnitType } from "../sim/units";
import type { FortSpec } from "../world/fort";
import type { FieldSpec } from "../world/terrain";
import { FACTIONS, unitTypeFor, type FactionId } from "./data";
import { josa, type BattleSetup, type CUnit, type Game } from "./state";

const N = 0;
const S = Math.PI;

export interface CampaignBattle {
  scen: Scenario;
  refs: Map<number, CUnit>;
  playerIsAttacker: boolean;
  foeName: string;
}

/** A regiment's stats with the kingdom's learning applied. */
export function typeFor(g: Game, f: FactionId, typeId: string): UnitType {
  const t = { ...unitTypeFor(f, typeId, g.tang) };
  const tech = g.powers[f].techs;
  if (tech.includes("iron")) t.armour += 2;
  if (tech.includes("bow") && t.range > 0) {
    t.range = Math.round(t.range * 1.15);
    t.attack += 1;
  }
  if (tech.includes("buddhism")) t.morale += 3;
  return t;
}

function ring(cz: number, r: number, seed: number): [number, number][] {
  const pts: [number, number][] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r + Math.sin(a * 3 + seed) * r * 0.1 + Math.sin(a * 5 + seed * 2.1) * r * 0.05;
    pts.push([Math.sin(a) * rr * 1.1, cz + Math.cos(a) * rr * 0.9]);
  }
  return pts;
}

function onRing(R: [number, number][], cz: number, i: number, t: number, out: number): [number, number, number] {
  const [ax, az] = R[(i + R.length) % R.length];
  const [bx, bz] = R[(i + 1 + R.length) % R.length];
  const x = ax + (bx - ax) * t;
  const z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az);
  let nx = (bz - az) / l;
  let nz = -(bx - ax) / l;
  if (nx * x + nz * (z - cz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [x + nx * out, z + nz * out, Math.atan2(nx, nz)];
}

function lookFor(year: number, hexI: number): Look {
  const k = (year * 7 + hexI) % 4;
  return [
    { sunElev: 34, sunAz: 150, turbidity: 3.5, rayleigh: 1.2, fog: 0.00026, exposure: 1.0 },
    { sunElev: 18, sunAz: 240, turbidity: 5, rayleigh: 1.6, fog: 0.0003, exposure: 0.95 },
    { sunElev: 46, sunAz: 190, turbidity: 2.8, rayleigh: 1.1, fog: 0.00022, exposure: 1.0 },
    { sunElev: 24, sunAz: 110, turbidity: 4, rayleigh: 1.4, fog: 0.00028, exposure: 0.97 },
  ][k];
}

export function campaignBattle(g: Game, s: BattleSetup): CampaignBattle {
  const playerIsAttacker = s.attacker.faction === g.player;
  const me = playerIsAttacker ? s.attacker : s.defender;
  const foe = playerIsAttacker ? s.defender : s.attacker;
  const h = s.hex;
  const hills: Record<string, number> = { plains: 0.35, steppe: 0.2, hills: 0.85, mountains: 1.15, forest: 0.5, marsh: 0.15, sea: 0.3 };
  const forest: Record<string, number> = { plains: 0.25, steppe: 0.05, hills: 0.45, mountains: 0.6, forest: 0.95, marsh: 0.3, sea: 0 };
  const city = s.defender.city;
  const seed = h.i * 31 + g.year;
  const field: FieldSpec = { seed, size: 1600, hills: hills[h.terrain], forest: forest[h.terrain], roads: [[[20, 800], [0, 0], [-30, -800]]], bumps: [] };
  let fortR: [number, number][] | null = null;
  const cz = -90;
  let fr = 0;
  if (s.siege && city) {
    fr = Math.min(250, 140 + city.pop * 8 + city.walls * 10);
    fortR = ring(cz, fr, seed % 7);
    const fort: FortSpec = { ring: fortR, gate: 0, height: 6 + city.walls * 1.5, thick: 6 + city.walls * 0.5, side: playerIsAttacker ? 1 : 0, hold: 900 };
    if (s.mound) {
      const [mx, mz] = onRing(fortR, cz, 3, 0.5, 24);
      fort.mound = [mx, mz, 46, fort.height + 3];
    }
    field.fort = fort;
    field.bumps!.push([0, cz - 20, fr * 2.4, city.mountain ? 46 : 14]);
    field.roads = [[[0, 800], [onRing(fortR, cz, 0, 0.5, 0)[0], onRing(fortR, cz, 0, 0.5, 0)[1]]]];
  } else if (h.river) {
    field.river = { pts: [[-820, 30], [-400, 0], [0, 40], [400, 10], [820, 40]], width: 64, depth: 2.4, fords: [[-180, 10, 60], [260, 25, 55]] };
  }
  const refs = new Map<number, CUnit>();
  const deployField = (b: Battle, side: 0 | 1, f: FactionId, units: CUnit[], general: string | null, z0: number, face: number) => {
    const team = f === "sui" && g.tang ? 2 : FACTIONS[f].team;
    const back = face === S ? 1 : -1;
    const pick = [...units].sort((a, b) => b.men - a.men).slice(0, 16);
    const foot = pick.filter((u) => !TYPES[u.type].mounted && TYPES[u.type].range === 0 && TYPES[u.type].role !== "ram");
    const bows = pick.filter((u) => !TYPES[u.type].mounted && TYPES[u.type].range > 0);
    const horse = pick.filter((u) => TYPES[u.type].mounted);
    const rams = pick.filter((u) => TYPES[u.type].role === "ram");
    const line = (list: CUnit[], z: number, gap = 12): number => {
      const widths = list.map((u) => {
        const t = TYPES[u.type];
        return (t.mounted ? 2.3 : t.role === "bow" ? 1.5 : 1.15) * Math.min(t.files, u.men) + gap;
      });
      const total = widths.reduce((a, w) => a + w, 0);
      let x = -total / 2;
      list.forEach((u, k) => {
        const cx = x + widths[k] / 2;
        x += widths[k];
        const bu = b.addUnit(u.type, side, team, cx, z, face, u.name, { men: u.men, type: typeFor(g, f, u.type) });
        refs.set(bu.id, u);
      });
      return total;
    };
    const w1 = line(foot.slice(0, 6), z0);
    if (foot.length > 6) line(foot.slice(6), z0 + back * 26);
    line(bows, z0 + back * (foot.length > 6 ? 52 : 28));
    horse.forEach((u, k) => {
      const sideX = (k % 2 ? 1 : -1) * (w1 / 2 + 60 + Math.floor(k / 2) * 55);
      const bu = b.addUnit(u.type, side, team, sideX, z0 + back * 10, face, u.name, { men: u.men, type: typeFor(g, f, u.type) });
      refs.set(bu.id, u);
    });
    rams.forEach((u, k) => {
      const bu = b.addUnit(u.type, side, team, (k - 0.5) * 30, z0 - back * 30, face, u.name, { men: u.men, type: typeFor(g, f, u.type) });
      refs.set(bu.id, u);
    });
    if (general) b.addUnit(f === "goguryeo" ? "general" : "suiGeneral", side, team, 0, z0 + back * 80, face, general, { type: { ...typeFor(g, f, f === "goguryeo" ? "general" : "suiGeneral"), name: general } });
  };
  const deployFort = (b: Battle, side: 0 | 1, f: FactionId, units: CUnit[], general: string | null) => {
    const R = fortR!;
    const team = f === "sui" && g.tang ? 2 : FACTIONS[f].team;
    const pick = [...units].sort((a, b) => b.men - a.men).slice(0, 16);
    const bows = pick.filter((u) => TYPES[u.type].range > 0 && !TYPES[u.type].mounted);
    const rest = pick.filter((u) => !bows.includes(u));
    const segs = [R.length - 1, 1, R.length - 2, 2, R.length - 3, 3, 4, R.length - 4];
    bows.forEach((u, k) => {
      const [x, z, face] = onRing(R, cz, segs[k % segs.length], 0.5, 2);
      const bu = b.addUnit(u.type, side, team, x, z, face, u.name, { men: u.men, type: typeFor(g, f, u.type), files: 36 });
      b.order(bu, { k: "move", x, z, face, files: 36, run: false });
      refs.set(bu.id, u);
    });
    // Foot and horse inside, behind the gate.
    const [gx, gz] = onRing(R, cz, 0, 0.5, -45);
    rest.forEach((u, k) => {
      const row = Math.floor(k / 3);
      const col = (k % 3) - 1;
      const bu = b.addUnit(u.type, side, team, gx + col * 60, gz - row * 40, N, u.name, { men: u.men, type: typeFor(g, f, u.type) });
      refs.set(bu.id, u);
    });
    if (general) b.addUnit(f === "goguryeo" ? "general" : "suiGeneral", side, team, 0, cz - 20, N, general, { type: { ...typeFor(g, f, f === "goguryeo" ? "general" : "suiGeneral"), name: general } });
  };
  const addRams = (units: CUnit[], f: FactionId) => {
    for (let k = 0; k < s.rams; k++) units.push({ id: -1 - k, type: "suiRam", name: `충차 제${k + 1}대`, men: 28, max: 28, xp: 0 });
    void f;
  };
  const meUnits = [...me.units];
  const foeUnits = [...foe.units];
  if (s.siege && s.rams) addRams(playerIsAttacker ? meUnits : foeUnits, s.attacker.faction);
  const scen: Scenario = {
    id: "campaign",
    year: `${g.year}년`,
    title: city ? `${city.name} ${s.siege ? "공방전" : "전투"}` : `${josa(g.name(foe.faction), "과")}의 싸움`,
    sub: `${g.name(s.attacker.faction)} 공격 · ${g.name(s.defender.faction)} 방어`,
    story: [],
    goal: s.siege ? (playerIsAttacker ? "성을 떨어뜨리십시오: 충차로 성문을, 사다리로 성벽을. 해가 지기 전에(15분)." : "해가 질 때까지(15분) 성을 지키십시오.") : "적을 무너뜨리십시오.",
    field,
    look: lookFor(g.year, h.i),
    setup(b) {
      const myGeneral = me.army?.general ?? (me.city ? `${me.city.name} 성주` : null);
      const foeGeneral = foe.army?.general ?? (foe.city ? `${foe.city.name} 성주` : null);
      if (s.siege && fortR) {
        // The attacker comes from the south, toward the gate.
        const z0 = cz + fr + 230;
        if (playerIsAttacker) {
          deployField(b, 0, me.faction, meUnits, myGeneral, z0, S);
          deployFort(b, 1, foe.faction, foeUnits, foeGeneral);
        } else {
          deployFort(b, 0, me.faction, meUnits, myGeneral);
          deployField(b, 1, foe.faction, foeUnits, foeGeneral, z0, S);
        }
      } else {
        deployField(b, 0, me.faction, meUnits, myGeneral, 260, S);
        deployField(b, 1, foe.faction, foeUnits, foeGeneral, -260, N);
      }
    },
    cam: s.siege ? { x: 0, z: cz + fr + 120, dist: 380, yaw: 0.2, pitch: 0.55 } : { x: 0, z: 330, dist: 360, yaw: 0, pitch: 0.55 },
  };
  return { scen, refs, playerIsAttacker, foeName: g.name(foe.faction) };
}

/** After the fight: survivors back into their regiments. */
export function applyBattle(cb: CampaignBattle, b: Battle, playerWon: boolean): { attackerWon: boolean } {
  for (const u of b.units) {
    const ref = cb.refs.get(u.id);
    if (!ref || ref.id < 0) continue;
    ref.men = u.state === "gone" ? 0 : b.livingMen(u as Unit);
  }
  return { attackerWon: cb.playerIsAttacker ? playerWon : !playerWon };
}
