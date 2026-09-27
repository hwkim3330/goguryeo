/**
 * The enemy general. Every second or so each unit reconsiders: archers keep their distance and
 * shoot, falling back when infantry closes; horse goes for archers and for the flanks and
 * rears of units already locked in melee; infantry closes with the nearest foe; the general
 * stays behind the line. Units on a scripted march (the Sui columns at the river) keep marching
 * until the enemy comes near.
 */
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
}
