/**
 * A walled fortress (성곽) on the battlefield, the way 고구려 built them: a stone face stacked in
 * receding courses (들여쌓기) backed on the inside by an earthen bank (내탁) the defenders walk
 * up, square bastions (치) jutting out every few stretches, a gate with a two-storey gatehouse
 * (문루). The fort is a polyline ring; a 1 m grid over it says, for every spot, whether it is
 * outside, on the wall, inside, in the gateway, or on a ramp where the ground outside has been
 * heaped up to the wall top (the siege mound, 토산), and how high a man standing there is.
 */
import type { Field } from "./terrain";

export interface FortSpec {
  /** Closed ring (x, z), in order; the last point joins the first. */
  ring: [number, number][];
  /** Index of the ring segment that holds the gate (its middle). */
  gate: number;
  height: number;
  thick: number;
  /** Which side holds it. */
  side: 0 | 1;
  /** Seconds the defenders must hold for the attack to fail. */
  hold: number;
  /** The siege mound heaped against the wall: [x, z, radius, height], raised after the walls. */
  mound?: [number, number, number, number];
}

export const Z_OUT = 0;
export const Z_WALL = 1;
export const Z_IN = 2;
export const Z_GATE = 3;
export const Z_RAMP = 4;
/** Width of the earth bank behind the wall. */
export const BANK = 9;

export class Fort {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly zone: Uint8Array;
  readonly top: Float32Array;
  readonly dist: Float32Array;
  /** Per ring vertex: wall-top height. */
  readonly vTop: number[];
  readonly gateX: number;
  readonly gateZ: number;
  /** Outward normal at the gate. */
  readonly gateNX: number;
  readonly gateNZ: number;
  readonly cx: number;
  readonly cz: number;
  gateHp = 5200;
  readonly gateMax = 5200;
  gateOpen = false;

  constructor(
    readonly spec: FortSpec,
    readonly field: Field,
  ) {
    const R = spec.ring;
    const n = R.length;
    // Wall-top heights, smoothed along the ring so the parapet walks, not jumps.
    const raw = R.map(([x, z]) => field.height(x, z) + spec.height);
    this.vTop = raw.map((_, i) => (raw[(i + n - 1) % n] + raw[i] * 2 + raw[(i + 1) % n]) / 4);
    let cx = 0;
    let cz = 0;
    for (const [x, z] of R) {
      cx += x;
      cz += z;
    }
    this.cx = cx / n;
    this.cz = cz / n;
    const [ax, az] = R[spec.gate];
    const [bx, bz] = R[(spec.gate + 1) % n];
    this.gateX = (ax + bx) / 2;
    this.gateZ = (az + bz) / 2;
    const l = Math.hypot(bx - ax, bz - az);
    let nxg = (bz - az) / l;
    let nzg = -(bx - ax) / l;
    if (nxg * (this.gateX - this.cx) + nzg * (this.gateZ - this.cz) < 0) {
      nxg = -nxg;
      nzg = -nzg;
    }
    this.gateNX = nxg;
    this.gateNZ = nzg;
    // The grid.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of R) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pad = 24;
    this.x0 = Math.floor(minX - pad);
    this.z0 = Math.floor(minZ - pad);
    this.nx = Math.ceil(maxX + pad - this.x0);
    this.nz = Math.ceil(maxZ + pad - this.z0);
    const N = this.nx * this.nz;
    this.zone = new Uint8Array(N);
    this.top = new Float32Array(N);
    this.dist = new Float32Array(N).fill(1e9);
    const half = spec.thick / 2;
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i + 0.5;
        const z = this.z0 + j + 0.5;
        let best = Infinity;
        let bs = 0;
        let bt = 0;
        for (let s = 0; s < n; s++) {
          const [px, pz] = R[s];
          const [qx, qz] = R[(s + 1) % n];
          const dx = qx - px;
          const dz = qz - pz;
          const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz)));
          const d = Math.hypot(x - px - dx * t, z - pz - dz * t);
          if (d < best) {
            best = d;
            bs = s;
            bt = t;
          }
        }
        const k = j * this.nx + i;
        const top = this.vTop[bs] * (1 - bt) + this.vTop[(bs + 1) % n] * bt;
        this.top[k] = top;
        this.dist[k] = best;
        const inside = this.inPoly(x, z);
        let zn = inside ? Z_IN : Z_OUT;
        if (best < half) zn = Z_WALL;
        // The gateway: the middle of the gate segment, a little wider than the wall is thick.
        if (bs === spec.gate && Math.abs(bt - 0.5) * l < 6 && best < half + 1.5) zn = Z_GATE;
        this.zone[k] = zn;
      }
  }

  /** Where the ground has been piled up to the wall top, anyone can walk over. */
  markRamps(): void {
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        if (this.zone[k] === Z_WALL && this.field.height(this.x0 + i + 0.5, this.z0 + j + 0.5) > this.top[k] - 2.2) this.zone[k] = Z_RAMP;
      }
  }

  private inPoly(x: number, z: number): boolean {
    const R = this.spec.ring;
    let c = false;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const [xi, zi] = R[i];
      const [xj, zj] = R[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  private cell(x: number, z: number): number {
    const i = Math.floor(x - this.x0);
    const j = Math.floor(z - this.z0);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  zoneAt(x: number, z: number): number {
    const k = this.cell(x, z);
    return k < 0 ? Z_OUT : this.zone[k];
  }

  get gatePassable(): boolean {
    return this.gateOpen || this.gateHp <= 0;
  }

  /** The height a man stands at: the wall walk, the bank behind it, or the ground. */
  stand(x: number, z: number): number {
    const g = this.field.height(x, z);
    const k = this.cell(x, z);
    if (k < 0) return g;
    const zn = this.zone[k];
    if (zn === Z_WALL || zn === Z_RAMP) return Math.max(g, this.top[k]);
    if (zn === Z_IN) {
      const d = this.dist[k] - this.spec.thick / 2;
      if (d < BANK) return Math.max(g, this.top[k] - (this.top[k] - g) * (d / BANK) ** 1.2);
    }
    return g;
  }

  wallTop(x: number, z: number): number {
    const k = this.cell(x, z);
    return k < 0 ? -1e9 : this.top[k];
  }

  /** Can a man of `side` step from zone a to zone b? */
  pass(a: number, b: number, side: number): boolean {
    if (a === b || b === Z_RAMP || a === Z_RAMP) return true;
    if (b === Z_GATE) return this.gatePassable;
    if (a === Z_GATE) return true;
    if (b === Z_WALL) return a === Z_IN;
    if (b === Z_IN) return a === Z_WALL;
    // b === Z_OUT: only from the gate or a ramp (handled above).
    void side;
    return false;
  }

  /** Is (x, z) held ground: inside the ring or on the wall. */
  within(x: number, z: number): boolean {
    const zn = this.zoneAt(x, z);
    return zn === Z_IN || zn === Z_WALL || zn === Z_GATE;
  }
}
