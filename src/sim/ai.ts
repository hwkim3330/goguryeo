/**
 * The enemy general. Every second or so each unit reconsiders: archers keep their distance and
 * shoot, falling back when infantry closes; horse goes for archers and for the flanks and
 * rears of units already locked in melee; infantry closes with the nearest foe; the general
 * stays behind the line. Units on a scripted march (the Sui columns at the river) keep marching
 * until the enemy comes near.
 *
 * At a siege the attacker sends rams at the gate, ladder parties at the stretch of wall facing
 * his camp (and over the mound where the earth reaches the wall top), keeps his archers at bow
 * range sweeping the parapet, and holds his horse back until the gate gives. The defender keeps
 * archers on the wall and throws his foot at whoever gets onto it or through the gate.
 */
import { Z_IN, Z_OUT, Z_RAMP, Z_WALL } from "../world/fort";
import type { Battle, Unit } from "./battle";

export class Ai {
  constructor(
    readonly b: Battle,
    readonly side: 0 | 1,
  ) {}

  update(dt: number): void {
    const b = this.b;
    const mine = b.units.filter((u) => u.side === this.side && u.state !== "gone" && u.state !== "routing");
    const foes = b.units.filter((u) => u.side !== this.side && u.state !== "gone" && u.state !== "routing");
    if (!foes.length) return;
    for (const u of mine) {
      u.aiT -= dt;
      if (u.aiT > 0) continue;
      u.aiT = 0.8 + Math.random() * 0.6;
      this.think(u, foes, mine);
    }
  }

  private think(u: Unit, foes: Unit[], mine: Unit[]): void {
    const b = this.b;
    const fort = b.field.fort;
    if (fort) {
      if (fort.spec.side === this.side ? this.defend(u, foes) : this.assault(u, foes, mine)) return;
    }
    const [x, z] = b.pos(u);
    const nearest = (pred: (f: Unit) => boolean = () => true) => {
      let best: Unit | null = null;
      let bd = Infinity;
      for (const f of foes) {
        if (!pred(f)) continue;
        const [fx, fz] = b.pos(f);
        const d = Math.hypot(fx - x, fz - z);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      return { f: best, d: bd };
    };
    const n = nearest();
    if (!n.f) return;
    // Marching columns: keep going until the enemy is close or we're hit.
    if (u.march) {
      if (n.d > 140 && u.recentLoss < 1 && u.shotAt < 1) return;
      u.march = undefined;
    }
    const role = u.type.role;
    const [fx, fz] = b.pos(n.f);
    const face = Math.atan2(fx - x, fz - z);
    if (role === "bow" || role === "hbow") {
      const melee = nearest((f) => f.type.range === 0);
      if (melee.f && melee.d < (role === "hbow" ? 70 : 45)) {
        // Fall back from the charge.
        const [mx, mz] = b.pos(melee.f);
        const away = Math.atan2(x - mx, z - mz);
        b.order(u, { k: "move", x: x + Math.sin(away) * 45, z: z + Math.cos(away) * 45, face: face, run: true });
      } else if (n.d > u.type.range * 0.9) b.order(u, { k: "move", x: x + Math.sin(face) * (n.d - u.type.range * 0.8), z: z + Math.cos(face) * (n.d - u.type.range * 0.8), face, run: false });
      else b.order(u, { k: "move", x, z, face, run: false });
      return;
    }
    if (role === "general") {
      // Behind the centre of our own army, facing the enemy.
      let cx = 0;
      let cz = 0;
      for (const m of mine) {
        const [mx, mz] = b.pos(m);
        cx += mx;
        cz += mz;
      }
      cx /= mine.length;
      cz /= mine.length;
      if (n.d < 25) b.order(u, { k: "attack", unit: n.f.id, run: true });
      else b.order(u, { k: "move", x: cx - Math.sin(face) * 70, z: cz - Math.cos(face) * 70, face, run: false });
      return;
    }
    if (role === "cav" || role === "hcav") {
      // Prefer archers, then anyone already fighting (hit them from behind), else the nearest.
      const archers = nearest((f) => f.type.range > 0 && !f.type.mounted);
      if (archers.f && archers.d < 500) return b.order(u, { k: "attack", unit: archers.f.id, run: archers.d < 180 });
      const busy = foes.find((f) => f.state === "fighting" && f.type.kit !== "spear");
      if (busy) {
        const [bx, bz] = b.pos(busy);
        const back = busy.face + Math.PI;
        const rx = bx + Math.sin(back) * 30;
        const rz = bz + Math.cos(back) * 30;
        const d = Math.hypot(rx - x, rz - z);
        if (d > 25) return b.order(u, { k: "move", x: rx, z: rz, face: busy.face, run: true });
        return b.order(u, { k: "attack", unit: busy.id, run: true });
      }
      return b.order(u, { k: "attack", unit: n.f.id, run: n.d < 260 });
    }
    // Infantry.
    if (n.d < 450) b.order(u, { k: "attack", unit: n.f.id, run: n.d < 140 });
    else b.order(u, { k: "move", x: x + Math.sin(face) * 60, z: z + Math.cos(face) * 60, face, run: false });
  }

  /** Attacking a fortress. Returns false to fall through to the field tactics. */
  private assault(u: Unit, foes: Unit[], mine: Unit[]): boolean {
    const b = this.b;
    const f = b.field.fort!;
    const [x, z] = b.pos(u);
    const zone = f.zoneAt(x, z);
    // Anyone already over the wall or through the gate just fights.
    if (zone !== Z_OUT) return false;
    const role = u.type.role;
    const out = (d: number): [number, number] => [f.gateX + f.gateNX * d, f.gateZ + f.gateNZ * d];
    // Foes out in the open (a sally) are fair game for anyone.
    const sally = foes.find((o) => {
      const [ox, oz] = b.pos(o);
      return f.zoneAt(ox, oz) === Z_OUT && Math.hypot(ox - x, oz - z) < 220;
    });
    if (sally && role !== "ram" && role !== "bow") {
      b.order(u, { k: "attack", unit: sally.id, run: true });
      return true;
    }
    const dCentre = Math.hypot(f.cx - x, f.cz - z);
    const face = Math.atan2(f.cx - x, f.cz - z);
    if (role === "ram") {
      if (f.gatePassable) {
        const [ax, az] = out(-40);
        b.order(u, { k: "move", x: ax, z: az, face, run: false });
        return true;
      }
      const [gx, gz] = out(0);
      const [ax, az] = out(14);
      const d = Math.hypot(ax - x, az - z);
      // Line up in front of the gate, then drive in.
      if (d > 10 && Math.hypot(gx - x, gz - z) > 14) b.order(u, { k: "move", x: ax, z: az, face: Math.atan2(-f.gateNX, -f.gateNZ), files: 4, run: false });
      else b.order(u, { k: "move", x: gx - f.gateNX * 3, z: gz - f.gateNZ * 3, face: Math.atan2(-f.gateNX, -f.gateNZ), files: 4, run: false });
      return true;
    }
    if (role === "bow") {
      // Stand off the wall facing us and sweep it.
      const [wx, wz] = this.wallPoint(x, z);
      const d = Math.hypot(wx - x, wz - z);
      if (d > u.type.range * 0.75 || d < 60) {
        const k = (d - u.type.range * 0.6) / d;
        b.order(u, { k: "move", x: x + (wx - x) * k, z: z + (wz - z) * k, face: Math.atan2(wx - x, wz - z), run: false });
      }
      return true;
    }
    if (u.type.mounted) {
      if (role === "general") {
        let cx = 0;
        let cz = 0;
        for (const m of mine) {
          const [mx, mz] = b.pos(m);
          cx += mx;
          cz += mz;
        }
        cx /= mine.length;
        cz /= mine.length;
        const k = Math.max(0, Math.hypot(f.cx - cx, f.cz - cz) + 90) / Math.max(1, Math.hypot(f.cx - cx, f.cz - cz));
        b.order(u, { k: "move", x: f.cx + (cx - f.cx) * k, z: f.cz + (cz - f.cz) * k, face, run: false });
        return true;
      }
      if (f.gatePassable) {
        const [gx, gz] = out(4);
        if (Math.hypot(gx - x, gz - z) > 16) b.order(u, { k: "move", x: gx, z: gz, face: Math.atan2(-f.gateNX, -f.gateNZ), files: 6, run: true });
        else b.order(u, { k: "move", x: f.cx, z: f.cz, face, run: true });
        return true;
      }
      // Wait out of bowshot in front of the gate.
      const [wx, wz] = out(230);
      if (Math.hypot(wx - x, wz - z) > 30) b.order(u, { k: "move", x: wx + (u.id % 3 - 1) * 60, z: wz, face: Math.atan2(-f.gateNX, -f.gateNZ), run: false });
      return true;
    }
    // Foot: through the gate if it's down, over the mound, or up ladders on the near wall.
    if (f.gatePassable && Math.hypot(f.gateX - x, f.gateZ - z) < 260) {
      const [gx, gz] = out(6);
      if (Math.hypot(gx - x, gz - z) > 14) b.order(u, { k: "move", x: gx, z: gz, face: Math.atan2(-f.gateNX, -f.gateNZ), files: 10, run: true });
      else b.order(u, { k: "move", x: f.cx, z: f.cz, face, run: true });
      return true;
    }
    const ramp = this.rampPoint();
    if (ramp && u.id % 3 === 0) {
      const [rx, rz] = ramp;
      const d = Math.hypot(rx - x, rz - z);
      const k = 1.6;
      if (d > 20) b.order(u, { k: "move", x: rx - (f.cx - rx) * 0.1, z: rz - (f.cz - rz) * 0.1, face: Math.atan2(f.cx - rx, f.cz - rz), files: 12, run: d < 150 });
      else b.order(u, { k: "move", x: rx + (f.cx - rx) * k * 0.3, z: rz + (f.cz - rz) * k * 0.3, face: Math.atan2(f.cx - rx, f.cz - rz), files: 12, run: true });
      return true;
    }
    // Ladders: march to a point just inside the wall facing us; the wall stops them and they climb.
    const [wx, wz] = this.wallPoint(x, z, (u.id % 5) - 2);
    const ix = wx + (f.cx - wx) * 0.12;
    const iz = wz + (f.cz - wz) * 0.12;
    b.order(u, { k: "move", x: ix, z: iz, face: Math.atan2(f.cx - wx, f.cz - wz), files: Math.max(12, Math.round(u.type.files * 0.8)), run: dCentre < 360 });
    return true;
  }

  /** A point on the wall facing (x, z), shifted `shift` ring vertices along it. */
  private wallPoint(x: number, z: number, shift = 0): [number, number] {
    const R = this.b.field.fort!.spec.ring;
    let best = 0;
    let bd = Infinity;
    R.forEach(([px, pz], i) => {
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const i = (best + shift + R.length * 4) % R.length;
    const j = (i + 1) % R.length;
    return [(R[i][0] + R[j][0]) / 2, (R[i][1] + R[j][1]) / 2];
  }

  private ramp: [number, number] | null | undefined;
  private rampPoint(): [number, number] | null {
    if (this.ramp !== undefined) return this.ramp;
    const f = this.b.field.fort!;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let j = 0; j < f.nz; j++)
      for (let i = 0; i < f.nx; i++)
        if (f.zone[j * f.nx + i] === Z_RAMP) {
          sx += f.x0 + i;
          sz += f.z0 + j;
          n++;
        }
    this.ramp = n > 20 ? [sx / n, sz / n] : null;
    return this.ramp;
  }

  /** Holding a fortress: stay on the walls, fall on whoever gets in. */
  private defend(u: Unit, foes: Unit[]): boolean {
    const b = this.b;
    const f = b.field.fort!;
    const [x, z] = b.pos(u);
    if (u.type.range > 0 && !u.type.mounted) {
      // Archers keep their places on the wall unless the enemy is on top of them.
      const close = foes.find((o) => {
        const [ox, oz] = b.pos(o);
        return f.within(ox, oz) && Math.hypot(ox - x, oz - z) < 25;
      });
      if (close) b.order(u, { k: "attack", unit: close.id, run: true });
      return true;
    }
    // Whoever is inside or on the wall, nearest first.
    let best: Unit | null = null;
    let bd = Infinity;
    for (const o of foes) {
      const [ox, oz] = b.pos(o);
      const zn = f.zoneAt(ox, oz);
      let inside = zn === Z_IN || zn === Z_WALL || zn === Z_RAMP;
      if (!inside) {
        // A unit half over the wall counts.
        let over = 0;
        for (const i of o.men) if (b.alive[i] && f.within(b.x[i], b.z[i])) over++;
        inside = over > 6;
      }
      if (!inside) continue;
      const d = Math.hypot(ox - x, oz - z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best && (bd < 320 || u.type.role !== "general")) {
      b.order(u, { k: "attack", unit: best.id, run: bd < 160 });
      return true;
    }
    // The gate is breaking or broken: stand behind it.
    if (f.gateHp < f.gateMax * 0.6 && u.type.role !== "general") {
      const gx = f.gateX - f.gateNX * 22;
      const gz = f.gateZ - f.gateNZ * 22;
      if (Math.hypot(gx - x, gz - z) > 12) b.order(u, { k: "move", x: gx, z: gz, face: Math.atan2(f.gateNX, f.gateNZ), run: true });
      return true;
    }
    return true;
  }
}
