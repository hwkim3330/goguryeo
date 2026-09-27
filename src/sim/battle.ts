/**
 * The battle. Regiments hold a formation (files × ranks, a facing); each soldier walks to his
 * slot in it until the enemy is within reach, then picks the nearest foe and fights. Blows are
 * rolled from attack against defence and armour, with bonuses for striking a flank or the rear,
 * for spears against horse, and for the impact of a charge. Archers loose volleys on a ballistic
 * arc; the arrows land where they land. Morale falls with losses, with being flanked, charged or
 * shot at, and when the general dies; a unit whose morale breaks runs, and may rally.
 *
 * Soldiers live in flat typed arrays (thousands of them), found by a spatial hash.
 */
import { Z_GATE, Z_OUT, Z_RAMP, Z_WALL } from "../world/fort";
import type { Field } from "../world/terrain";
import { TYPES, type UnitType } from "./units";

export type Order = { k: "hold" } | { k: "move"; x: number; z: number; face: number; files?: number; run: boolean } | { k: "attack"; unit: number; run: boolean };

export type UState = "ready" | "moving" | "fighting" | "shooting" | "routing" | "gone";

export interface Unit {
  id: number;
  side: 0 | 1;
  team: number;
  type: UnitType;
  name: string;
  men: number[];
  x: number;
  z: number;
  face: number;
  files: number;
  order: Order;
  state: UState;
  morale: number;
  fatigue: number;
  ammo: number;
  fireAtWill: boolean;
  /** Recent losses (decays), for morale. */
  recentLoss: number;
  shotAt: number;
  flanked: number;
  charged: number;
  volleyT: number;
  kills: number;
  start: number;
  /** AI memory. */
  aiT: number;
  aiTarget: number;
  selected: boolean;
  /** Scripted: march toward this point until attacked (the Sui retreat). */
  march?: [number, number];
  rallied: number;
}

export interface Arrow {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  side: 0 | 1;
  dmg: number;
  unit: number;
  t: number;
  stuck: number;
}

export interface BattleEvents {
  clash: number;
  deaths: number;
  volleys: number;
  charges: number;
  routs: string[];
  rallies: string[];
  /** Men who got away off the map on a scripted march (the Sui crossing north). */
  escaped: number;
  escapedUnits: string[];
  /** Siege: the gate gave way / a man first got onto the wall. */
  gateBroken: boolean;
  walls: number;
}

const HASH = 4;
/** Seconds up a ladder with nobody pushing it off. */
const CLIMB = 9;
const fract = (v: number) => v - Math.floor(v);

export class Battle {
  readonly units: Unit[] = [];
  // Soldiers.
  cap = 0;
  n = 0;
  x!: Float32Array;
  z!: Float32Array;
  y!: Float32Array;
  vx!: Float32Array;
  vz!: Float32Array;
  dir!: Float32Array;
  hp!: Float32Array;
  unit!: Int32Array;
  slot!: Int32Array;
  alive!: Uint8Array;
  target!: Int32Array;
  cool!: Float32Array;
  phase!: Float32Array;
  action!: Float32Array;
  death!: Float32Array;
  flash!: Float32Array;
  seed!: Float32Array;
  chargeHit!: Uint8Array;
  /** Siege ladders: seconds spent climbing. */
  climb!: Float32Array;
  readonly arrows: Arrow[] = [];
  private grid = new Map<number, number[]>();
  time = 0;
  readonly ev: BattleEvents = { clash: 0, deaths: 0, volleys: 0, charges: 0, routs: [], rallies: [], escaped: 0, escapedUnits: [], gateBroken: false, walls: 0 };
  result: 0 | 1 | -1 = -1;
  /** Which way each side runs when it breaks: away from where the enemy started. */
  private home: [number, number][] | null = null;
  private startMen = [0, 0];
  private R = 1234567;

  constructor(readonly field: Field) {}

  rand(): number {
    this.R = (Math.imul(this.R, 1103515245) + 12345) >>> 0;
    return this.R / 4294967296;
  }

  private alloc(extra: number): void {
    const need = this.n + extra;
    if (need <= this.cap) return;
    const cap = Math.max(need, this.cap * 2, 1024);
    const grow = <T extends Float32Array | Int32Array | Uint8Array>(a: T | undefined, C: { new (n: number): T }): T => {
      const b = new C(cap);
      if (a) b.set(a);
      return b;
    };
    this.x = grow(this.x, Float32Array);
    this.z = grow(this.z, Float32Array);
    this.y = grow(this.y, Float32Array);
    this.vx = grow(this.vx, Float32Array);
    this.vz = grow(this.vz, Float32Array);
    this.dir = grow(this.dir, Float32Array);
    this.hp = grow(this.hp, Float32Array);
    this.unit = grow(this.unit, Int32Array);
    this.slot = grow(this.slot, Int32Array);
    this.alive = grow(this.alive, Uint8Array);
    this.target = grow(this.target, Int32Array);
    this.cool = grow(this.cool, Float32Array);
    this.phase = grow(this.phase, Float32Array);
    this.action = grow(this.action, Float32Array);
    this.death = grow(this.death, Float32Array);
    this.flash = grow(this.flash, Float32Array);
    this.seed = grow(this.seed, Float32Array);
    this.chargeHit = grow(this.chargeHit, Uint8Array);
    this.climb = grow(this.climb, Float32Array);
    this.cap = cap;
  }

  addUnit(typeId: string, side: 0 | 1, team: number, x: number, z: number, face: number, name?: string, opts: { men?: number; type?: UnitType; files?: number } = {}): Unit {
    const t = opts.type ?? TYPES[typeId];
    const men = Math.max(1, Math.round(opts.men ?? t.men));
    const u: Unit = {
      id: this.units.length,
      side,
      team,
      type: t,
      name: name ?? t.name,
      men: [],
      x,
      z,
      face,
      files: opts.files ?? (men < t.men ? Math.max(4, Math.round(t.files * Math.sqrt(men / t.men))) : t.files),
      order: { k: "hold" },
      state: "ready",
      morale: t.morale,
      fatigue: 0,
      ammo: t.ammo,
      fireAtWill: true,
      recentLoss: 0,
      shotAt: 0,
      flanked: 0,
      charged: 0,
      volleyT: 1 + Math.random() * 2,
      kills: 0,
      start: men,
      aiT: 0,
      aiTarget: -1,
      selected: false,
      rallied: 0,
    };
    this.alloc(men);
    for (let s = 0; s < men; s++) {
      const i = this.n++;
      const [sx, sz] = this.slotPos(u, s, x, z, face, u.files);
      this.x[i] = sx + (this.rand() - 0.5) * 0.4;
      this.z[i] = sz + (this.rand() - 0.5) * 0.4;
      this.y[i] = this.field.stand(this.x[i], this.z[i]);
      this.dir[i] = face;
      this.hp[i] = t.hp;
      this.unit[i] = u.id;
      this.slot[i] = s;
      this.alive[i] = 1;
      this.target[i] = -1;
      this.cool[i] = this.rand() * t.rate;
      this.phase[i] = this.rand() * 6.28;
      this.seed[i] = this.rand();
      u.men.push(i);
    }
    this.units.push(u);
    return u;
  }

  spacing(t: UnitType): [number, number] {
    return t.mounted ? [2.3, 3.6] : t.role === "bow" ? [1.5, 1.7] : [1.15, 1.3];
  }

  /** World position of formation slot `s`. */
  slotPos(u: Unit, s: number, cx: number, cz: number, face: number, files: number): [number, number] {
    const [sw, sd] = this.spacing(u.type);
    const f = Math.max(1, files);
    const col = s % f;
    const row = Math.floor(s / f);
    const lat = (col - (f - 1) / 2) * sw + (row % 2) * sw * 0.25;
    const dep = -row * sd;
    const fx = Math.sin(face);
    const fz = Math.cos(face);
    // Right-hand side is (cos, -sin).
    return [cx + fz * lat + fx * dep, cz - fx * lat + fz * dep];
  }

  livingMen(u: Unit): number {
    let n = 0;
    for (const i of u.men) if (this.alive[i]) n++;
    return n;
  }

  // ------------------------------------------------------------------ orders

  order(u: Unit, o: Order): void {
    if (u.state === "routing" || u.state === "gone") return;
    u.order = o;
    if (o.k === "move") {
      if (o.files) u.files = Math.max(3, Math.min(80, o.files));
      u.march = undefined;
    }
    if (o.k === "attack") u.march = undefined;
  }

  // ------------------------------------------------------------------ spatial hash

  private key(x: number, z: number): number {
    return (Math.floor(x / HASH) + 1024) * 4096 + Math.floor(z / HASH) + 1024;
  }

  private rebuildGrid(): void {
    for (const l of this.grid.values()) l.length = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const k = this.key(this.x[i], this.z[i]);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(i);
    }
  }

  /** Call fn for every living soldier within r of (x, z). */
  near(x: number, z: number, r: number, fn: (j: number, d2: number) => void): void {
    const r2 = r * r;
    const a = Math.floor((x - r) / HASH);
    const b = Math.floor((x + r) / HASH);
    const c = Math.floor((z - r) / HASH);
    const d = Math.floor((z + r) / HASH);
    for (let gx = a; gx <= b; gx++)
      for (let gz = c; gz <= d; gz++) {
        const l = this.grid.get((gx + 1024) * 4096 + gz + 1024);
        if (!l) continue;
        for (const j of l) {
          const dx = this.x[j] - x;
          const dz = this.z[j] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(j, d2);
        }
      }
  }

  // ------------------------------------------------------------------ step

  step(dt: number): void {
    if (!this.home) {
      const c = [0, 1].map((s) => {
        let x = 0;
        let z = 0;
        let n = 0;
        for (const u of this.units)
          if (u.side === s) {
            x += u.x * u.men.length;
            z += u.z * u.men.length;
            n += u.men.length;
          }
        this.startMen[s] = n;
        return [x / (n || 1), z / (n || 1)];
      });
      this.home = [0, 1].map((s) => {
        const dx = c[s][0] - c[1 - s][0];
        const dz = c[s][1] - c[1 - s][1];
        const l = Math.hypot(dx, dz) || 1;
        return [dx / l, dz / l] as [number, number];
      });
    }
    this.time += dt;
    this.rebuildGrid();
    for (const u of this.units) this.unitThink(u, dt);
    this.moveSoldiers(dt);
    this.arrowsStep(dt);
    for (let i = 0; i < this.n; i++) {
      if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 4);
      if (!this.alive[i] && this.death[i] < 1) this.death[i] = Math.min(1, this.death[i] + dt * 1.6);
    }
    this.checkEnd();
  }

  private centre(u: Unit): [number, number, number] {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const i of u.men)
      if (this.alive[i]) {
        x += this.x[i];
        z += this.z[i];
        n++;
      }
    return n ? [x / n, z / n, n] : [u.x, u.z, 0];
  }

  /** Where the unit's soldiers are, on average (for AI and UI). */
  pos(u: Unit): [number, number] {
    const [x, z] = this.centre(u);
    return [x, z];
  }

  private unitThink(u: Unit, dt: number): void {
    if (u.state === "gone") return;
    const [cx, cz, alive] = this.centre(u);
    if (!alive) {
      u.state = "gone";
      return;
    }
    u.recentLoss *= Math.exp(-dt / 6);
    u.shotAt *= Math.exp(-dt / 4);
    u.flanked *= Math.exp(-dt / 3);
    u.charged *= Math.exp(-dt / 3);
    // Morale.
    const lossK = 1 - alive / u.start;
    const gen = this.units.find((g) => g.side === u.side && g.type.role === "general" && g.state !== "gone" && g.state !== "routing");
    let aura = 0;
    if (gen) {
      const [gx, gz] = this.centre(gen);
      if (Math.hypot(gx - cx, gz - cz) < 90) aura = 12;
    } else aura = -18;
    const wantMorale = u.type.morale + aura - lossK * 45 - u.recentLoss * 2.2 - u.shotAt * 0.6 - u.flanked * 10 - u.charged * 6 - u.fatigue * 0.15;
    u.morale += (wantMorale - u.morale) * Math.min(1, dt * 0.6);
    if (u.state === "routing") {
      // Rally once safe and steadier.
      let danger = false;
      this.near(cx, cz, 45, (j) => {
        if (this.units[this.unit[j]].side !== u.side) danger = true;
      });
      u.morale += dt * (danger ? -1 : 4);
      if (!danger && u.morale > 45 && u.rallied < 2 && lossK < 0.75) {
        u.state = "ready";
        u.rallied++;
        u.order = { k: "move", x: cx, z: cz, face: u.face, run: false };
        this.ev.rallies.push(u.name);
      }
      const e = this.field.spec.size / 2 - 15;
      if (Math.abs(cx) > e || Math.abs(cz) > e) {
        for (const i of u.men) if (this.alive[i]) this.alive[i] = 0;
        u.state = "gone";
      }
      return;
    }
    // A marching column that reaches the map's edge has escaped.
    if (u.march) {
      const e = this.field.spec.size / 2 - 30;
      if (Math.abs(cz) > e || Math.abs(cx) > e) {
        this.ev.escaped += alive;
        this.ev.escapedUnits.push(u.name);
        for (const i of u.men) this.alive[i] = 0;
        u.state = "gone";
        return;
      }
    }
    if (u.morale < 12 && lossK > 0.12) {
      u.state = "routing";
      this.ev.routs.push(u.name);
      return;
    }
    // Fatigue: running and fighting tire, standing rests.
    const moving = u.state === "moving";
    const run = u.order.k !== "hold" && "run" in u.order && u.order.run;
    u.fatigue = Math.max(0, Math.min(100, u.fatigue + dt * (u.state === "fighting" ? 0.9 : moving && run ? 1.3 : moving ? 0.1 : -0.8)));
    // What the unit is doing.
    let engaged = 0;
    for (const i of u.men) if (this.alive[i] && this.target[i] >= 0) engaged++;
    if (u.order.k === "attack") {
      const t = this.units[u.order.unit];
      if (!t || t.state === "gone") u.order = { k: "hold" };
      else {
        const [tx, tz] = this.centre(t);
        const d = Math.hypot(tx - cx, tz - cz);
        if (u.type.range > 0 && !u.type.mounted) {
          // Archers ordered to attack move into range and shoot.
          if (d > u.type.range * 0.85) {
            u.x = tx - ((tx - cx) / d) * u.type.range * 0.8;
            u.z = tz - ((tz - cz) / d) * u.type.range * 0.8;
          }
          u.face = Math.atan2(tx - cx, tz - cz);
        } else {
          u.x = tx;
          u.z = tz;
          u.face = Math.atan2(tx - cx, tz - cz);
        }
      }
    } else if (u.order.k === "move") {
      u.x = u.order.x;
      u.z = u.order.z;
      u.face = u.order.face;
    } else if (u.march) {
      u.x = u.march[0];
      u.z = u.march[1];
      u.face = Math.atan2(u.march[0] - cx, u.march[1] - cz);
    }
    const far = Math.hypot(u.x - cx, u.z - cz) > 6;
    u.state = engaged > alive * 0.15 ? "fighting" : far ? "moving" : "ready";
    // Missiles.
    if (u.type.range > 0 && u.ammo > 0 && u.fireAtWill && engaged < alive * 0.2) {
      u.volleyT -= dt;
      if (u.volleyT <= 0) {
        const tgt = this.missileTarget(u, cx, cz);
        if (tgt) {
          u.volleyT = u.type.rate * (0.85 + this.rand() * 0.3) * (1 + u.fatigue / 200);
          this.volley(u, tgt);
          u.state = "shooting";
        } else u.volleyT = 0.5;
      }
    }
  }

  private missileTarget(u: Unit, cx: number, cz: number): Unit | null {
    let best: Unit | null = null;
    let bd = Infinity;
    const want = u.order.k === "attack" ? this.units[u.order.unit] : null;
    for (const t of this.units) {
      if (t.side === u.side || t.state === "gone") continue;
      const [tx, tz, n] = this.centre(t);
      if (!n) continue;
      const d = Math.hypot(tx - cx, tz - cz);
      const lift = Math.max(0, Math.min(0.35, (this.field.stand(cx, cz) - this.field.stand(tx, tz)) / 30));
      if (d > u.type.range * (1 + lift)) continue;
      // Don't shoot into a melee where our own men are.
      let ours = 0;
      this.near(tx, tz, 8, (j) => {
        if (this.units[this.unit[j]].side === u.side) ours++;
      });
      if (ours > 3) continue;
      const score = d - (t === want ? 1000 : 0);
      if (score < bd) {
        bd = score;
        best = t;
      }
    }
    return best;
  }

  private volley(u: Unit, t: Unit): void {
    this.ev.volleys++;
    u.ammo--;
    const g = 9.8;
    for (const i of u.men) {
      if (!this.alive[i] || this.target[i] >= 0) continue;
      const aim = t.men[Math.floor(this.rand() * t.men.length)];
      if (!this.alive[aim]) continue;
      this.action[i] = 0.01;
      const sx = this.x[i];
      const sz = this.z[i];
      const sy = this.y[i] + 1.6;
      // Lead the target a little, scatter with distance.
      const lead = 1.6;
      const tx = this.x[aim] + this.vx[aim] * lead + (this.rand() - 0.5) * 7;
      const tz = this.z[aim] + this.vz[aim] * lead + (this.rand() - 0.5) * 7;
      const ty = this.field.stand(tx, tz) + 1;
      const dx = tx - sx;
      const dz = tz - sz;
      const d = Math.hypot(dx, dz);
      // A high arc: flight time grows with distance.
      const T = 0.9 + d / 55;
      const vy = (ty - sy + 0.5 * g * T * T) / T;
      this.arrows.push({ x: sx, y: sy, z: sz, vx: dx / T, vy, vz: dz / T, side: u.side, dmg: u.type.attack + 4, unit: u.id, t: 0, stuck: 0 });
    }
    t.shotAt += 1.5;
  }

  private arrowsStep(dt: number): void {
    const g = 9.8;
    for (const a of this.arrows) {
      if (a.stuck > 0) {
        a.stuck -= dt;
        continue;
      }
      a.t += dt;
      a.vy -= g * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.z += a.vz * dt;
      const fort = this.field.fort;
      if (fort) {
        const zn = fort.zoneAt(a.x, a.z);
        if ((zn === Z_WALL || (zn === Z_GATE && !fort.gatePassable)) && a.y < fort.wallTop(a.x, a.z) - 0.2) {
          a.stuck = 4;
          continue;
        }
      }
      const gy = fort ? this.field.stand(a.x, a.z) : this.field.height(a.x, a.z);
      if (a.y <= gy + 1.7 && a.vy < 0) {
        // Near a man at the height of a man: roll to hit.
        let hit = -1;
        this.near(a.x, a.z, 0.55, (j) => {
          if (hit < 0 && this.units[this.unit[j]].side !== a.side) hit = j;
        });
        if (hit >= 0) {
          const tu = this.units[this.unit[hit]];
          const t = tu.type;
          // Shields facing the arrow block it.
          const facing = Math.cos(this.dir[hit] - Math.atan2(-a.vx, -a.vz));
          let shield = (t.kit === "sword" || t.kit === "axe") && facing > 0.3 ? 0.55 : 0;
          // Behind the parapet (여장) or under a ram's roof.
          if (fort && tu.side === fort.spec.side && fort.zoneAt(this.x[hit], this.z[hit]) === Z_WALL) shield = 1 - (1 - shield) * 0.4;
          if (t.role === "ram") shield = 0.85;
          if (this.rand() > shield) this.hurt(hit, Math.max(1, a.dmg - t.armour * 0.55) * (0.6 + this.rand() * 0.8), this.units[a.unit]);
          a.stuck = 0.01;
        } else if (a.y <= gy) {
          a.y = gy + 0.3;
          a.stuck = 6;
        }
      }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) if (this.arrows[i].stuck < 0 || (this.arrows[i].stuck === 0 && this.arrows[i].t > 12)) this.arrows.splice(i, 1);
    if (this.arrows.length > 6000) this.arrows.splice(0, this.arrows.length - 6000);
  }

  private hurt(i: number, dmg: number, by: Unit | null): void {
    if (!this.alive[i]) return;
    this.hp[i] -= dmg;
    this.flash[i] = 1;
    if (this.hp[i] <= 0) {
      this.alive[i] = 0;
      this.target[i] = -1;
      this.death[i] = 0.01;
      const u = this.units[this.unit[i]];
      u.recentLoss += 1;
      this.ev.deaths++;
      if (by) by.kills++;
    }
  }

  private moveSoldiers(dt: number): void {
    const f = this.field;
    const fort = f.fort;
    for (const u of this.units) {
      if (u.state === "gone") continue;
      const t = u.type;
      const routing = u.state === "routing";
      const runOrder = !routing && u.order.k !== "hold" && "run" in u.order && u.order.run;
      const speed = routing ? t.run * 0.95 : runOrder ? t.run * (1 - u.fatigue / 250) : t.walk;
      const reach = t.mounted ? 2.4 : t.kit === "spear" ? 2.2 : 1.5;
      const [cx] = routing ? this.centre(u) : [0, 0];
      // Living soldiers take the front slots (the formation closes up).
      let slotN = 0;
      for (const i of u.men) {
        if (!this.alive[i]) continue;
        const s = slotN++;
        // Target: keep the one we have if still close, else look for the nearest foe.
        let tgt = this.target[i];
        const yi = this.y[i];
        if (tgt >= 0 && (!this.alive[tgt] || dist2(this, i, tgt) > (reach + 3) ** 2 || Math.abs(this.y[tgt] - yi) > 2.6)) tgt = -1;
        const climbing = this.climb[i] > 0;
        const engageR = routing || climbing ? 0 : u.type.range > 0 && !t.mounted ? 4 : 9;
        if (tgt < 0 && engageR > 0 && (this.cool[i] <= 0 || u.state === "fighting" || u.order.k === "attack")) {
          let bd = engageR * engageR;
          this.near(this.x[i], this.z[i], engageR, (j, d2) => {
            if (d2 < bd && this.units[this.unit[j]].side !== u.side && Math.abs(this.y[j] - yi) < 2.6) {
              bd = d2;
              tgt = j;
            }
          });
        }
        this.target[i] = tgt;
        let gx: number;
        let gz: number;
        if (routing && fort && u.side === fort.spec.side && fort.within(this.x[i], this.z[i])) {
          // Nowhere to run inside the walls: huddle toward the middle.
          gx = fort.cx + (this.seed[i] - 0.5) * 60;
          gz = fort.cz + (fract(this.seed[i] * 7.7) - 0.5) * 60;
        } else if (routing) {
          // Away from the nearest enemies, toward our own map edge.
          const [hx, hz] = this.home ? this.home[u.side] : [0, u.side === 0 ? 1 : -1];
          gx = this.x[i] + hx * 30 + (this.x[i] - cx) * 0.1;
          gz = this.z[i] + hz * 30;
        } else if (tgt >= 0) {
          gx = this.x[tgt];
          gz = this.z[tgt];
        } else {
          [gx, gz] = this.slotPos(u, s, u.x, u.z, u.face, u.files);
        }
        let dx = gx - this.x[i];
        let dz = gz - this.z[i];
        const d = Math.hypot(dx, dz);
        let want = 0;
        if (tgt >= 0) {
          want = d > reach * 0.85 ? speed * (t.mounted ? 1 : 1.3) : 0;
          // Strike.
          this.cool[i] -= dt;
          if (d <= reach + 0.3 && this.cool[i] <= 0) {
            this.strike(i, tgt, u);
            this.cool[i] = t.rate * (0.8 + this.rand() * 0.5) * (1 + u.fatigue / 150);
          }
        } else if (d > 0.35) want = Math.min(speed, d * 1.8);
        // Terrain: water and slopes slow, forests break formation speed.
        const s0 = f.surface(this.x[i], this.z[i]);
        let slow = 1;
        if (s0.wet > 0.2) slow *= t.mounted ? 0.55 : 0.4;
        if (f.isForest(this.x[i], this.z[i])) slow *= t.mounted ? 0.45 : 0.75;
        const here = fort ? f.stand(this.x[i], this.z[i]) : s0.y;
        const aheadY = f.stand(this.x[i] + (dx / (d || 1)) * 2, this.z[i] + (dz / (d || 1)) * 2);
        const ahead = fort && aheadY - here > 4 ? 0 : aheadY - here;
        if (ahead > 0) slow *= Math.max(0.35, 1 - ahead * 0.35);
        want *= slow;
        if (d > 1e-3) {
          dx /= d;
          dz /= d;
        }
        // Separation from neighbours (friend and foe), so the crowd has bodies.
        let sx = 0;
        let sz = 0;
        const R = t.mounted ? 1.4 : 0.62;
        this.near(this.x[i], this.z[i], R * 1.6, (j, d2) => {
          if (j === i || d2 < 1e-6) return;
          const dd = Math.sqrt(d2);
          const rj = this.units[this.unit[j]].type.mounted ? 1.4 : 0.62;
          const overlap = R + rj - dd;
          if (overlap > 0) {
            const k = overlap / dd;
            sx += (this.x[i] - this.x[j]) * k;
            sz += (this.z[i] - this.z[j]) * k;
          }
        });
        const acc = t.mounted ? 4 : 8;
        const tvx = dx * want + sx * 3;
        const tvz = dz * want + sz * 3;
        this.vx[i] += (tvx - this.vx[i]) * Math.min(1, dt * acc);
        this.vz[i] += (tvz - this.vz[i]) * Math.min(1, dt * acc);
        // A charge: horsemen at speed hitting a man knock him down and hurt him.
        const sp = Math.hypot(this.vx[i], this.vz[i]);
        if (t.charge > 12 && sp > t.run * 0.6 && tgt >= 0 && d < reach + 0.6 && !this.chargeHit[i]) {
          this.chargeHit[i] = 1;
          const tu = this.units[this.unit[tgt]];
          const brace = tu.type.kit === "spear" && tu.state !== "moving" && Math.cos(this.dir[tgt] - Math.atan2(-dx, -dz)) > 0.4;
          if (brace) this.hurt(i, tu.type.antiCav * 1.6 * (0.6 + this.rand() * 0.8), tu);
          else {
            this.hurt(tgt, (t.charge - tu.type.armour * 0.6) * (0.6 + this.rand() * 0.8) * (sp / t.run), u);
            this.vx[tgt] += dx * 3;
            this.vz[tgt] += dz * 3;
            tu.charged += 0.6;
          }
          this.ev.charges++;
        }
        if (sp < t.walk * 0.5) this.chargeHit[i] = 0;
        const ox = this.x[i];
        const oz = this.z[i];
        this.x[i] += this.vx[i] * dt;
        this.z[i] += this.vz[i] * dt;
        const e = f.spec.size / 2 - 2;
        this.x[i] = Math.max(-e, Math.min(e, this.x[i]));
        this.z[i] = Math.max(-e, Math.min(e, this.z[i]));
        if (fort) this.fortStep(i, u, ox, oz, dx, dz, dt);
        this.y[i] = this.climb[i] > 0 ? this.climbY(i) : f.stand(this.x[i], this.z[i]);
        // Facing: the enemy while fighting, else where we're going, else the formation's.
        const faceTo = tgt >= 0 ? Math.atan2(this.x[tgt] - this.x[i], this.z[tgt] - this.z[i]) : sp > 0.4 ? Math.atan2(this.vx[i], this.vz[i]) : u.face;
        let df = faceTo - this.dir[i];
        df = Math.atan2(Math.sin(df), Math.cos(df));
        this.dir[i] += df * Math.min(1, dt * 6);
        this.phase[i] += dt * sp * (t.mounted ? 1.9 : 3.4);
        if (this.action[i] > 0) {
          this.action[i] += dt * (t.range > 0 && tgt < 0 ? 0.6 : 2.2);
          if (this.action[i] > 1) this.action[i] = 0;
        }
      }
    }
  }

  /**
   * Walls. A step that would cross from one zone to another the rules don't allow is undone
   * (sliding along the wall if it can). Attacking foot soldiers stopped at the wall's foot put
   * up ladders and climb; stopped at a shut gate they batter it (rams far harder).
   */
  private fortStep(i: number, u: Unit, ox: number, oz: number, dx: number, dz: number, dt: number): void {
    const fort = this.field.fort!;
    const a = fort.zoneAt(ox, oz);
    let b = fort.zoneAt(this.x[i], this.z[i]);
    if (fort.pass(a, b, u.side)) {
      if (this.climb[i] > 0) this.climb[i] = Math.max(0, this.climb[i] - dt * 2);
      if (a === Z_OUT && b === Z_RAMP && u.side !== fort.spec.side) this.ev.walls++;
      return;
    }
    const nx = this.x[i];
    const nz = this.z[i];
    // Slide: keep one component of the step if that one is allowed.
    this.x[i] = nx;
    this.z[i] = oz;
    b = fort.zoneAt(nx, oz);
    if (!fort.pass(a, b, u.side)) {
      this.x[i] = ox;
      this.z[i] = nz;
      b = fort.zoneAt(ox, nz);
      if (!fort.pass(a, b, u.side)) {
        this.x[i] = ox;
        this.z[i] = oz;
        b = fort.zoneAt(nx, nz);
      }
    }
    const blockedBy = fort.zoneAt(nx, nz);
    const attacker = u.side !== fort.spec.side;
    if (!attacker || this.target[i] >= 0) return;
    const t = u.type;
    if (blockedBy === Z_GATE && !fort.gatePassable) {
      // Batter the gate.
      this.cool[i] -= dt;
      if (this.cool[i] <= 0) {
        this.cool[i] = t.rate;
        this.action[i] = 0.01;
        fort.gateHp -= t.attack * t.rate * (t.role === "ram" ? 1.6 : 0.09);
        if (fort.gateHp <= 0 && !this.ev.gateBroken) this.ev.gateBroken = true;
      }
      return;
    }
    if (blockedBy === Z_WALL && a === Z_OUT && !t.mounted && t.role !== "ram" && t.range === 0) {
      // Ladders: the more defenders on the wall above, the longer it takes to get a foot up.
      let above = 0;
      this.near(nx, nz, 7, (j) => {
        if (this.units[this.unit[j]].side === fort.spec.side && this.y[j] > this.y[i] + 4) above++;
      });
      this.climb[i] += dt / (1 + above * 0.35);
      this.target[i] = -1;
      if (this.climb[i] >= CLIMB) {
        // Over the top: onto the wall walk.
        for (let s = 1; s <= 10; s++) {
          const px = ox + dx * s;
          const pz = oz + dz * s;
          if (fort.zoneAt(px, pz) === Z_WALL) {
            this.x[i] = px + dx * 1.5;
            this.z[i] = pz + dz * 1.5;
            if (fort.zoneAt(this.x[i], this.z[i]) !== Z_WALL) {
              this.x[i] = px;
              this.z[i] = pz;
            }
            break;
          }
        }
        this.climb[i] = 0;
        this.ev.walls++;
      }
      this.vx[i] *= 0.2;
      this.vz[i] *= 0.2;
    }
  }

  /** Halfway up a ladder. */
  private climbY(i: number): number {
    const f = this.field;
    const fort = f.fort!;
    const g = f.height(this.x[i], this.z[i]);
    const k = Math.min(1, this.climb[i] / CLIMB);
    const tx = this.x[i] + Math.sin(this.dir[i]) * 2.5;
    const tz = this.z[i] + Math.cos(this.dir[i]) * 2.5;
    const top = fort.zoneAt(tx, tz) === Z_WALL ? fort.wallTop(tx, tz) : g + fort.spec.height;
    return g + (top - 1.2 - g) * k;
  }

  /** How high a man stands (for UI and effects). */
  standY(x: number, z: number): number {
    return this.field.stand(x, z);
  }

  private strike(i: number, j: number, u: Unit): void {
    this.action[i] = 0.01;
    const t = u.type;
    const tu = this.units[this.unit[j]];
    const d = tu.type;
    this.ev.clash++;
    // Where the blow lands: angle between the attacker's approach and the target's facing.
    const ang = Math.atan2(this.x[i] - this.x[j], this.z[i] - this.z[j]);
    const rel = Math.cos(ang - this.dir[j]);
    const flank = rel < -0.3 ? 2 : rel < 0.35 ? 1 : 0;
    if (flank) tu.flanked += flank * 0.08;
    const atk = t.attack * (1 - u.fatigue / 250) + (flank === 2 ? 5 : flank === 1 ? 2 : 0);
    const def = d.defence * (tu.state === "routing" ? 0.2 : 1) * (flank === 2 ? 0.3 : flank === 1 ? 0.7 : 1);
    const chance = Math.max(0.12, Math.min(0.85, 0.45 + (atk - def) * 0.035));
    if (this.rand() < chance) {
      let dmg = Math.max(1, t.attack - d.armour * (t.role === "axe" ? 0.3 : 0.6)) * (0.7 + this.rand() * 0.6);
      if (d.mounted) dmg += t.antiCav;
      this.hurt(j, dmg, u);
    }
  }

  private checkEnd(): void {
    if (this.result >= 0 || !this.home) return;
    const fort = this.field.fort;
    if (fort && this.time > fort.spec.hold) {
      this.result = fort.spec.side;
      return;
    }
    // A side is beaten when what still stands is a remnant of what took the field.
    const fighting = (s: 0 | 1) => {
      let n = 0;
      for (const u of this.units) if (u.side === s && u.state !== "gone" && u.state !== "routing") n += this.livingMen(u);
      // An assault on walls is called off sooner than a fight in the open.
      const k = fort && fort.spec.side !== s ? 0.16 : 0.06;
      return n > this.startMen[s] * k;
    };
    if (!fighting(1)) this.result = 0;
    else if (!fighting(0)) this.result = 1;
  }

  strength(side: 0 | 1): number {
    let n = 0;
    for (const u of this.units) if (u.side === side && u.state !== "gone") n += this.livingMen(u) * (u.type.mounted ? 2.5 : 1);
    return n;
  }
}

function dist2(b: Battle, i: number, j: number): number {
  const dx = b.x[i] - b.x[j];
  const dz = b.z[i] - b.z[j];
  return dx * dx + dz * dz;
}
