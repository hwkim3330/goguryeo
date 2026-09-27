/**
 * The known world of 6th–7th century Northeast Asia, drawn by hand from the modern map: the
 * coast from the Bohai gulf round the Liaodong peninsula and the whole Korean peninsula to the
 * Tumen, the Shandong promontory, the tip of Kyushu; the great rivers (요하, 압록강, 살수,
 * 대동강, 한강, 금강, 낙동강, 송화강, 두만강); the mountain ranges as ridgelines; the Liao marsh
 * (요택) that swallowed invading armies. Everything is in longitude/latitude, projected to a
 * flat map in kilometres, and cut into pointy-top hexes of 40 km across.
 */
import { Noise } from "../world/noise";

export const LON0 = 116;
export const LON1 = 131.5;
export const LAT0 = 33;
export const LAT1 = 46;
const KX = 111.32 * Math.cos((40 * Math.PI) / 180);
const KZ = 110.9;
export const MAP_W = (LON1 - LON0) * KX;
export const MAP_H = (LAT1 - LAT0) * KZ;

/** Longitude/latitude → map km (x east, z south, origin at the map's centre). */
export function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KX - MAP_W / 2, (LAT1 - lat) * KZ - MAP_H / 2];
}

/** The mainland and the peninsula, one ring, counter-clockwise from the south-west corner. */
const LAND: [number, number][] = [
  [115, 32], [120.3, 32], [120.3, 33], [119.4, 34.6], [119.9, 35.4], [120.4, 36.1], [121.0, 36.6], [122.5, 37.1], [122.5, 37.4], [121.4, 37.6], [120.6, 37.8], [119.5, 37.1],
  [119.0, 37.3], [118.8, 37.9], [118.5, 38.3], [117.7, 39.0], [118.4, 39.2], [119.6, 39.9], [120.8, 40.7], [121.6, 40.9], [122.2, 40.7], [121.9, 40.0],
  [121.5, 39.4], [121.2, 38.8], [121.7, 39.0], [122.5, 39.4], [123.5, 39.8], [124.4, 40.0], [124.9, 39.7], [125.2, 39.5], [125.1, 39.1], [125.3, 38.7],
  [124.8, 38.3], [125.0, 37.9], [125.6, 37.8], [126.2, 37.8], [126.6, 37.4], [126.7, 37.0], [126.2, 36.9], [126.1, 36.8], [126.5, 36.4], [126.6, 36.0],
  [126.4, 35.6], [126.4, 35.1], [126.3, 34.8], [126.5, 34.3], [127.2, 34.6], [127.7, 34.7], [128.4, 34.9], [129.0, 35.1], [129.4, 35.5], [129.5, 36.0],
  [129.4, 36.7], [129.4, 37.0], [129.1, 37.5], [128.9, 37.8], [128.5, 38.3], [127.9, 38.9], [127.5, 39.2], [127.6, 39.8], [128.3, 40.1], [128.8, 40.4],
  [129.2, 40.7], [129.7, 41.3], [129.8, 41.8], [130.3, 42.1], [130.7, 42.3], [131.1, 42.6], [131.5, 42.9], [132.5, 43.2], [132.5, 47], [115, 47], [115, 33],
];
const JEJU: [number, number][] = [[126.15, 33.3], [126.5, 33.2], [126.95, 33.4], [126.75, 33.55], [126.3, 33.5]];
const KYUSHU: [number, number][] = [[129.6, 32.0], [129.7, 33.4], [130.1, 33.6], [130.6, 33.9], [131.0, 33.95], [131.5, 33.9], [132.5, 33.9], [132.5, 32.0]];
const TSUSHIMA: [number, number][] = [[129.2, 34.1], [129.45, 34.3], [129.45, 34.7], [129.3, 34.6]];
export const LANDS = [LAND, JEJU, KYUSHU, TSUSHIMA];

export interface River {
  name: string;
  pts: [number, number][];
}
export const RIVERS: River[] = [
  { name: "요하", pts: [[122.4, 43.6], [123.3, 42.9], [123.6, 42.3], [123.2, 41.7], [122.7, 41.2], [122.2, 40.75]] },
  { name: "압록강", pts: [[128.0, 41.5], [127.2, 41.4], [126.3, 41.1], [125.6, 40.8], [125.0, 40.3], [124.35, 40.0]] },
  { name: "살수", pts: [[126.8, 40.1], [126.1, 39.9], [125.6, 39.7], [125.2, 39.55]] },
  { name: "대동강", pts: [[126.9, 39.6], [126.4, 39.3], [125.75, 39.02], [125.35, 38.75]] },
  { name: "한강", pts: [[128.6, 37.2], [128.0, 37.35], [127.35, 37.55], [126.8, 37.6], [126.55, 37.7]] },
  { name: "금강", pts: [[127.6, 35.9], [127.5, 36.4], [127.2, 36.45], [126.9, 36.28], [126.65, 36.0]] },
  { name: "낙동강", pts: [[128.9, 37.0], [128.5, 36.5], [128.4, 36.0], [128.6, 35.5], [128.95, 35.1]] },
  { name: "송화강", pts: [[127.9, 42.2], [126.9, 43.3], [126.5, 44.0], [125.9, 44.9], [126.3, 45.5], [127.3, 45.8], [128.5, 46.0]] },
  { name: "두만강", pts: [[128.2, 42.0], [129.0, 42.4], [129.8, 42.8], [130.4, 42.5], [130.7, 42.3]] },
  { name: "대릉하", pts: [[119.3, 41.2], [120.4, 41.5], [121.1, 41.3], [121.3, 40.9]] },
];

interface Range {
  pts: [number, number][];
  h: number;
  w: number;
}
const RANGES: Range[] = [
  { pts: [[126.0, 40.6], [127.5, 41.3], [128.1, 42.0], [129.0, 42.8], [130.3, 43.6], [131.3, 44.2]], h: 0.85, w: 0.8 },
  { pts: [[128.08, 42.0], [128.08, 42.0]], h: 1.3, w: 0.32 },
  { pts: [[126.9, 39.4], [127.2, 40.4], [127.0, 41.2]], h: 0.7, w: 0.45 },
  { pts: [[127.6, 39.0], [128.4, 38.0], [128.9, 37.2], [129.1, 36.2]], h: 0.72, w: 0.4 },
  { pts: [[128.8, 36.9], [128.0, 36.5], [127.6, 35.9], [127.5, 35.2]], h: 0.58, w: 0.32 },
  { pts: [[126.2, 38.4], [127.2, 38.8]], h: 0.3, w: 0.3 },
  { pts: [[121.8, 39.3], [123.2, 40.4], [124.4, 41.3], [125.4, 42.2], [126.5, 42.8]], h: 0.52, w: 0.6 },
  { pts: [[119.4, 42.0], [119.9, 44.0], [120.6, 46.0]], h: 0.6, w: 0.9 },
  { pts: [[116.0, 40.6], [117.5, 40.5], [119.0, 40.4], [119.8, 40.9]], h: 0.58, w: 0.45 },
  { pts: [[119.8, 41.5], [120.8, 42.5]], h: 0.4, w: 0.4 },
  { pts: [[128.2, 46.0], [129.4, 45.0]], h: 0.5, w: 0.8 },
  { pts: [[117.6, 36.2], [118.4, 36.5], [120.2, 36.9]], h: 0.36, w: 0.45 },
  { pts: [[126.8, 35.2], [127.0, 35.6]], h: 0.26, w: 0.3 },
  { pts: [[130.2, 44.5], [131.4, 45.6]], h: 0.4, w: 0.7 },
];

/** 요택: the marsh west of the Liao. */
const MARSH: [number, number, number][] = [
  [122.2, 41.45, 0.38],
  [122.7, 41.75, 0.3],
  [121.9, 41.1, 0.22],
];

function segDist(px: number, py: number, pts: [number, number][]): [number, number] {
  let best = Infinity;
  let bt = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    if (d < best) {
      best = d;
      bt = i + t;
    }
  }
  return [best, bt];
}

function inRing(lon: number, lat: number, R: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
    const [xi, yi] = R[i];
    const [xj, yj] = R[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

let PROJ: [number, number][][] | null = null;
/** Signed distance to the coast in km (positive on land), for a smooth shoreline. */
export function coastDist(lon: number, lat: number): number {
  PROJ ??= LANDS.map((R) => R.map(([a, b]) => project(a, b)));
  const [x, z] = project(lon, lat);
  let best = Infinity;
  for (const R of PROJ)
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const [ax, az] = R[j];
      const [bx, bz] = R[i];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const ex = x - ax - dx * t;
      const ez = z - az - dz * t;
      best = Math.min(best, ex * ex + ez * ez);
    }
  best = Math.sqrt(best);
  return isLand(lon, lat) ? best : -best;
}

export function isLand(lon: number, lat: number): boolean {
  return LANDS.some((r) => inRing(lon, lat, r));
}

const noise = new Noise(668);

/** Height above the sea, 0..~1.4, on land (continuous, for the terrain mesh). */
export function elevation(lon: number, lat: number): number {
  const x = lon * 1.3;
  const y = lat * 1.6;
  let h = 0.06 + noise.fbm(x * 0.9, y * 0.9, 4) * 0.12 + Math.max(0, noise.ridge(x * 0.7 + 5, y * 0.7, 4)) * 0.08;
  for (const r of RANGES) {
    const [d] = segDist(lon, lat, r.pts);
    const k = Math.max(0, 1 - d / r.w);
    h += r.h * k * k * (0.7 + 0.5 * noise.ridge(x * 2 + r.h * 9, y * 2, 3));
  }
  // The peninsula rises toward its east coast; eastern Manchuria is broken upland.
  if (lat > 34.5 && lat < 41) h += 0.2 * Math.max(0, Math.min(1, (lon - 126.4) / 1.8)) * Math.min(1, (41 - lat) / 1.2);
  if (lon > 126.8 && lat > 41.8) h += 0.12;
  // River valleys and the Liao plain lie low.
  for (const rv of RIVERS) {
    const [d] = segDist(lon, lat, rv.pts);
    if (d < 0.35) h *= 0.55 + 0.45 * (d / 0.35);
  }
  const plain = Math.hypot((lon - 122.8) / 1.4, (lat - 41.6) / 1.1);
  if (plain < 1) h *= 0.35 + 0.65 * plain;
  const song = Math.hypot((lon - 124.8) / 1.8, (lat - 44.8) / 1.4);
  if (song < 1) h *= 0.4 + 0.6 * song;
  return Math.max(0.02, h);
}

export function riverDist(lon: number, lat: number): number {
  let best = Infinity;
  for (const r of RIVERS) best = Math.min(best, segDist(lon, lat, r.pts)[0]);
  return best;
}

export function marshness(lon: number, lat: number): number {
  let m = 0;
  for (const [x, y, r] of MARSH) m = Math.max(m, 1 - Math.hypot((lon - x) / (r * 1.3), (lat - y) / r));
  return m;
}

/** Forest cover 0..1: the Manchurian and Korean uplands are wooded, the plains are farmed. */
export function forestness(lon: number, lat: number, h: number): number {
  const n = noise.fbm(lon * 2.4 + 3, lat * 2.4 - 1, 3);
  let f = (h - 0.18) * 1.6 + n * 0.6;
  if (lat > 42.3 && lon > 125.5) f += 0.45;
  if (lon < 120.8 && lat > 41.6) f -= 0.8; // the steppe
  if (lat < 37.5 && lon < 121) f -= 0.4; // the North China plain
  return Math.max(0, Math.min(1, f));
}

export function steppe(lon: number, lat: number): number {
  return Math.max(0, Math.min(1, (lat - 41.6) * 1.4)) * Math.max(0, Math.min(1, (121.2 - lon) * 1.2)) + Math.max(0, 1 - Math.hypot((lon - 124.6) / 1.6, (lat - 45.2) / 1.0)) * 0.7;
}

// ------------------------------------------------------------------ hexes

export type Terrain = "sea" | "plains" | "hills" | "mountains" | "forest" | "steppe" | "marsh";

export interface Hex {
  i: number;
  col: number;
  row: number;
  x: number;
  z: number;
  lon: number;
  lat: number;
  terrain: Terrain;
  elev: number;
  river: boolean;
  coast: boolean;
  /** Index of the named river running through, or -1. */
  riverId: number;
}

export const HEX_R = 23;
export const HEX_W = Math.sqrt(3) * HEX_R;
export const COLS = Math.ceil(MAP_W / HEX_W) + 1;
export const ROWS = Math.ceil(MAP_H / (HEX_R * 1.5)) + 1;

export function hexCentre(col: number, row: number): [number, number] {
  return [-MAP_W / 2 + HEX_W * (col + 0.5 * (row & 1)), -MAP_H / 2 + HEX_R * 1.5 * row];
}

export function unproject(x: number, z: number): [number, number] {
  return [LON0 + (x + MAP_W / 2) / KX, LAT1 - (z + MAP_H / 2) / KZ];
}

/** Which hex holds map point (x, z). */
export function hexAt(x: number, z: number): [number, number] {
  const px = x + MAP_W / 2;
  const pz = z + MAP_H / 2;
  let q = ((Math.sqrt(3) / 3) * px - (1 / 3) * pz) / HEX_R;
  let r = ((2 / 3) * pz) / HEX_R;
  let s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  q = rq;
  r = rr;
  s = -q - r;
  void s;
  return [q + (r - (r & 1)) / 2, r];
}

const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
export function neighbours(col: number, row: number): [number, number][] {
  const D = row & 1 ? DIRS_ODD : DIRS_EVEN;
  const out: [number, number][] = [];
  for (const [dc, dr] of D) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) out.push([c, r]);
  }
  return out;
}

function toCube(col: number, row: number): [number, number, number] {
  const q = col - (row - (row & 1)) / 2;
  return [q, row, -q - row];
}
export function hexDist(a: Hex, b: Hex): number {
  const [aq, ar, as] = toCube(a.col, a.row);
  const [bq, br, bs] = toCube(b.col, b.row);
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

export function buildHexes(): Hex[] {
  const hexes: Hex[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const [x, z] = hexCentre(col, row);
      const [lon, lat] = unproject(x, z);
      // Land if most of the hex is land (centre plus a ring of six samples).
      let landN = isLand(lon, lat) ? 2 : 0;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const [l2, t2] = unproject(x + Math.cos(a) * HEX_R * 0.7, z + Math.sin(a) * HEX_R * 0.7);
        if (isLand(l2, t2)) landN++;
      }
      const land = landN >= 4;
      const elev = land ? elevation(lon, lat) : 0;
      const rd = riverDist(lon, lat);
      let riverId = -1;
      if (land && rd < 0.16) {
        let best = Infinity;
        RIVERS.forEach((r, k) => {
          const d = segDist(lon, lat, r.pts)[0];
          if (d < best) {
            best = d;
            riverId = k;
          }
        });
      }
      let terrain: Terrain = "sea";
      if (land) {
        const f = forestness(lon, lat, elev);
        if (marshness(lon, lat) > 0.2) terrain = "marsh";
        else if (elev > 0.5) terrain = "mountains";
        else if (steppe(lon, lat) > 0.5 && elev < 0.36) terrain = "steppe";
        else if (f > 0.5) terrain = "forest";
        else if (elev > 0.25) terrain = "hills";
        else terrain = "plains";
      }
      hexes.push({ i: hexes.length, col, row, x, z, lon, lat, terrain, elev, river: riverId >= 0, riverId, coast: false });
    }
  for (const h of hexes) {
    if (h.terrain === "sea") continue;
    h.coast = neighbours(h.col, h.row).some(([c, r]) => hexes[r * COLS + c].terrain === "sea");
  }
  return hexes;
}
