/** Deterministic 2D noise (value + gradient fbm) for terrain, forests and scatter. */

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise {
  private readonly p = new Uint8Array(512);
  constructor(seed: number) {
    const R = rng(seed);
    const q = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = q[i & 255];
  }

  /** Gradient noise in [-1, 1]. */
  n2(x: number, y: number): number {
    const p = this.p;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const g = (h: number, a: number, b: number) => {
      const k = h & 7;
      const gx = k < 4 ? (k & 1 ? -1 : 1) : 0.7071 * (k & 1 ? -1 : 1);
      const gy = k < 4 ? 0 : 0.7071 * (k & 2 ? -1 : 1);
      return k < 4 ? (k & 2 ? gx * b : gx * a) : gx * a + gy * b;
    };
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const l1 = g(aa, x, y) + u * (g(ba, x - 1, y) - g(aa, x, y));
    const l2 = g(ab, x, y - 1) + u * (g(bb, x - 1, y - 1) - g(ab, x, y - 1));
    return (l1 + v * (l2 - l1)) * 1.4;
  }

  fbm(x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number {
    let s = 0;
    let a = 1;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      s += a * this.n2(x * f, y * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return s / norm;
  }

  /** Ridged fbm (sharp crests) in [0, 1]. */
  ridge(x: number, y: number, oct = 5): number {
    let s = 0;
    let a = 0.5;
    let f = 1;
    let w = 1;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(this.n2(x * f, y * f));
      v *= v * w;
      w = Math.min(1, v * 2);
      s += v * a;
      a *= 0.5;
      f *= 2.1;
    }
    return s;
  }
}

export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
`;
