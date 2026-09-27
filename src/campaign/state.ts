/**
 * The strategic game (천하): one turn is a year. Cities grow on their grain and pay in treasure;
 * they build, raise regiments and study; armies march across the hexes (hills, forests,
 * mountains, rivers and the Liao marsh slow them), wither away from home and fall into battle
 * when they meet an enemy or walk up to his walls. Each of the six powers keeps its own
 * treasury and its relations with the others (war, peace, alliance, vassalage); the computer
 * powers raise armies, go after weaker neighbours and make peace when a war goes badly, and the
 * history of the age (수's invasions, the fall of 수 and rise of 당, 연개소문, 당 태종) arrives
 * on its year as events.
 */
import { TYPES } from "../sim/units";
import { BUILDINGS, CITIES, FACTION_IDS, FACTIONS, GENERALS, TECHS, unitTypeFor, type FactionId } from "./data";
import { buildHexes, COLS, hexDist, neighbours, project, hexAt, type Hex, type Terrain } from "./geo";

export interface CUnit {
  id: number;
  type: string;
  name: string;
  men: number;
  max: number;
  xp: number;
}

export interface Army {
  id: number;
  owner: FactionId;
  hex: number;
  units: CUnit[];
  general: string;
  moves: number;
  /** City (id) this army is besieging, and for how many turns. */
  siege: number;
  siegeTurns: number;
  /** An expedition: where it's going and how many turns of supply it has left. */
  target?: number;
  supply?: number;
  expedition?: boolean;
}

export interface City {
  id: number;
  name: string;
  hex: number;
  owner: FactionId;
  pop: number;
  food: number;
  walls: number;
  buildings: string[];
  build: { id: string; left: number } | null;
  recruit: { type: string; left: number } | null;
  capital: boolean;
  mountain: boolean;
  garrison: CUnit[];
  /** Turns under siege without relief. */
  besieged: number;
}

export type Rel = "war" | "peace" | "ally" | "vassal" | "overlord";

export interface Power {
  id: FactionId;
  gold: number;
  lore: number;
  techs: string[];
  researching: string | null;
  rel: Record<FactionId, Rel>;
  attitude: Record<FactionId, number>;
  warTurns: Record<FactionId, number>;
  alive: boolean;
}

export interface LogLine {
  year: number;
  text: string;
  kind: "" | "gold" | "bad" | "event";
}

export interface EventChoice {
  label: string;
  hint?: string;
  apply: (g: Game) => void;
}
export interface GameEvent {
  title: string;
  text: string[];
  choices?: EventChoice[];
}

export interface BattleSide {
  faction: FactionId;
  army: Army | null;
  city: City | null;
  units: CUnit[];
}
export interface BattleSetup {
  attacker: BattleSide;
  defender: BattleSide;
  hex: Hex;
  siege: boolean;
  /** Siege works the attacker has had time to build: rams after a turn, the mound after two. */
  rams: number;
  mound: boolean;
}
export interface BattleOutcome {
  attackerWon: boolean;
}

/** Korean particles that follow a word: 이/가, 을/를, 과/와, 은/는, (으)로. */
export function josa(w: string, kind: "이" | "을" | "과" | "은" | "로"): string {
  const ch = w.charCodeAt(w.length - 1);
  const hangul = ch >= 0xac00 && ch <= 0xd7a3;
  const jong = hangul ? (ch - 0xac00) % 28 : 0;
  const has = jong !== 0;
  const pair: Record<string, [string, string]> = { 이: ["이", "가"], 을: ["을", "를"], 과: ["과", "와"], 은: ["은", "는"], 로: ["으로", "로"] };
  let [a, b] = pair[kind];
  if (kind === "로" && jong === 8) a = "로";
  return w + (has ? a : b);
}

export const MOVE_COST: Record<Terrain, number> = { sea: 99, plains: 1, steppe: 1, hills: 2, forest: 2, mountains: 3, marsh: 3 };
export const START_YEARS = [598, 642] as const;

export class Game {
  hexes: Hex[] = [];
  cities: City[] = [];
  armies: Army[] = [];
  powers = {} as Record<FactionId, Power>;
  year = 598;
  end = 670;
  tang = false;
  log: LogLine[] = [];
  fired: string[] = [];
  nextId = 1;
  over: null | { win: boolean; title: string; text: string } = null;
  /** Hex → owning faction (territory), recomputed when cities change hands. */
  owner: (FactionId | null)[] = [];
  readonly player: FactionId = "goguryeo";
  /** Set by the shell: resolve a battle (the player may fight it). */
  onBattle: (s: BattleSetup) => Promise<BattleOutcome> = async (s) => this.autoResolve(s);
  onEvent: (e: GameEvent) => Promise<void> = async (e) => {
    e.choices?.[0]?.apply(this);
  };

  static create(start: number): Game {
    const g = new Game();
    g.hexes = buildHexes();
    g.year = start;
    for (const f of FACTION_IDS) {
      const rel = {} as Record<FactionId, Rel>;
      const att = {} as Record<FactionId, number>;
      const wt = {} as Record<FactionId, number>;
      for (const o of FACTION_IDS) {
        rel[o] = "peace";
        att[o] = 0;
        wt[o] = 0;
      }
      g.powers[f] = { id: f, gold: f === "sui" ? 400 : 160, lore: 0, techs: [], researching: null, rel, attitude: att, warTurns: wt, alive: true };
    }
    const taken = new Set<number>();
    for (const c of CITIES) {
      let [col, row] = hexAt(...project(c.lon, c.lat));
      let h = g.hexes[row * COLS + col];
      if (!h || h.terrain === "sea" || taken.has(h.i)) {
        // The nearest free land hex.
        let best: Hex | null = null;
        let bd = Infinity;
        for (const o of g.hexes) {
          if (o.terrain === "sea" || taken.has(o.i)) continue;
          const d = Math.hypot(o.col - col, o.row - row);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        h = best!;
        col = h.col;
        row = h.row;
      }
      taken.add(h.i);
      const city: City = { id: g.cities.length, name: c.name, hex: h.i, owner: c.owner, pop: c.pop, food: 0, walls: c.walls, buildings: [], build: null, recruit: null, capital: !!c.capital, mountain: !!c.mountain, garrison: [], besieged: 0 };
      if (c.pop >= 5) city.buildings.push("farm", "market");
      if (c.capital) city.buildings.push("barracks", "school");
      if (c.owner === "goguryeo" && (c.name === "국내성" || c.name === "요동성")) city.buildings.push("barracks", "stable");
      if (c.owner === "malgal" || c.owner === "khitan") city.buildings.push("stable");
      g.cities.push(city);
    }
    g.setRel("goguryeo", "silla", "war");
    g.setRel("malgal", "goguryeo", "vassal");
    g.attitude("goguryeo", "sui", -30);
    g.attitude("goguryeo", "baekje", -10);
    g.attitude("baekje", "silla", -40);
    g.setRel("baekje", "silla", "war");
    g.attitude("khitan", "sui", -20);
    // Garrisons, by size and walls; and the field armies of the time.
    for (const c of g.cities) {
      const n = Math.max(1, Math.min(5, Math.round(c.pop / 2 + c.walls / 2)));
      const r = FACTIONS[c.owner].roster;
      for (let k = 0; k < n; k++) c.garrison.push(g.unit(c.owner, r[k % 3 === 2 && r.length > 3 ? 3 : k % 2]));
    }
    const army = (owner: FactionId, city: string, types: string[], general?: string) => {
      const c = g.cities.find((x) => x.name === city)!;
      return g.spawnArmy(owner, c.hex, types, general);
    };
    army("goguryeo", "요동성", ["spear", "spear", "sword", "maekgung", "maekgung", "horsebow"], "강이식");
    army("goguryeo", "평양성", ["spear", "sword", "axe", "maekgung", "gaema", "horsebow"], "을지문덕");
    army("goguryeo", "한성", ["spear", "sword", "maekgung", "horsebow"], "고승");
    army("silla", "한산성", ["suiSpear", "suiSword", "suiBow", "suiSpear"]);
    army("silla", "서라벌", ["suiSpear", "suiSword", "suiBow", "suiCav"]);
    army("baekje", "사비성", ["suiSpear", "suiSword", "suiBow", "suiBow"]);
    army("sui", "유성", ["suiSpear", "suiSword", "suiBow", "suiCav", "suiCav"]);
    army("sui", "탁군", ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiBow", "suiCav"]);
    army("khitan", "거란 대하씨", ["horsebow", "horsebow", "suiCav"]);
    g.powers.goguryeo.techs.push("bow");
    if (start === 642) g.start642();
    for (const a of g.armies) a.moves = g.maxMoves(a);
    g.recomputeTerritory();
    g.say(`${start}년. ${start === 598 ? "영양왕 9년, 수 문제가 천하를 통일하고 고구려를 넘본다." : "보장왕 원년. 연개소문이 권력을 잡고, 당 태종이 요동을 노린다."}`, "event");
    return g;
  }

  /** The later start: 수 has fallen, 당 rules; the Liao line is walled; 신라 and 백제 at each other's throats. */
  private start642(): void {
    this.tang = true;
    this.fired.push("598a", "598", "600", "607", "612", "613", "614", "618", "631");
    const gg = this.powers.goguryeo;
    gg.techs.push("iron", "dunjeon", "sanseong", "yulryeong", "bongsu");
    gg.gold = 260;
    for (const c of this.cities) {
      if (c.owner === "goguryeo" && ["요동성", "신성", "안시성", "건안성", "비사성", "부여성"].includes(c.name)) c.walls = Math.min(4, c.walls + 1);
      if (c.name === "무려라") c.owner = "sui";
      if (c.name === "대야성") c.owner = "baekje";
      if (c.owner === "goguryeo") c.pop = Math.min(12, c.pop + 1);
    }
    this.armies = this.armies.filter((a) => a.owner !== "sui");
    const gen: Record<string, string> = { 강이식: "고연수", 을지문덕: "연개소문", 고승: "고혜진" };
    for (const a of this.armies) if (gen[a.general]) a.general = gen[a.general];
    const t = (city: string, types: string[], general: string) => this.spawnArmy("sui", this.cities.find((c) => c.name === city)!.hex, types, general);
    t("유성", ["suiSpear", "suiSword", "suiBow", "suiCav", "suiCav", "suiSpear"], "이세적");
    t("탁군", ["suiSpear", "suiSpear", "suiSword", "suiBow", "suiCav", "suiCav"], "장량");
    this.powers.sui.gold = 700;
    this.attitude("goguryeo", "sui", -50);
    this.attitude("silla", "sui", 40);
  }

  // ------------------------------------------------------------------ basics

  say(text: string, kind: LogLine["kind"] = ""): void {
    this.log.unshift({ year: this.year, text, kind });
    if (this.log.length > 200) this.log.length = 200;
  }

  name(f: FactionId): string {
    return f === "sui" && this.tang ? "당" : FACTIONS[f].name;
  }

  rel(a: FactionId, b: FactionId): Rel {
    return this.powers[a].rel[b];
  }
  setRel(a: FactionId, b: FactionId, r: Rel): void {
    const inv: Record<Rel, Rel> = { war: "war", peace: "peace", ally: "ally", vassal: "overlord", overlord: "vassal" };
    this.powers[a].rel[b] = r;
    this.powers[b].rel[a] = inv[r];
    if (r === "war") {
      this.powers[a].warTurns[b] = 0;
      this.powers[b].warTurns[a] = 0;
    }
  }
  attitude(a: FactionId, b: FactionId, d: number): void {
    const clamp = (v: number) => Math.max(-100, Math.min(100, v));
    this.powers[a].attitude[b] = clamp(this.powers[a].attitude[b] + d);
    this.powers[b].attitude[a] = clamp(this.powers[b].attitude[a] + d);
  }
  hostile(a: FactionId, b: FactionId): boolean {
    return a !== b && this.rel(a, b) === "war";
  }
  friendly(a: FactionId, b: FactionId): boolean {
    const r = this.rel(a, b);
    return a === b || r === "ally" || r === "vassal" || r === "overlord";
  }

  unit(f: FactionId, typeId: string): CUnit {
    const t = unitTypeFor(f, typeId, this.tang);
    const n = this.nextId++;
    const base = f === "goguryeo" ? t.name : t.name;
    return { id: n, type: typeId, name: `${base} ${this.ordinal(f, typeId)}`, men: t.men, max: t.men, xp: 0 };
  }
  private counters = new Map<string, number>();
  private ordinal(f: FactionId, typeId: string): string {
    const k = `${f}|${typeId}`;
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    return `제${n}대`;
  }

  spawnArmy(owner: FactionId, hex: number, types: string[], general?: string, opts: Partial<Army> = {}): Army {
    const a: Army = { id: this.nextId++, owner, hex, units: types.map((t) => this.unit(owner, t)), general: general ?? this.pickGeneral(owner), moves: 0, siege: -1, siegeTurns: 0, ...opts };
    this.armies.push(a);
    return a;
  }
  private usedGenerals = new Set<string>();
  pickGeneral(f: FactionId): string {
    const list = GENERALS[f];
    for (const n of list) if (!this.usedGenerals.has(n)) {
      this.usedGenerals.add(n);
      return n;
    }
    return `${this.name(f)} 장수 ${this.nextId}`;
  }

  cityAt(hex: number): City | undefined {
    return this.cities.find((c) => c.hex === hex);
  }
  armiesAt(hex: number): Army[] {
    return this.armies.filter((a) => a.hex === hex);
  }
  cityById(id: number): City {
    return this.cities[id];
  }

  recomputeTerritory(): void {
    const own: (FactionId | null)[] = new Array(this.hexes.length).fill(null);
    const best = new Array(this.hexes.length).fill(Infinity);
    for (const c of this.cities) {
      const ch = this.hexes[c.hex];
      const R = 3 + (c.pop >= 6 ? 1 : 0) - (c.walls === 0 && c.pop < 3 ? 1 : 0);
      for (const h of this.hexes) {
        if (h.terrain === "sea") continue;
        const d = hexDist(ch, h);
        if (d > R) continue;
        const score = d - c.pop * 0.05;
        if (score < best[h.i]) {
          best[h.i] = score;
          own[h.i] = c.owner;
        }
      }
    }
    this.owner = own;
  }

  // ------------------------------------------------------------------ strength and money

  unitPower(f: FactionId, u: CUnit): number {
    const t = unitTypeFor(f, u.type, this.tang);
    const tech = f === "goguryeo" ? this.powers.goguryeo.techs : [];
    const armour = t.armour + (tech.includes("iron") ? 2 : 0);
    const q = (t.attack * 1.2 + t.defence + armour * 0.8 + (t.mounted ? t.charge * 0.25 : 0) + (t.range > 0 ? t.range / 30 + (tech.includes("bow") ? 1.5 : 0) : 0)) * (t.hp / 11) * (t.morale / 70);
    return u.men * q * (1 + u.xp * 0.04);
  }
  armyPower(a: Army): number {
    return a.units.reduce((s, u) => s + this.unitPower(a.owner, u), 0) * 1.1;
  }
  cityPower(c: City): number {
    return c.garrison.reduce((s, u) => s + this.unitPower(c.owner, u), 0) + c.pop * 110 + c.walls * 120;
  }
  wallBonus(c: City): number {
    const tech = this.powers[c.owner].techs;
    return 1 + c.walls * 0.6 + (c.mountain ? 0.5 : 0) + (tech.includes("sanseong") ? 0.3 : 0);
  }
  totalPower(f: FactionId): number {
    let p = 0;
    for (const a of this.armies) if (a.owner === f) p += this.armyPower(a);
    for (const c of this.cities) if (c.owner === f) p += this.cityPower(c);
    return p;
  }

  upkeep(typeId: string): number {
    return Math.max(1, Math.round(this.cost(typeId) / 12));
  }
  cost(typeId: string): number {
    const c: Record<string, number> = { suiSpear: 30, suiSword: 40, suiBow: 35, suiCav: 60, suiRam: 30 };
    return c[typeId] ?? Math.round(TYPES[typeId].cost / 10);
  }

  income(f: FactionId): { gold: number; lore: number; upkeep: number } {
    const p = this.powers[f];
    let gold = 0;
    let lore = f === "goguryeo" ? 2 : 1;
    for (const c of this.cities) {
      if (c.owner !== f || c.besieged > 0) continue;
      gold += c.pop * 2.5 + (c.buildings.includes("market") ? 6 : 0) + (c.capital ? 8 : 0);
      lore += c.buildings.filter((b) => b === "school").length * 3 + (c.capital ? 1 : 0);
    }
    if (p.techs.includes("yulryeong")) gold *= 1.15;
    if (p.techs.includes("taehak")) lore *= 1.3;
    // Tribute from vassals.
    for (const o of FACTION_IDS) if (p.rel[o] === "overlord") gold += this.income(o).gold * 0.2;
    if (p.rel[this.player] === "vassal" && f !== this.player) gold *= 0.8;
    let upkeep = 0;
    for (const a of this.armies) if (a.owner === f && !a.expedition) for (const u of a.units) upkeep += this.upkeep(u.type);
    for (const c of this.cities) if (c.owner === f) for (const u of c.garrison) upkeep += this.upkeep(u.type) * 0.3;
    if (f === "sui") gold *= 1.4;
    return { gold: Math.round(gold), lore: Math.round(lore), upkeep: Math.round(upkeep) };
  }

  canRecruit(c: City, typeId: string): { ok: boolean; why?: string } {
    const f = c.owner;
    const t = TYPES[typeId];
    const b = c.buildings;
    if (!FACTIONS[f].roster.includes(typeId)) return { ok: false, why: "이 나라는 징집할 수 없다" };
    if (t.mounted && !b.includes("stable")) return { ok: false, why: "목장 필요" };
    if ((typeId === "sword" || typeId === "axe") && !b.includes("barracks")) return { ok: false, why: "병영 필요" };
    if (typeId === "gaema" && (!b.includes("smithy") || !this.powers[f].techs.includes("gaema"))) return { ok: false, why: "철장 + 문물 '개마 무장' 필요" };
    if (this.powers[f].gold < this.recruitCost(c, typeId)) return { ok: false, why: "재화 부족" };
    return { ok: true };
  }
  recruitCost(c: City, typeId: string): number {
    const t = TYPES[typeId];
    return Math.round(this.cost(typeId) * (t.mounted && c.buildings.includes("stable") ? 0.8 : 1));
  }

  // ------------------------------------------------------------------ movement

  moveCost(from: Hex, to: Hex): number {
    let c = MOVE_COST[to.terrain];
    if (to.river && (!from.river || from.riverId !== to.riverId)) c += 1;
    return c;
  }

  /** Every hex this army can reach this turn, with the cost to get there and where from. */
  reach(a: Army): Map<number, { cost: number; from: number }> {
    const out = new Map<number, { cost: number; from: number }>();
    out.set(a.hex, { cost: 0, from: -1 });
    const open: number[] = [a.hex];
    while (open.length) {
      open.sort((x, y) => out.get(x)!.cost - out.get(y)!.cost);
      const cur = open.shift()!;
      const cc = out.get(cur)!.cost;
      const h = this.hexes[cur];
      // Stop in any hex next to a hostile army (it must be fought or gone round).
      if (cur !== a.hex && this.enemyNear(a.owner, cur)) continue;
      for (const [c, r] of neighbours(h.col, h.row)) {
        const n = this.hexes[r * COLS + c];
        if (n.terrain === "sea") continue;
        const cost = cc + this.moveCost(h, n);
        if (cost > a.moves + 0.001 && !(cc === 0 && a.moves > 0)) continue;
        // Occupied: hostile armies and cities are targets (end there), others block.
        const city = this.cityAt(n.i);
        const occ = this.armiesAt(n.i).filter((o) => o.id !== a.id);
        const hostile = occ.some((o) => this.hostile(a.owner, o.owner)) || (city && this.hostile(a.owner, city.owner));
        const blocked = occ.some((o) => !this.friendly(a.owner, o.owner) && !this.hostile(a.owner, o.owner)) || (city && !this.friendly(a.owner, city.owner) && !this.hostile(a.owner, city.owner));
        if (blocked) continue;
        const prev = out.get(n.i);
        if (!prev || prev.cost > cost) {
          out.set(n.i, { cost, from: cur });
          if (!hostile) open.push(n.i);
        }
      }
    }
    return out;
  }

  private enemyNear(f: FactionId, hex: number): boolean {
    const h = this.hexes[hex];
    for (const [c, r] of neighbours(h.col, h.row)) {
      const i = r * COLS + c;
      if (this.armies.some((o) => o.hex === i && this.hostile(f, o.owner))) return true;
    }
    return false;
  }

  /** A* over the whole map, ignoring this turn's budget (for the AI's long marches). */
  path(a: Army, goal: number): number[] | null {
    const g = new Map<number, number>([[a.hex, 0]]);
    const from = new Map<number, number>();
    const open = new Set<number>([a.hex]);
    const H = (i: number) => hexDist(this.hexes[i], this.hexes[goal]);
    let guard = 0;
    while (open.size && guard++ < 6000) {
      let cur = -1;
      let bf = Infinity;
      for (const i of open) {
        const f = g.get(i)! + H(i);
        if (f < bf) {
          bf = f;
          cur = i;
        }
      }
      if (cur === goal) {
        const p = [cur];
        while (from.has(p[0])) p.unshift(from.get(p[0])!);
        return p;
      }
      open.delete(cur);
      const h = this.hexes[cur];
      for (const [c, r] of neighbours(h.col, h.row)) {
        const n = this.hexes[r * COLS + c];
        if (n.terrain === "sea") continue;
        const city = this.cityAt(n.i);
        if (n.i !== goal && city && !this.friendly(a.owner, city.owner)) continue;
        const cost = g.get(cur)! + this.moveCost(h, n);
        if (cost < (g.get(n.i) ?? Infinity)) {
          g.set(n.i, cost);
          from.set(n.i, cur);
          open.add(n.i);
        }
      }
    }
    return null;
  }

  maxMoves(a: Army): number {
    return a.units.every((u) => TYPES[u.type].mounted) ? 6 : 4;
  }

  /**
   * Move an army toward `to` (within reach): it steps hex by hex; walking into a hostile army or
   * city means battle. Returns once it has stopped.
   */
  async move(a: Army, to: number): Promise<void> {
    const r = this.reach(a);
    if (!r.has(to) || to === a.hex) return;
    const steps: number[] = [];
    for (let k = to; k !== a.hex; k = r.get(k)!.from) steps.unshift(k);
    for (const s of steps) {
      if (!this.armies.includes(a)) return;
      const city = this.cityAt(s);
      const foes = this.armiesAt(s).filter((o) => this.hostile(a.owner, o.owner));
      if (foes.length || (city && this.hostile(a.owner, city.owner))) {
        a.moves = 0;
        await this.attack(a, s);
        return;
      }
      a.moves = Math.max(0, a.moves - this.moveCost(this.hexes[a.hex], this.hexes[s]));
      a.hex = s;
      a.siege = -1;
      a.siegeTurns = 0;
      // Merge into a friendly army already there.
      const friend = this.armiesAt(s).find((o) => o.id !== a.id && o.owner === a.owner);
      if (friend && friend.units.length + a.units.length <= 16) {
        friend.units.push(...a.units);
        friend.moves = Math.min(friend.moves, a.moves);
        this.armies = this.armies.filter((o) => o !== a);
        return;
      }
    }
  }

  /** Stand before a city's walls: it's cut off; after a turn the rams are built, after two the mound. */
  besiege(a: Army, cityId: number): void {
    const c = this.cities[cityId];
    a.siege = cityId;
    a.moves = 0;
    this.say(`${a.general}의 군대가 ${josa(c.name, "을")} 에워쌌다.`, a.owner === this.player ? "gold" : c.owner === this.player ? "bad" : "");
  }

  // ------------------------------------------------------------------ battle

  async attack(a: Army, hex: number): Promise<void> {
    const city = this.cityAt(hex);
    const defArmies = this.armiesAt(hex).filter((o) => this.hostile(a.owner, o.owner));
    const defender = defArmies[0] ?? null;
    const defFaction = defender?.owner ?? city!.owner;
    const cityUnits = city && this.hostile(a.owner, city.owner) ? city.garrison : [];
    const setup: BattleSetup = {
      attacker: { faction: a.owner, army: a, city: null, units: a.units },
      defender: { faction: defFaction, army: defender, city: city && this.hostile(a.owner, city.owner) ? city : null, units: [...(defender?.units ?? []), ...cityUnits] },
      hex: this.hexes[hex],
      siege: !!(city && city.walls > 0 && this.hostile(a.owner, city.owner)),
      rams: a.siege === city?.id && a.siegeTurns >= 1 ? 2 : 0,
      mound: a.siege === city?.id && a.siegeTurns >= 2,
    };
    if (!setup.defender.units.length && city) {
      // An empty city opens its gates.
      this.capture(city, a);
      return;
    }
    const out = await this.onBattle(setup);
    this.afterBattle(setup, out);
  }

  /** The attacker's chance of winning, and both sides' strength. */
  odds(s: BattleSetup): { p: number; pa: number; pd: number } {
    const pa = s.attacker.units.reduce((t, u) => t + this.unitPower(s.attacker.faction, u), 0) * 1.1 * (1 + s.rams * 0.06 + (s.mound ? 0.1 : 0));
    let pd = s.defender.units.reduce((t, u) => t + this.unitPower(s.defender.faction, u), 0) * (s.defender.army ? 1.1 : 1);
    // Townsfolk on the walls.
    if (s.defender.city) pd += s.defender.city.pop * 110 + s.defender.city.walls * 120;
    const terr: Record<Terrain, number> = { sea: 1, plains: 1, steppe: 1, hills: 1.15, forest: 1.12, mountains: 1.3, marsh: 1.1 };
    pd *= terr[s.hex.terrain] * (s.hex.river ? 1.1 : 1);
    if (s.siege && s.defender.city) pd *= this.wallBonus(s.defender.city);
    const r = pa / (pa + pd || 1);
    return { p: r ** 3 / (r ** 3 + (1 - r) ** 3), pa, pd };
  }

  /** The quick reckoning, for battles nobody watches. */
  autoResolve(s: BattleSetup): BattleOutcome {
    const { p, pa, pd } = this.odds(s);
    const attackerWon = Math.random() < p;
    const [pw, pl] = attackerWon ? [pa, pd] : [pd, pa];
    const lw = Math.max(0.05, Math.min(0.6, 0.06 + 0.4 * (pl / pw) ** 1.3));
    const ll = Math.max(0.35, Math.min(0.92, 0.45 + 0.25 * (pw / pl - 1)));
    const hit = (units: CUnit[], k: number) => {
      for (const u of units) u.men = Math.max(0, Math.round(u.men * (1 - k * (0.7 + Math.random() * 0.6))));
    };
    hit(attackerWon ? s.attacker.units : s.defender.units, lw);
    hit(attackerWon ? s.defender.units : s.attacker.units, ll);
    return { attackerWon };
  }

  private afterBattle(s: BattleSetup, out: BattleOutcome): void {
    const clean = (units: CUnit[]) => units.filter((u) => u.men >= Math.max(6, u.max * 0.08));
    const A = s.attacker;
    const D = s.defender;
    for (const u of [...A.units, ...D.units]) u.xp = Math.min(10, u.xp + 1);
    if (A.army) A.army.units = clean(A.army.units);
    if (D.army) D.army.units = clean(D.army.units);
    if (D.city) D.city.garrison = clean(D.city.garrison);
    const where = D.city ? D.city.name : `${s.hex.terrain === "mountains" ? "산악" : s.hex.river ? "강가" : "들판"}`;
    const an = this.name(A.faction);
    const dn = this.name(D.faction);
    const mine = A.faction === this.player || D.faction === this.player;
    const good = (A.faction === this.player) === out.attackerWon;
    this.say(out.attackerWon ? `${where} 싸움: ${josa(an, "이")} ${josa(dn, "을")} 꺾었다.` : `${where} 싸움: ${josa(dn, "이")} ${josa(an, "을")} 막아냈다.`, mine ? (good ? "gold" : "bad") : "");
    this.attitude(A.faction, D.faction, -8);
    if (out.attackerWon) {
      // The losing army falls back, or is scattered if it can't.
      if (D.army) this.retreat(D.army, A.faction);
      if (D.city && A.army) {
        if (D.city.garrison.length === 0 || s.siege) {
          D.city.garrison = [];
          this.capture(D.city, A.army);
        }
      }
    } else if (A.army) {
      this.retreat(A.army, D.faction);
    }
    for (const a of [A.army, D.army]) if (a && a.units.length === 0) this.destroy(a);
  }

  private retreat(a: Army, from: FactionId): void {
    if (!this.armies.includes(a)) return;
    if (a.units.length === 0) return this.destroy(a);
    const h = this.hexes[a.hex];
    let best = -1;
    let bs = -Infinity;
    for (const [c, r] of neighbours(h.col, h.row)) {
      const n = this.hexes[r * COLS + c];
      if (n.terrain === "sea") continue;
      const city = this.cityAt(n.i);
      if (city && !this.friendly(a.owner, city.owner)) continue;
      if (this.armiesAt(n.i).some((o) => o.owner !== a.owner)) continue;
      let score = Math.random() * 0.2;
      if (this.owner[n.i] === a.owner) score += 1;
      if (this.enemyNear(a.owner, n.i)) score -= 1;
      if (city) score += 0.5;
      if (score > bs) {
        bs = score;
        best = n.i;
      }
    }
    if (best < 0) {
      this.say(`${a.general}의 군대가 퇴로가 끊겨 흩어졌다.`, a.owner === this.player ? "bad" : "");
      this.destroy(a);
      return;
    }
    a.hex = best;
    a.moves = 0;
    a.siege = -1;
    a.siegeTurns = 0;
    void from;
  }

  private destroy(a: Army): void {
    this.armies = this.armies.filter((o) => o !== a);
  }

  capture(c: City, by: Army): void {
    const old = c.owner;
    c.owner = by.owner;
    c.besieged = 0;
    c.pop = Math.max(1, c.pop - 1);
    c.build = null;
    c.recruit = null;
    c.buildings = c.buildings.filter(() => Math.random() < 0.7);
    if (c.capital) {
      c.capital = false;
      const next = this.cities.filter((x) => x.owner === old).sort((x, y) => y.pop - x.pop)[0];
      if (next) {
        next.capital = true;
        this.say(`${josa(this.name(old), "이")} 도읍을 ${josa(next.name, "로")} 옮긴다.`, "event");
      }
    }
    by.hex = c.hex;
    by.siege = -1;
    // Anyone besieging it for the old owner stops.
    for (const a of this.armies) if (a.siege === c.id) a.siege = -1;
    const mine = by.owner === this.player;
    this.say(`${josa(c.name, "이")} ${this.name(by.owner)}의 손에 들어갔다!`, mine ? "gold" : old === this.player ? "bad" : "");
    this.recomputeTerritory();
    if (!this.cities.some((x) => x.owner === old)) {
      this.powers[old].alive = false;
      this.say(`${josa(this.name(old), "이")} 멸망했다.`, "event");
      for (const a of this.armies.filter((x) => x.owner === old)) this.destroy(a);
    }
    this.checkEnd();
  }

  // ------------------------------------------------------------------ the year

  /** The player has finished: everyone else moves, then the year turns. */
  /** Tests: let the computer play 고구려 too. */
  autoPlayer = false;
  async endTurn(): Promise<void> {
    if (this.over) return;
    for (const f of FACTION_IDS) {
      if ((f === this.player && !this.autoPlayer) || !this.powers[f].alive) continue;
      await this.aiTurn(f);
      if (this.over) return;
    }
    await this.yearEnd();
  }

  private async yearEnd(): Promise<void> {
    // Sieges: a city ringed by hostile armies earns nothing and starves; relief lifts it.
    for (const c of this.cities) {
      const ring = this.armies.filter((a) => a.siege === c.id && this.hostile(a.owner, c.owner));
      if (ring.length) {
        c.besieged++;
        for (const a of ring) a.siegeTurns++;
        const store = 1 + c.walls * 0.5 + (c.buildings.includes("farm") ? 1 : 0);
        if (c.besieged > store) {
          for (const u of c.garrison) u.men = Math.round(u.men * 0.82);
          c.garrison = c.garrison.filter((u) => u.men > u.max * 0.08);
          if (c.owner === this.player) this.say(`${c.name}의 양식이 떨어져 간다.`, "bad");
          if (!c.garrison.length) {
            this.say(`굶주린 ${josa(c.name, "이")} 성문을 열었다.`, "event");
            this.capture(c, ring[0]);
          }
        }
      } else c.besieged = 0;
    }
    for (const f of FACTION_IDS) {
      const p = this.powers[f];
      if (!p.alive) continue;
      const inc = this.income(f);
      p.gold += inc.gold - inc.upkeep;
      p.lore += inc.lore;
      if (p.gold < 0) {
        // Unpaid soldiers go home.
        const a = this.armies.filter((x) => x.owner === f && !x.expedition).sort((x, y) => y.units.length - x.units.length)[0];
        if (a && a.units.length) {
          const u = a.units.pop()!;
          if (f === this.player) this.say(`녹봉을 주지 못해 ${josa(u.name, "이")} 흩어졌다.`, "bad");
          if (!a.units.length) this.destroy(a);
        }
        p.gold = Math.max(p.gold, -50);
      }
      // Learning.
      if (f === this.player && p.researching) {
        const t = TECHS.find((x) => x.id === p.researching)!;
        if (p.lore >= t.cost) {
          p.lore -= t.cost;
          p.techs.push(t.id);
          p.researching = null;
          this.say(`문물: ${josa(t.name, "을")} 이루었다. ${t.desc}`, "gold");
          if (t.id === "jangseong") for (const c of this.cities) if (c.owner === f && this.hexes[c.hex].lon < 124.5) c.walls = Math.min(4, c.walls + 1);
        }
      }
      for (const o of FACTION_IDS) if (p.rel[o] === "war") p.warTurns[o]++;
    }
    // Cities: grow, build, raise.
    for (const c of this.cities) {
      const p = this.powers[c.owner];
      const h = this.hexes[c.hex];
      let food = c.pop * 1.1 + (c.buildings.includes("farm") ? 3 : 0) + (h.river ? 1 : 0) + (h.terrain === "plains" ? 1 : 0) - c.pop * 0.9;
      if (p.techs.includes("dunjeon")) food *= 1.25;
      if (c.buildings.includes("temple")) food *= 1.5;
      if (p.techs.includes("buddhism")) food *= 1.3;
      if (c.besieged) food = 0;
      c.food += Math.max(0.3, food);
      if (c.food >= 4 + c.pop * 1.6 && c.pop < 12) {
        c.pop++;
        c.food = 0;
        if (c.owner === this.player && c.pop % 3 === 0) this.say(`${c.name}의 인구가 늘어 ${c.pop}만 호가 되었다.`);
      }
      if (c.build) {
        c.build.left--;
        if (c.build.left <= 0) {
          const b = BUILDINGS.find((x) => x.id === c.build!.id)!;
          if (b.id === "walls") c.walls = Math.min(p.techs.includes("sanseong") ? 4 : 3, c.walls + 1);
          else c.buildings.push(b.id);
          if (c.owner === this.player) this.say(`${c.name}: ${b.name} 완공.`);
          c.build = null;
        }
      }
      if (c.recruit) {
        c.recruit.left--;
        if (c.recruit.left <= 0) {
          const u = this.unit(c.owner, c.recruit.type);
          if (c.owner === "goguryeo" && c.buildings.includes("barracks")) u.xp = 1;
          c.garrison.push(u);
          if (c.owner === this.player) this.say(`${c.name}: ${u.name} 징집 완료.`);
          c.recruit = null;
        }
      }
      // Garrisons heal slowly.
      if (!c.besieged) for (const u of c.garrison) u.men = Math.min(u.max, Math.round(u.men + u.max * 0.12));
    }
    // Armies: heal at home, wither abroad; expeditions run out of bread.
    for (const a of [...this.armies]) {
      const terr = this.owner[a.hex];
      const home = terr !== null && this.friendly(a.owner, terr);
      const nearCity = this.cities.some((c) => c.owner === a.owner && hexDist(this.hexes[c.hex], this.hexes[a.hex]) <= 1);
      let loss = 0;
      if (home) {
        if (nearCity) for (const u of a.units) u.men = Math.min(u.max, Math.round(u.men + u.max * 0.15));
      } else {
        loss = 0.04;
        if (terr && this.powers[terr].techs.includes("cheongya") && this.hostile(a.owner, terr)) loss *= 2.2;
        if (this.hexes[a.hex].terrain === "marsh") loss += 0.06;
      }
      if (a.expedition) {
        a.supply = (a.supply ?? 3) - 1;
        if ((a.supply ?? 0) < 0) loss += 0.14;
        else loss *= 0.5;
      }
      if (loss) for (const u of a.units) u.men = Math.round(u.men * (1 - loss * (0.7 + Math.random() * 0.6)));
      a.units = a.units.filter((u) => u.men > u.max * 0.08);
      if (!a.units.length) {
        this.say(`${a.general}의 군대가 굶주림과 역병으로 무너졌다.`, a.owner === this.player ? "bad" : "");
        this.destroy(a);
        continue;
      }
      a.moves = this.maxMoves(a);
      // Sieges keep only while the army still stands at the walls.
      if (a.siege >= 0 && hexDist(this.hexes[a.hex], this.hexes[this.cities[a.siege].hex]) > 1) a.siege = -1;
    }
    this.diplomacyDrift();
    this.year++;
    this.recomputeTerritory();
    await this.history();
    this.checkEnd();
  }

  private diplomacyDrift(): void {
    for (const a of FACTION_IDS)
      for (const b of FACTION_IDS) {
        if (a >= b) continue;
        const pa = this.powers[a];
        const pb = this.powers[b];
        if (!pa.alive || !pb.alive) continue;
        // Attitudes drift back toward zero; common enemies warm them.
        pa.attitude[b] *= 0.92;
        pb.attitude[a] *= 0.92;
        for (const c of FACTION_IDS) if (pa.rel[c] === "war" && pb.rel[c] === "war") this.attitude(a, b, 2);
      }
    // The computer powers decide on war and peace (not with the player; that's asked for).
    for (const a of FACTION_IDS) {
      if (a === this.player || !this.powers[a].alive) continue;
      for (const b of FACTION_IDS) {
        if (b === a || !this.powers[b].alive) continue;
        const r = this.rel(a, b);
        const ratio = this.totalPower(a) / Math.max(1, this.totalPower(b));
        const att = this.powers[a].attitude[b];
        if (r === "war" && this.powers[a].warTurns[b] >= 3 && (ratio < 0.8 || Math.random() < 0.12) && b !== this.player) {
          this.setRel(a, b, "peace");
          this.say(`${josa(this.name(a), "과")} ${josa(this.name(b), "이")} 화친했다.`);
        } else if (r === "peace" && att < -35 && ratio > 1.4 && Math.random() < 0.18 && this.borders(a, b)) {
          this.declare(a, b);
        }
      }
    }
  }

  borders(a: FactionId, b: FactionId): boolean {
    for (const ca of this.cities)
      if (ca.owner === a) for (const cb of this.cities) if (cb.owner === b && hexDist(this.hexes[ca.hex], this.hexes[cb.hex]) <= 8) return true;
    return false;
  }

  declare(a: FactionId, b: FactionId): void {
    if (this.rel(a, b) === "war") return;
    this.setRel(a, b, "war");
    this.attitude(a, b, -30);
    this.say(`${josa(this.name(a), "이")} ${this.name(b)}에 선전포고했다!`, b === this.player ? "bad" : a === this.player ? "gold" : "event");
    // Allies and overlords are drawn in.
    for (const o of FACTION_IDS) {
      if (o === a || o === b || !this.powers[o].alive) continue;
      const rb = this.rel(o, b);
      if ((rb === "ally" || rb === "vassal") && this.rel(o, a) !== "war") {
        this.setRel(o, a, "war");
        this.say(`${josa(this.name(o), "이")} 맹약에 따라 ${josa(this.name(a), "과")} 싸운다.`, "event");
      }
    }
  }

  /** The chance the other side takes a peace offer (shown to the player before asking). */
  peaceChance(f: FactionId): number {
    const ratio = this.totalPower(f) / Math.max(1, this.totalPower(this.player));
    const turns = this.powers[f].warTurns[this.player];
    const expedition = this.armies.some((a) => a.owner === f && a.expedition);
    let p = 0.15 + turns * 0.08 + (1 - ratio) * 0.35 + this.powers[f].attitude[this.player] / 200;
    if (expedition) p -= 0.3;
    return Math.max(0.02, Math.min(0.95, p));
  }
  offerPeace(f: FactionId): boolean {
    const ok = Math.random() < this.peaceChance(f);
    if (ok) {
      this.setRel(this.player, f, "peace");
      this.say(`${josa(this.name(f), "과")} 화친을 맺었다.`, "gold");
    } else this.say(`${josa(this.name(f), "이")} 화친을 거절했다.`, "bad");
    this.attitude(this.player, f, ok ? 10 : -3);
    return ok;
  }
  allianceChance(f: FactionId): number {
    const att = this.powers[f].attitude[this.player];
    const common = FACTION_IDS.some((c) => this.rel(f, c) === "war" && this.rel(this.player, c) === "war");
    return Math.max(0, Math.min(0.9, (att + (common ? 35 : 0)) / 100));
  }
  offerAlliance(f: FactionId): boolean {
    const ok = Math.random() < this.allianceChance(f);
    if (ok) {
      this.setRel(this.player, f, "ally");
      this.say(`${josa(this.name(f), "과")} 동맹을 맺었다.`, "gold");
    } else this.say(`${josa(this.name(f), "이")} 동맹을 거절했다.`, "bad");
    return ok;
  }
  vassalChance(f: FactionId): number {
    const ratio = this.totalPower(f) / Math.max(1, this.totalPower(this.player));
    return Math.max(0, Math.min(0.9, (0.45 - ratio) * 2 + (this.rel(this.player, f) === "war" ? 0.1 : 0)));
  }
  demandVassal(f: FactionId): boolean {
    const ok = Math.random() < this.vassalChance(f);
    if (ok) {
      this.setRel(f, this.player, "vassal");
      this.say(`${josa(this.name(f), "이")} 고구려에 신하를 칭하고 조공을 바친다.`, "gold");
    } else {
      this.say(`${josa(this.name(f), "이")} 조공 요구를 물리쳤다.`, "bad");
      this.attitude(this.player, f, -15);
    }
    return ok;
  }
  gift(f: FactionId): void {
    const p = this.powers[this.player];
    if (p.gold < 50) return;
    p.gold -= 50;
    this.attitude(this.player, f, 18);
    this.say(`${this.name(f)}에 예물을 보냈다.`);
  }

  // ------------------------------------------------------------------ the computer powers

  async aiTurn(f: FactionId): Promise<void> {
    const p = this.powers[f];
    const atWar = FACTION_IDS.filter((o) => this.hostile(f, o) && this.powers[o].alive);
    // Cities: build and raise.
    for (const c of this.cities) {
      if (c.owner !== f) continue;
      if (!c.recruit && (atWar.length || c.garrison.length < 2) && c.garrison.length < 6) {
        const opts = FACTIONS[f].roster.filter((t) => t !== "suiRam" && this.canRecruit(c, t).ok);
        if (opts.length && p.gold > 60) {
          const t = opts[Math.floor(Math.random() * opts.length)];
          p.gold -= this.recruitCost(c, t);
          c.recruit = { type: t, left: 1 };
        }
      }
      if (!c.build && p.gold > 120) {
        const want = ["farm", "market", "barracks", "stable", "walls", "temple", "school"].find((b) => (b === "walls" ? c.walls < 3 && atWar.length > 0 : !c.buildings.includes(b)));
        const b = BUILDINGS.find((x) => x.id === want);
        if (b && p.gold >= b.cost + 40) {
          p.gold -= b.cost;
          c.build = { id: b.id, left: b.turns };
        }
      }
      // A full garrison sends out a field army.
      if (atWar.length && c.garrison.length >= 5 && !this.armiesAt(c.hex).some((a) => a.owner === f)) {
        const n = c.garrison.length - 2;
        const a: Army = { id: this.nextId++, owner: f, hex: c.hex, units: c.garrison.splice(0, n), general: this.pickGeneral(f), moves: 0, siege: -1, siegeTurns: 0 };
        this.armies.push(a);
      }
    }
    // Armies.
    for (const a of this.armies.filter((x) => x.owner === f)) {
      if (!this.armies.includes(a)) continue;
      await this.aiArmy(a);
      if (this.over) return;
    }
  }

  private async aiArmy(a: Army): Promise<void> {
    const f = a.owner;
    const me = this.armyPower(a);
    // A spent expedition goes home.
    if (a.expedition && (a.supply ?? 0) < 0) {
      const home = this.nearestCity(a, (c) => c.owner === f);
      if (home) await this.march(a, home.hex);
      if (this.armies.includes(a) && home && a.hex === home.hex) {
        home.garrison.push(...a.units.slice(0, Math.max(0, 6 - home.garrison.length)));
        this.destroy(a);
      }
      return;
    }
    // Besieging: assault once the works are ready or we're strong enough.
    if (a.siege >= 0) {
      const c = this.cities[a.siege];
      if (c.owner === f || !this.hostile(f, c.owner)) {
        a.siege = -1;
      } else {
        const def = this.cityPower(c) * this.wallBonus(c);
        if (me > def * 1.6 || a.siegeTurns >= 2 || (a.expedition && (a.supply ?? 0) <= 0)) await this.attack(a, c.hex);
        return;
      }
    }
    // Pick a target: a weaker hostile army nearby, else a hostile city; else go home.
    let goal = -1;
    let bestScore = -Infinity;
    for (const o of this.armies) {
      if (!this.hostile(f, o.owner)) continue;
      const d = hexDist(this.hexes[a.hex], this.hexes[o.hex]);
      if (d > 7) continue;
      const ratio = me / Math.max(1, this.armyPower(o));
      if (ratio < 1.15) continue;
      const s = ratio - d * 0.25;
      if (s > bestScore) {
        bestScore = s;
        goal = o.hex;
      }
    }
    if (goal < 0) {
      const tc = a.target !== undefined ? this.cities[a.target] : null;
      if (tc && this.hostile(f, tc.owner)) goal = tc.hex;
      else {
        let bs = -Infinity;
        for (const c of this.cities) {
          if (!this.hostile(f, c.owner)) continue;
          const d = hexDist(this.hexes[a.hex], this.hexes[c.hex]);
          if (d > 12) continue;
          const def = this.cityPower(c) * this.wallBonus(c) + this.armiesAt(c.hex).reduce((s, o) => s + this.armyPower(o), 0);
          const s = (me / Math.max(1, def)) * 2 - d * 0.18 + (c.capital ? 0.4 : 0);
          if (s > bs) {
            bs = s;
            goal = c.hex;
          }
        }
      }
    }
    if (goal < 0) {
      // Nothing to do: stand at home.
      const home = this.nearestCity(a, (c) => c.owner === f);
      if (home && a.hex !== home.hex) await this.march(a, home.hex);
      return;
    }
    // Threatened: an enemy far stronger next to us — fall back home.
    const threat = this.armies.find((o) => this.hostile(f, o.owner) && hexDist(this.hexes[o.hex], this.hexes[a.hex]) <= 2 && this.armyPower(o) > me * 1.5);
    if (threat && !a.expedition) {
      const home = this.nearestCity(a, (c) => c.owner === f);
      if (home) {
        await this.march(a, home.hex);
        return;
      }
    }
    const city = this.cityAt(goal);
    if (city && this.hostile(f, city.owner) && hexDist(this.hexes[a.hex], this.hexes[goal]) <= 1) {
      const def = this.cityPower(city) * this.wallBonus(city) + this.armiesAt(goal).reduce((s, o) => s + this.armyPower(o), 0);
      if (city.walls === 0 || me > def * 1.6 || city.garrison.length === 0) await this.attack(a, goal);
      else this.besiege(a, city.id);
      return;
    }
    await this.march(a, goal);
    // Arrived next to a hostile city: sit down before it.
    if (this.armies.includes(a) && a.moves >= 0) {
      const c2 = this.cityAt(goal);
      if (c2 && this.hostile(f, c2.owner) && hexDist(this.hexes[a.hex], this.hexes[goal]) <= 1 && a.siege < 0) {
        const def = this.cityPower(c2) * this.wallBonus(c2);
        if (me > def * 1.6 && a.moves > 0) await this.attack(a, goal);
        else this.besiege(a, c2.id);
      }
    }
  }

  private nearestCity(a: Army, pred: (c: City) => boolean): City | null {
    let best: City | null = null;
    let bd = Infinity;
    for (const c of this.cities) {
      if (!pred(c)) continue;
      const d = hexDist(this.hexes[a.hex], this.hexes[c.hex]);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Walk along the A* path as far as this turn's moves go (a hostile hex on the way means battle). */
  private async march(a: Army, goal: number): Promise<void> {
    const p = this.path(a, goal);
    if (!p || p.length < 2) return;
    const r = this.reach(a);
    let to = -1;
    for (let k = p.length - 1; k >= 1; k--)
      if (r.has(p[k])) {
        to = p[k];
        break;
      }
    // Don't walk into a hostile city by accident on the march (sieges are decided above).
    const c = to >= 0 ? this.cityAt(to) : undefined;
    if (c && this.hostile(a.owner, c.owner) && to !== goal) return;
    if (c && this.hostile(a.owner, c.owner) && c.walls > 0) {
      // Stop short, next to it.
      const k = p.indexOf(to);
      to = k > 0 && r.has(p[k - 1]) ? p[k - 1] : -1;
    }
    if (to >= 0 && to !== a.hex) await this.move(a, to);
  }

  // ------------------------------------------------------------------ history

  async history(): Promise<void> {
    for (const ev of HISTORY) {
      if (this.fired.includes(ev.id) || this.year < ev.year) continue;
      if (ev.cond && !ev.cond(this)) continue;
      this.fired.push(ev.id);
      const e = ev.fire(this);
      if (e) {
        this.say(`${e.title}`, "event");
        await this.onEvent(e);
      }
    }
  }

  /** An invasion column from a city, marching on a target, with a few years' bread. */
  invade(from: string, target: string, types: string[], general: string, supply = 2): Army | null {
    const c = this.cities.find((x) => x.name === from && x.owner === "sui") ?? this.cities.find((x) => x.owner === "sui" && x.capital) ?? this.cities.find((x) => x.owner === "sui");
    const t = this.cities.find((x) => x.name === target);
    if (!c || !t) return null;
    // Stand next to the city if its hex is taken.
    let hex = c.hex;
    if (this.armiesAt(hex).length) {
      const h = this.hexes[hex];
      const free = neighbours(h.col, h.row).map(([cc, r]) => r * COLS + cc).find((i) => this.hexes[i].terrain !== "sea" && !this.armiesAt(i).length && !this.cityAt(i));
      if (free !== undefined) hex = free;
    }
    return this.spawnArmy("sui", hex, types, general, { target: t.id, supply, expedition: true, moves: 0 });
  }

  /** A landing from the sea next to a coastal target. */
  land(target: string, types: string[], general: string, supply = 1): Army | null {
    const t = this.cities.find((x) => x.name === target);
    if (!t) return null;
    const h = this.hexes[t.hex];
    const spots = neighbours(h.col, h.row)
      .map(([c, r]) => this.hexes[r * COLS + c])
      .filter((n) => n.terrain !== "sea" && n.coast && !this.armiesAt(n.i).length && !this.cityAt(n.i));
    const at = spots[0] ?? neighbours(h.col, h.row).map(([c, r]) => this.hexes[r * COLS + c]).find((n) => n.terrain !== "sea" && !this.armiesAt(n.i).length && !this.cityAt(n.i));
    if (!at) return null;
    return this.spawnArmy("sui", at.i, types, general, { target: t.id, supply, expedition: true, moves: 0 });
  }

  checkEnd(): void {
    if (this.over) return;
    const mine = this.cities.filter((c) => c.owner === this.player);
    const pyongyang = this.cities.find((c) => c.name === "평양성")!;
    if (!mine.length || (pyongyang.owner !== this.player && mine.length < 6)) {
      this.over = { win: false, title: "고구려 멸망", text: `${this.year}년, 평양성이 무너지고 사직이 끊어졌다. 그러나 유민들은 고구려의 이름을 잊지 않는다.` };
      return;
    }
    const three = this.cities.filter((c) => c.owner === "baekje" || c.owner === "silla").length === 0;
    if (three) {
      this.over = { win: true, title: "삼한일통(三韓一統)", text: `${this.year}년, 백제와 신라가 모두 고구려의 깃발 아래 들어왔다. 삼족오의 나라가 한반도와 요동을 아우른다.` };
      return;
    }
    const zhuo = this.cities.find((c) => c.name === "탁군")!;
    if (zhuo.owner === this.player) {
      this.over = { win: true, title: "중원 진출", text: `${this.year}년, 고구려의 기병이 탁군에 들어섰다. 요하 너머 중원의 문이 열렸다.` };
      return;
    }
    if (this.year > this.end) {
      this.over = { win: true, title: "고구려 영속", text: `${this.end}년이 지나도 평양성은 굳건하다. 역사는 다른 길로 흘렀다. 성 ${mine.length}개, 인구 ${mine.reduce((s, c) => s + c.pop, 0)}만 호.` };
    }
  }

  // ------------------------------------------------------------------ player actions

  startBuild(c: City, id: string): boolean {
    const b = BUILDINGS.find((x) => x.id === id)!;
    const p = this.powers[c.owner];
    if (c.build || p.gold < b.cost) return false;
    if (id !== "walls" && c.buildings.includes(id)) return false;
    if (id === "walls" && c.walls >= (p.techs.includes("sanseong") ? 4 : 3)) return false;
    p.gold -= b.cost;
    c.build = { id, left: b.turns };
    return true;
  }
  startRecruit(c: City, t: string): boolean {
    if (c.recruit || !this.canRecruit(c, t).ok) return false;
    this.powers[c.owner].gold -= this.recruitCost(c, t);
    c.recruit = { type: t, left: 1 };
    return true;
  }
  /** Send garrison units out as a field army. */
  muster(c: City, ids: number[]): Army | null {
    const units = c.garrison.filter((u) => ids.includes(u.id));
    if (!units.length) return null;
    const there = this.armiesAt(c.hex).find((a) => a.owner === c.owner);
    c.garrison = c.garrison.filter((u) => !ids.includes(u.id));
    if (there && there.units.length + units.length <= 16) {
      there.units.push(...units);
      return there;
    }
    const a: Army = { id: this.nextId++, owner: c.owner, hex: c.hex, units, general: this.pickGeneral(c.owner), moves: 0, siege: -1, siegeTurns: 0 };
    this.armies.push(a);
    return a;
  }
  /** Leave units in the city they stand in. */
  garrison(a: Army, ids: number[]): void {
    const c = this.cityAt(a.hex);
    if (!c || c.owner !== a.owner) return;
    const units = a.units.filter((u) => ids.includes(u.id));
    c.garrison.push(...units);
    a.units = a.units.filter((u) => !ids.includes(u.id));
    if (!a.units.length) this.destroy(a);
  }
  split(a: Army, ids: number[]): Army | null {
    if (ids.length === 0 || ids.length >= a.units.length) return null;
    const units = a.units.filter((u) => ids.includes(u.id));
    a.units = a.units.filter((u) => !ids.includes(u.id));
    const b: Army = { id: this.nextId++, owner: a.owner, hex: a.hex, units, general: this.pickGeneral(a.owner), moves: a.moves, siege: -1, siegeTurns: 0 };
    this.armies.push(b);
    return b;
  }

  // ------------------------------------------------------------------ save

  save(): string {
    const { hexes, onBattle, onEvent, owner, ...rest } = this;
    void hexes;
    void onBattle;
    void onEvent;
    void owner;
    return JSON.stringify({ ...rest, counters: [...this.counters], usedGenerals: [...this.usedGenerals] });
  }
  static load(s: string): Game {
    const d = JSON.parse(s);
    const g = new Game();
    g.hexes = buildHexes();
    const { counters, usedGenerals, ...rest } = d;
    Object.assign(g, rest);
    g.counters = new Map(counters);
    g.usedGenerals = new Set(usedGenerals);
    g.recomputeTerritory();
    return g;
  }
}

// ------------------------------------------------------------------ the chronicle

interface HistoryEvent {
  id: string;
  year: number;
  cond?: (g: Game) => boolean;
  fire: (g: Game) => GameEvent | null;
}

const suiAlive = (g: Game) => g.powers.sui.alive;

export const HISTORY: HistoryEvent[] = [
  {
    id: "598a",
    year: 598,
    fire: () => ({
      title: "598년 · 요서 선제공격",
      text: ["수 문제는 고구려에 신하의 예를 요구하고 있다.", "영양왕은 말갈 군사 1만을 이끌고 먼저 요서를 치려 한다. 먼저 칠 것인가?"],
      choices: [
        {
          label: "요서를 친다",
          hint: "수와 즉시 전쟁 · 말갈 기병이 합류",
          apply: (g) => {
            g.declare("goguryeo", "sui");
            const c = g.cities.find((x) => x.name === "요동성")!;
            g.spawnArmy("goguryeo", c.hex, ["horsebow", "horsebow", "axe", "spear"], "영양왕");
            g.say("말갈 기병 1만이 요서로 달린다.", "gold");
          },
        },
        { label: "때를 기다린다", hint: "수와의 평화를 잠시 유지 · 재화 +80", apply: (g) => (g.powers.goguryeo.gold += 80) },
      ],
    }),
  },
  {
    id: "598",
    year: 599,
    cond: suiAlive,
    fire: (g) => {
      g.declare("sui", "goguryeo");
      g.invade("유성", "요동성", ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiCav"], "한왕 양량", 2);
      g.land("평양성", ["suiSpear", "suiSword", "suiBow", "suiSword"], "주라후", 1);
      return { title: "수 문제의 30만 원정", text: ["수 문제가 한왕 양량에게 30만 군을 주어 요동으로 보냈다.", "수군 총관 주라후는 바다를 건너 평양을 노린다. 장마와 역병이 그들 편이 아니기를."] };
    },
  },
  {
    id: "600",
    year: 600,
    fire: (g) => {
      g.powers.goguryeo.lore += 10;
      return { title: "신집(新集) 5권", text: ["태학박사 이문진이 옛 역사 유기(留記)를 줄여 신집 5권을 엮었다.", "문물 +10"] };
    },
  },
  {
    id: "607",
    year: 607,
    cond: suiAlive,
    fire: (g) => {
      g.attitude("goguryeo", "sui", -30);
      return { title: "돌궐 계민가한의 장막", text: ["고구려 사신이 돌궐 계민가한의 장막에 있다가 수 양제와 마주쳤다.", "양제는 고구려 왕이 친히 입조하지 않으면 치겠다고 했다."] };
    },
  },
  {
    id: "612",
    year: 612,
    cond: suiAlive,
    fire: (g) => {
      g.declare("sui", "goguryeo");
      const big = ["suiSpear", "suiSpear", "suiSpear", "suiSword", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiCav", "suiCav", "suiSpear"];
      g.invade("유성", "요동성", big, "수 양제", 3);
      g.invade("임유관", "신성", big.slice(0, 10), "우문술", 3);
      g.invade("북평", "평양성", ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiBow", "suiCav", "suiCav", "suiSword", "suiSpear"], "우중문", 2);
      g.land("평양성", ["suiSword", "suiSword", "suiSpear", "suiBow", "suiBow"], "내호아", 1);
      return {
        title: "612년 · 수 양제 113만 대군",
        text: ["수 양제가 113만 3,800명, 스스로 200만이라 일컫는 대군을 일으켰다. 행렬이 960리에 이어졌다.", "요동성으로, 신성으로, 그리고 별동대 30만이 곧장 평양으로 온다. 내호아의 수군이 대동강을 거슬러 오른다.", "성을 지키고, 들을 비우고, 저들이 굶주려 돌아설 때를 노려라."],
      };
    },
  },
  {
    id: "613",
    year: 613,
    cond: (g) => suiAlive(g) && g.rel("sui", "goguryeo") === "war",
    fire: (g) => {
      g.invade("유성", "요동성", ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiCav"], "수 양제", 2);
      return { title: "613년 · 수의 2차 원정", text: ["수 양제가 다시 요동성을 친다. 그러나 수 안에서 양현감이 반란을 일으켰다는 소문이 돈다."] };
    },
  },
  {
    id: "614",
    year: 614,
    cond: (g) => suiAlive(g) && g.rel("sui", "goguryeo") === "war",
    fire: (g) => {
      g.invade("임유관", "비사성", ["suiSpear", "suiSword", "suiSword", "suiBow", "suiCav"], "내호아", 2);
      return { title: "614년 · 수의 3차 원정", text: ["지친 수가 세 번째로 군을 보낸다. 백성들이 도망쳐 도적이 된다."] };
    },
  },
  {
    id: "618",
    year: 618,
    cond: suiAlive,
    fire: (g) => {
      g.tang = true;
      for (const a of g.armies.filter((x) => x.owner === "sui")) for (const u of a.units) u.men = Math.round(u.men * 0.5);
      for (const c of g.cities.filter((x) => x.owner === "sui")) c.garrison = c.garrison.slice(0, 2);
      if (g.rel("sui", "goguryeo") === "war") g.setRel("sui", "goguryeo", "peace");
      g.powers.sui.gold = 300;
      return { title: "618년 · 수 멸망, 당 건국", text: ["고구려 원정에 나라를 기울인 수가 무너졌다. 이연이 장안에서 당을 세웠다.", "당은 우선 안을 다스리며 고구려와 화친한다. 그러나 그들의 눈도 요동을 향할 것이다."] };
    },
  },
  {
    id: "631",
    year: 631,
    fire: (g) => {
      const p = g.powers.goguryeo;
      if (!p.techs.includes("jangseong")) p.lore += 12;
      return { title: "631년 · 천리장성", text: ["당이 경관(京觀)을 헐었다. 고구려는 부여성에서 비사성까지 천리장성을 쌓기 시작한다.", "문물 +12 (문물 '천리장성'을 이루면 요하 방면 성벽이 오른다)"] };
    },
  },
  {
    id: "642",
    year: 642,
    fire: () => ({
      title: "642년 · 연개소문의 정변",
      text: ["동부대인 연개소문이 영류왕과 대신 180여 명을 죽이고 보장왕을 세웠다. 스스로 대막리지가 되었다.", "그를 따를 것인가?"],
      choices: [
        {
          label: "대막리지를 따른다",
          hint: "모든 군 경험 +2 · 당과 관계 악화 · 재화 -60",
          apply: (g) => {
            for (const a of g.armies) if (a.owner === "goguryeo") for (const u of a.units) u.xp += 2;
            g.attitude("goguryeo", "sui", -40);
            g.powers.goguryeo.gold -= 60;
          },
        },
        {
          label: "귀족 회의로 견제한다",
          hint: "재화 +120 · 당과의 관계 조금 개선 · 한 성이 이반",
          apply: (g) => {
            g.powers.goguryeo.gold += 120;
            g.attitude("goguryeo", "sui", 15);
            const c = g.cities.filter((x) => x.owner === "goguryeo" && !x.capital).sort((a, b) => a.pop - b.pop)[0];
            if (c) {
              c.owner = "malgal";
              g.say(`${c.name}의 성주가 따르지 않고 말갈에 붙었다.`, "bad");
              g.recomputeTerritory();
            }
          },
        },
      ],
    }),
  },
  {
    id: "642b",
    year: 642,
    cond: (g) => g.powers.baekje.alive && g.powers.silla.alive,
    fire: (g) => {
      const d = g.cities.find((x) => x.name === "대야성")!;
      if (d.owner === "silla") {
        d.owner = "baekje";
        g.recomputeTerritory();
      }
      g.attitude("goguryeo", "baekje", 40);
      g.attitude("silla", "sui", 40);
      return { title: "642년 · 대야성 함락", text: ["백제 의자왕의 장군 윤충이 신라의 대야성을 떨어뜨렸다. 성주 품석이 죽었다.", "김춘추가 평양에 와 도움을 청했다가 거절당하고, 당으로 간다. 백제는 고구려와 손잡고 싶어 한다."] };
    },
  },
  {
    id: "645",
    year: 645,
    cond: (g) => g.tang && g.powers.sui.alive,
    fire: (g) => {
      g.declare("sui", "goguryeo");
      const big = ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiCav", "suiCav", "suiSpear", "suiBow"];
      g.invade("유성", "요동성", big, "당 태종 이세민", 3);
      g.invade("회원진", "신성", big.slice(0, 9), "이세적", 3);
      g.land("비사성", ["suiSword", "suiSword", "suiSpear", "suiBow", "suiCav"], "장량", 2);
      return {
        title: "645년 · 당 태종의 친정",
        text: ["당 태종 이세민이 몸소 대군을 이끌고 요하를 건넌다. 이세적은 신성으로, 장량의 수군은 비사성으로.", "요동성과 백암성이 위태롭다. 안시성의 양만춘은 성문을 걸어 잠갔다."],
      };
    },
  },
  {
    id: "647",
    year: 647,
    cond: (g) => g.tang && g.rel("sui", "goguryeo") === "war",
    fire: (g) => {
      g.invade("유성", "신성", ["suiCav", "suiCav", "suiSword", "suiBow"], "이세적", 1);
      return { title: "647년 · 당의 소모전", text: ["당은 큰 싸움 대신 해마다 작은 군대를 보내 고구려를 지치게 하려 한다."] };
    },
  },
  {
    id: "648",
    year: 648,
    cond: (g) => g.tang && g.powers.silla.alive,
    fire: (g) => {
      if (g.rel("silla", "sui") !== "war") g.setRel("silla", "sui", "ally");
      return { title: "648년 · 나당 동맹", text: ["김춘추가 장안에서 당 태종과 맹약을 맺었다. 백제와 고구려를 함께 치자는 약속이다."] };
    },
  },
  {
    id: "660",
    year: 660,
    cond: (g) => g.tang && g.powers.baekje.alive,
    fire: (g) => {
      g.declare("sui", "baekje");
      if (g.powers.silla.alive) g.declare("silla", "baekje");
      g.land("사비성", ["suiSpear", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiSpear", "suiSword"], "소정방", 2);
      return { title: "660년 · 나당 연합군", text: ["소정방의 당군 13만이 바다를 건너 백제로, 김유신의 신라군 5만이 황산벌로 향한다.", "백제가 무너지면 다음은 고구려다. 백제를 도울 것인가?"] };
    },
  },
  {
    id: "661",
    year: 661,
    cond: (g) => g.tang && g.powers.sui.alive,
    fire: (g) => {
      g.declare("sui", "goguryeo");
      g.land("평양성", ["suiSpear", "suiSword", "suiSword", "suiBow", "suiCav", "suiSpear"], "소정방", 2);
      g.invade("유성", "요동성", ["suiSpear", "suiSword", "suiBow", "suiCav", "suiCav"], "계필하력", 2);
      return { title: "661년 · 평양 포위", text: ["소정방이 대동강을 거슬러 평양성을 에워싼다. 겨울이 온다."] };
    },
  },
  {
    id: "666",
    year: 666,
    fire: (g) => {
      const c = g.cities.find((x) => x.name === "국내성");
      if (c && c.owner === "goguryeo" && g.powers.sui.alive && g.cities.filter((x) => x.owner === "goguryeo").length < 12) {
        c.owner = "sui";
        c.garrison = [];
        g.recomputeTerritory();
        return { title: "666년 · 연개소문 사망, 형제의 다툼", text: ["연개소문이 죽자 아들 남생·남건·남산이 다투었다. 쫓겨난 남생이 국내성을 들고 당에 붙었다."] };
      }
      return { title: "666년 · 연개소문 사망", text: ["연개소문이 죽었다. 나라가 튼튼하여 형제들이 다투지 않았다."] };
    },
  },
  {
    id: "667",
    year: 667,
    cond: (g) => g.tang && g.powers.sui.alive,
    fire: (g) => {
      g.declare("sui", "goguryeo");
      if (g.powers.silla.alive) g.declare("silla", "goguryeo");
      const big = ["suiSpear", "suiSpear", "suiSword", "suiSword", "suiSword", "suiBow", "suiBow", "suiCav", "suiCav", "suiCav", "suiSpear", "suiBow"];
      g.invade("유성", "신성", big, "이세적", 3);
      g.invade("회원진", "요동성", big.slice(0, 8), "설인귀", 3);
      return { title: "667년 · 마지막 원정", text: ["이세적과 설인귀가 다시 요하를 건넌다. 신라도 남쪽에서 올라온다. 이번이 마지막이 될 것이다 — 누구에게든."] };
    },
  },
];
