/**
 * The map of 천하 as a relief model on a table: the land raised from the same elevation that
 * decides the hexes (mountains exaggerated), coloured by what grows there — farmland, steppe,
 * forest, marsh, bare rock and snow on 백두산 — with drifting cloud shadows; the sea over it;
 * the rivers as ribbons of water. The hex grid and the borders of each power are drawn in the
 * ground shader from a small texture (one texel per hex: owner, highlight), so they follow the
 * relief. Cities are little walled towns (palace for a capital, walls by level); armies are
 * figures with their standard; names float over both.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "../world/noise";
import { FACTION_IDS, FACTIONS, type FactionId } from "./data";
import { coastDist, COLS, elevation, forestness, HEX_R, hexAt, isLand, MAP_H, MAP_W, marshness, project, RIVERS, ROWS, steppe, unproject } from "./geo";
import type { Army, City, Game } from "./state";
import { TYPES } from "../sim/units";

export const VERT = 21;
const lin = (hex: number) => new THREE.Color(hex);

function hashNoise(): string {
  return /* glsl */ `
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p *= 2.03; a *= 0.5; } return s; }`;
}

export class MapView {
  readonly group = new THREE.Group();
  private readonly ownerTex: THREE.DataTexture;
  private readonly ownerData: Uint8Array;
  private readonly U = {
    uOwner: { value: null as THREE.DataTexture | null },
    uPal: { value: [] as THREE.Color[] },
    uGrid: { value: new THREE.Vector4(COLS, ROWS, HEX_R, MAP_W) },
    uMapH: { value: MAP_H },
    uTime: { value: 0 },
    uHover: { value: new THREE.Vector2(-1, -1) },
    uSel: { value: new THREE.Vector2(-1, -1) },
  };
  private readonly cityObjs = new Map<number, { g: THREE.Group; label: THREE.Sprite; key: string; flag: THREE.Mesh }>();
  private readonly armyObjs = new Map<number, { g: THREE.Group; label: THREE.Sprite; key: string; x: number; z: number }>();
  private readonly flagMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly selRing: THREE.Mesh;

  constructor(readonly game: Game) {
    this.ownerData = new Uint8Array(COLS * ROWS * 4);
    this.ownerTex = new THREE.DataTexture(this.ownerData, COLS, ROWS, THREE.RGBAFormat);
    this.ownerTex.magFilter = THREE.NearestFilter;
    this.ownerTex.minFilter = THREE.NearestFilter;
    this.ownerTex.needsUpdate = true;
    this.U.uOwner.value = this.ownerTex;
    this.U.uPal.value = [new THREE.Color(0x000000), ...FACTION_IDS.map((f) => lin(FACTIONS[f].color)), new THREE.Color(0x000000)];
    this.group.add(this.terrain());
    this.group.add(this.sea());
    this.group.add(this.rivers());
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(HEX_R * 0.62, HEX_R * 0.74, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.renderOrder = 5;
    this.selRing.visible = false;
    this.group.add(this.selRing);
    this.sync();
  }

  /** Height of the relief at map point (x, z). */
  heightAt(x: number, z: number): number {
    const [lon, lat] = unproject(x, z);
    return isLand(lon, lat) ? elevation(lon, lat) * VERT * 0.95 + 0.6 : -2;
  }

  private terrain(): THREE.Mesh {
    const nx = 420;
    const nz = 460;
    const g = new THREE.PlaneGeometry(MAP_W * 1.08, MAP_H * 1.08, nx, nz).rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const land = new Float32Array(n);
    const attr = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const [lon, lat] = unproject(x, z);
      const sd = coastDist(lon, lat);
      const l = sd > 0;
      land[k] = sd;
      const e = l ? elevation(lon, lat) : 0;
      attr[k * 4] = e;
      attr[k * 4 + 1] = l ? forestness(lon, lat, e) : 0;
      attr[k * 4 + 2] = l ? steppe(lon, lat) : 0;
      attr[k * 4 + 3] = l ? marshness(lon, lat) : 0;
    }
    const R = rng(9);
    for (let k = 0; k < n; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const sd = land[k];
      let y: number;
      // Land rises from the shore over a few km; the sea shelves down away from it.
      if (sd > 0) y = 0.25 + attr[k * 4] * VERT * Math.min(1, 0.2 + sd / 14) + Math.min(0.6, sd * 0.08);
      else y = Math.max(-9, sd * 0.32) - 0.15 - R() * 0.1;
      // The world ends in a haze at the table's edge.
      const ex = Math.abs(x) / (MAP_W / 2);
      const ez = Math.abs(z) / (MAP_H / 2);
      if (ex > 1 || ez > 1) y -= (Math.max(ex, ez) - 1) * 40;
      pos.setY(k, y);
      land[k] = Math.max(0, Math.min(1, 0.5 + sd / 3));
    }
    g.setAttribute("aTerr", new THREE.BufferAttribute(attr, 4));
    g.setAttribute("aLand", new THREE.BufferAttribute(land, 1));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    const U = this.U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aTerr; attribute float aLand; varying vec4 vTerr; varying float vLand; varying vec3 vW;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTerr = aTerr; vLand = aLand; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec4 vTerr; varying float vLand; varying vec3 vW;
uniform sampler2D uOwner; uniform vec3 uPal[8]; uniform vec4 uGrid; uniform float uMapH; uniform float uTime;
uniform vec2 uHover; uniform vec2 uSel;
${hashNoise()}
// World (x, z) → offset hex (col, row), and the distance to the hex's edge (0 at the edge).
vec3 hexOf(vec2 w) {
  float R = uGrid.z;
  vec2 p = w + vec2(uGrid.w, uMapH) * 0.5;
  float q = (0.57735027 * p.x - 0.33333333 * p.y) / R;
  float r = (0.66666667 * p.y) / R;
  vec3 c = vec3(q, r, -q - r);
  vec3 rc = floor(c + 0.5);
  vec3 d = abs(rc - c);
  if (d.x > d.y && d.x > d.z) rc.x = -rc.y - rc.z; else if (d.y > d.z) rc.y = -rc.x - rc.z; else rc.z = -rc.x - rc.y;
  float row = rc.y;
  float col = rc.x + (row - mod(row, 2.0)) * 0.5;
  // Centre of that hex, and the edge distance in a hexagon metric.
  vec2 ctr = vec2(R * 1.7320508 * (col + 0.5 * mod(row, 2.0)), R * 1.5 * row) - vec2(uGrid.w, uMapH) * 0.5;
  vec2 o = abs(w - ctr);
  float hexD = max(o.x, dot(o, vec2(0.5, 0.8660254)));
  float edge = R * 0.8660254 - hexD;
  return vec3(col, row, edge);
}
vec4 ownerAt(vec2 cr) {
  if (cr.x < 0.0 || cr.y < 0.0 || cr.x >= uGrid.x || cr.y >= uGrid.y) return vec4(0.0);
  return texture2D(uOwner, (cr + 0.5) / uGrid.xy);
}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float e = vTerr.x, f = vTerr.y, st = vTerr.z, ms = vTerr.w;
  vec2 w = vW.xz;
  float n = fbm2(w * 0.05);
  float n2 = fbm2(w * 0.3 + 7.0);
  vec3 farm = mix(pow(vec3(0.46, 0.55, 0.26), vec3(2.2)), pow(vec3(0.62, 0.6, 0.34), vec3(2.2)), n2);
  vec3 grass = pow(vec3(0.38, 0.5, 0.24), vec3(2.2));
  vec3 steppeC = pow(vec3(0.68, 0.62, 0.4), vec3(2.2));
  vec3 forestC = mix(pow(vec3(0.16, 0.28, 0.14), vec3(2.2)), pow(vec3(0.22, 0.34, 0.16), vec3(2.2)), n2);
  vec3 rock = pow(vec3(0.46, 0.42, 0.37), vec3(2.2));
  vec3 snow = vec3(0.86, 0.88, 0.92);
  vec3 marshC = pow(vec3(0.34, 0.42, 0.3), vec3(2.2));
  vec3 sand = pow(vec3(0.74, 0.68, 0.52), vec3(2.2));
  vec3 c = mix(farm, grass, smoothstep(0.1, 0.3, e + n * 0.1));
  c = mix(c, steppeC, smoothstep(0.35, 0.7, st + n * 0.2));
  c = mix(c, forestC, smoothstep(0.35, 0.65, f + (n2 - 0.5) * 0.25));
  c = mix(c, marshC, smoothstep(0.15, 0.4, ms));
  float slope = 1.0 - normalize(cross(dFdx(vW), dFdy(vW))).y;
  c = mix(c, rock, smoothstep(0.55, 0.85, e + n * 0.15) * 0.8 + smoothstep(0.25, 0.5, slope) * 0.5);
  c = mix(c, snow, smoothstep(1.02, 1.18, e + n * 0.1));
  c = mix(c, sand, smoothstep(1.2, 0.3, vW.y) * vLand);
  // Under water: pale sand shelf going dark.
  c = mix(pow(vec3(0.3, 0.42, 0.44), vec3(2.2)) * smoothstep(-9.0, -0.5, vW.y) + vec3(0.004, 0.012, 0.02), c, vLand);
  // Cloud shadows drifting east.
  float cl = smoothstep(0.52, 0.7, fbm2(w * 0.006 + vec2(uTime * 0.01, uTime * 0.004)));
  c *= 1.0 - cl * 0.35;
  // Hexes and borders.
  vec3 hx = hexOf(w);
  vec4 me = ownerAt(hx.xy);
  int oi = int(me.r * 255.0 + 0.5);
  vec3 oc = uPal[oi];
  float land = vLand;
  if (oi > 0) {
    // Territory wash, and a bright border where the neighbour across the edge differs.
    c = mix(c, oc, 0.16 * land);
    float bw = uGrid.z * 0.1;
    float onEdge = smoothstep(bw, bw * 0.3, hx.z);
    if (onEdge > 0.0) {
      // Step across the nearest edge.
      vec2 cc = vec2(uGrid.z * 1.7320508 * (hx.x + 0.5 * mod(hx.y, 2.0)), uGrid.z * 1.5 * hx.y) - vec2(uGrid.w, uMapH) * 0.5;
      vec2 dir = normalize(w - cc);
      vec3 other = hexOf(w + dir * bw * 1.2);
      int oo = int(ownerAt(other.xy).r * 255.0 + 0.5);
      if (oo != oi) c = mix(c, oc * 1.6 + 0.02, onEdge * 0.85 * land);
    }
  }
  // The faint grid.
  c *= 1.0 - smoothstep(uGrid.z * 0.035, 0.0, hx.z) * 0.22 * land;
  // Highlights: reachable (green), attack (red), hover, selection.
  int hl = int(me.g * 255.0 + 0.5);
  if (hl == 1) c = mix(c, vec3(0.3, 0.75, 0.35), 0.28);
  if (hl == 2) c = mix(c, vec3(0.9, 0.2, 0.12), 0.35);
  if (hl == 3) c = mix(c, vec3(0.9, 0.75, 0.3), 0.32);
  if (me.b > 0.5) c *= 0.62;
  if (abs(hx.x - uHover.x) < 0.5 && abs(hx.y - uHover.y) < 0.5) c += vec3(0.05, 0.045, 0.03) * smoothstep(uGrid.z * 0.25, 0.0, hx.z) * 3.0 + 0.012;
  diffuseColor.rgb = c;
}`,
        );
    };
    mat.customProgramCacheKey = () => "campaign-ground";
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  private sea(): THREE.Mesh {
    const g = new THREE.PlaneGeometry(MAP_W * 8, MAP_H * 8, 1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a4a62, roughness: 0.28, metalness: 0.05, transparent: true, opacity: 0.8, depthWrite: false });
    const U = this.U;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW2;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvW2 = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vW2; uniform float uTime;\n${hashNoise()}`)
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
{
  vec2 p = vW2.xz * 0.08;
  float a = fbm2(p + vec2(uTime * 0.05, 0.0));
  float b = fbm2(p * 1.7 - vec2(0.0, uTime * 0.04));
  vec3 bump = vec3((a - 0.5) * 0.35, 1.0, (b - 0.5) * 0.35);
  normal = normalize((viewMatrix * vec4(normalize(bump), 0.0)).xyz);
}`,
        );
    };
    mat.customProgramCacheKey = () => "campaign-sea";
    const m = new THREE.Mesh(g, mat);
    m.position.y = 0;
    m.renderOrder = 2;
    return m;
  }

  private rivers(): THREE.Mesh {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of RIVERS) {
      const pts = r.pts.map(([lon, lat]) => project(lon, lat));
      // Resample and wiggle.
      const dense: [number, number][] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(2, Math.ceil(L / 3));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const nx = -(bz - az) / L;
          const nz = (bx - ax) / L;
          const w = Math.sin((i * 7 + s) * 0.9) * 1.6 + Math.sin((i * 3 + s) * 0.37) * 2.4;
          dense.push([ax + (bx - ax) * t + nx * w, az + (bz - az) * t + nz * w]);
        }
      }
      dense.push(pts[pts.length - 1]);
      const pos: number[] = [];
      for (let i = 0; i + 1 < dense.length; i++) {
        const [ax, az] = dense[i];
        const [bx, bz] = dense[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = -(bz - az) / L;
        const nz = (bx - ax) / L;
        const wa = 0.6 + (i / dense.length) * 1.6;
        const wb = 0.6 + ((i + 1) / dense.length) * 1.6;
        const ya = this.heightAt(ax, az) + 0.25;
        const yb = this.heightAt(bx, bz) + 0.25;
        const A = [ax + nx * wa, ya, az + nz * wa];
        const B = [ax - nx * wa, ya, az - nz * wa];
        const C = [bx - nx * wb, yb, bz - nz * wb];
        const D = [bx + nx * wb, yb, bz + nz * wb];
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      parts.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    return m;
  }

  // ------------------------------------------------------------------ cities and armies

  private flagMat(f: FactionId): THREE.MeshStandardMaterial {
    const key = `${f}|${this.game.tang}`;
    let m = this.flagMats.get(key);
    if (m) return m;
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 80;
    const g = c.getContext("2d")!;
    const col = "#" + FACTIONS[f].color.toString(16).padStart(6, "0");
    g.fillStyle = col;
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = "rgba(255,240,200,0.9)";
    g.font = "900 54px 'Noto Serif KR', serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const ch = f === "goguryeo" ? "高" : f === "sui" ? (this.game.tang ? "唐" : "隋") : FACTIONS[f].hanja[0];
    g.fillText(ch, 64, 44);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 });
    this.flagMats.set(key, m);
    return m;
  }

  private label(text: string, sub: string, color: number, big = false): THREE.Sprite {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 96;
    const g = c.getContext("2d")!;
    const col = new THREE.Color(color);
    g.fillStyle = `rgba(${(col.r * 90) | 0},${(col.g * 90) | 0},${(col.b * 90) | 0},0.82)`;
    g.beginPath();
    g.roundRect(10, 8, 300, sub ? 76 : 54, 12);
    g.fill();
    g.strokeStyle = "#" + col.getHexString();
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#fff4dc";
    g.font = `${big ? 900 : 700} ${big ? 34 : 30}px 'Noto Serif KR', serif`;
    g.textAlign = "center";
    g.fillText(text, 160, 44);
    if (sub) {
      g.font = "600 20px 'Noto Serif KR', serif";
      g.fillStyle = "#e8d8b8";
      g.fillText(sub, 160, 72);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.renderOrder = 20;
    s.scale.set(32, 9.6, 1);
    return s;
  }

  private cityModel(c: City): { g: THREE.Group; flag: THREE.Mesh } {
    const g = new THREE.Group();
    const R = rng(c.id * 13 + 5);
    const r = 3.2 + c.pop * 0.32;
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.9 });
    if (c.walls > 0) {
      const wh = 0.8 + c.walls * 0.45;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, wh, 28, 1, true), stone);
      wall.material.side = THREE.DoubleSide;
      wall.position.y = wh / 2;
      g.add(wall);
      for (let k = 0; k < (c.walls >= 3 ? 8 : 4); k++) {
        const a = (k / (c.walls >= 3 ? 8 : 4)) * Math.PI * 2;
        const tw = new THREE.Mesh(new THREE.BoxGeometry(1.1, wh + 0.5, 1.1), stone);
        tw.position.set(Math.cos(a) * r, (wh + 0.5) / 2, Math.sin(a) * r);
        g.add(tw);
      }
    } else {
      // A palisade of tents and yurts for the tribes.
      for (let k = 0; k < 3 + c.pop; k++) {
        const a = R() * Math.PI * 2;
        const d = R() * r * 0.8;
        const y = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.9 }));
        y.position.set(Math.cos(a) * d, 0.4, Math.sin(a) * d);
        const top = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.9 }));
        top.position.y = 0.75;
        y.add(top);
        g.add(y);
      }
    }
    // Houses.
    const houseBody = new THREE.BoxGeometry(1.4, 0.8, 1.0).translate(0, 0.4, 0);
    const roof = new THREE.ConeGeometry(1.15, 0.7, 4).rotateY(Math.PI / 4).scale(1.25, 1, 0.9).translate(0, 1.15, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3e4248, roughness: 0.6 });
    if (c.walls > 0)
      for (let k = 0; k < 4 + c.pop * 2; k++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R()) * r * 0.78;
        const hb = new THREE.Mesh(houseBody, bodyMat);
        hb.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
        hb.rotation.y = Math.round(R() * 2) * (Math.PI / 2);
        const hr = new THREE.Mesh(roof, roofMat);
        hb.add(hr);
        g.add(hb);
      }
    if (c.capital) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 2.4).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.7 }));
      const hroof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 4).rotateY(Math.PI / 4).scale(1.4, 1, 0.9).translate(0, 2.4, 0), roofMat);
      hall.add(hroof);
      g.add(hall);
      // A pagoda.
      for (let k = 0; k < 5; k++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(1.1 - k * 0.15, 0.5, 8), roofMat);
        t.position.set(r * 0.5, 1.2 + k * 0.7, -r * 0.3);
        g.add(t);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55 - k * 0.07, 0.6 - k * 0.07, 0.5, 8), bodyMat);
        b.position.set(r * 0.5, 0.9 + k * 0.7, -r * 0.3);
        g.add(b);
      }
    }
    // The standard.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 7, 5), new THREE.MeshStandardMaterial({ color: 0x3a2618 }));
    pole.position.set(-r * 0.4, 3.5, r * 0.2);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2).translate(1.6, 0, 0), this.flagMat(c.owner));
    flag.position.set(-r * 0.4, 6, r * 0.2);
    g.add(flag);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return { g, flag };
  }

  private armyModel(a: Army): THREE.Group {
    const g = new THREE.Group();
    const col = lin(FACTIONS[a.owner].color);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.8, 24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.2 }));
    base.position.y = 0.4;
    g.add(base);
    const mounted = a.units.filter((u) => TYPES[u.type].mounted).length > a.units.length / 2;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.5, metalness: 0.5 });
    const cloth = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.85 });
    const horseM = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.7 });
    const fig = new THREE.Group();
    if (mounted) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.4, 4, 10).rotateX(Math.PI / 2), horseM);
      body.position.y = 2.6;
      fig.add(body);
      const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.4, 4, 8).rotateX(-0.7), horseM);
      neck.position.set(0, 3.6, 1.7);
      fig.add(neck);
      for (const [x, z] of [
        [-0.5, 1.1],
        [0.5, 1.1],
        [-0.5, -1.1],
        [0.5, -1.1],
      ]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 2.0, 6), horseM);
        leg.position.set(x, 1.3, z);
        fig.add(leg);
      }
      const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.4, 4, 8), cloth);
      rider.position.set(0, 4.4, -0.2);
      fig.add(rider);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), dark);
      helm.position.set(0, 5.6, -0.2);
      fig.add(helm);
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.0, 4, 10), cloth);
      body.position.y = 2.6;
      fig.add(body);
      const armour = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 1.4, 10), dark);
      armour.position.y = 2.4;
      fig.add(armour);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), dark);
      helm.position.y = 4.3;
      fig.add(helm);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a4a2a }));
      shield.position.set(-0.9, 2.6, 0.5);
      fig.add(shield);
    }
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 8, 5), new THREE.MeshStandardMaterial({ color: 0x5a4028 }));
    spear.position.set(1.0, mounted ? 5.2 : 3.6, 0.3);
    fig.add(spear);
    fig.position.y = 0.8;
    g.add(fig);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.0).translate(1.5, 0, 0), this.flagMat(a.owner));
    flag.position.set(1.0, (mounted ? 5.2 : 3.6) + 3.4, 0.3);
    g.add(flag);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return g;
  }

  /** Bring the models in line with the game state. */
  sync(): void {
    const G = this.game;
    for (const c of G.cities) {
      const here = G.armiesAt(c.hex).find((a) => a.owner === c.owner);
      const hereTxt = here ? `${here.general} ${here.units.reduce((s, u) => s + u.men, 0)}명` : "";
      const key = `${c.owner}|${c.walls}|${c.pop}|${c.capital}|${G.tang}|${c.besieged > 0}|${hereTxt}`;
      const o = this.cityObjs.get(c.id);
      if (o && o.key === key) continue;
      if (o) {
        this.group.remove(o.g, o.label);
      }
      const h = G.hexes[c.hex];
      const { g, flag } = this.cityModel(c);
      g.position.set(h.x, this.heightAt(h.x, h.z) - 0.2, h.z);
      g.scale.setScalar(1.25);
      const label = this.label(c.name, hereTxt ? `⚑ ${hereTxt}` : `${c.pop}만 호${c.walls ? ` · 성벽 ${c.walls}` : ""}${c.besieged ? " · 포위" : ""}`, FACTIONS[c.owner].color, c.capital);
      label.position.set(h.x, g.position.y + 16, h.z);
      this.group.add(g, label);
      this.cityObjs.set(c.id, { g, label, key, flag });
    }
    const live = new Set(G.armies.map((a) => a.id));
    for (const [id, o] of this.armyObjs)
      if (!live.has(id)) {
        this.group.remove(o.g, o.label);
        this.armyObjs.delete(id);
      }
    for (const a of G.armies) {
      const men = a.units.reduce((s, u) => s + u.men, 0);
      const key = `${a.owner}|${a.general}|${men}|${a.units.length}|${G.tang}|${a.siege}`;
      let o = this.armyObjs.get(a.id);
      const h = G.hexes[a.hex];
      if (!o || o.key.split("|").slice(0, 1).join() !== key.split("|").slice(0, 1).join()) {
        if (o) this.group.remove(o.g, o.label);
        const g = this.armyModel(a);
        g.position.set(h.x, this.heightAt(h.x, h.z), h.z);
        o = { g, label: new THREE.Sprite(), key: "", x: h.x, z: h.z };
        this.group.add(g);
        this.armyObjs.set(a.id, o);
      }
      if (o.key !== key) {
        this.group.remove(o.label);
        o.label = this.label(a.general, `${men.toLocaleString()}명 · ${a.units.length}부대${a.siege >= 0 ? " · 포위 중" : ""}`, FACTIONS[a.owner].color);
        o.label.scale.multiplyScalar(0.8);
        this.group.add(o.label);
        o.key = key;
      }
    }
    this.refreshOwners();
  }

  /** Territory and highlights into the per-hex texture. */
  refreshOwners(highlight?: Map<number, number>, visible?: Set<number>): void {
    const G = this.game;
    const d = this.ownerData;
    for (let i = 0; i < G.hexes.length; i++) {
      const o = G.owner[i];
      d[i * 4] = o ? FACTION_IDS.indexOf(o) + 1 : 0;
      d[i * 4 + 1] = highlight?.get(i) ?? 0;
      d[i * 4 + 2] = visible && !visible.has(i) ? 255 : 0;
      d[i * 4 + 3] = 255;
    }
    this.ownerTex.needsUpdate = true;
  }

  setSelected(hex: number | null): void {
    if (hex === null) {
      this.selRing.visible = false;
      return;
    }
    const h = this.game.hexes[hex];
    this.selRing.visible = true;
    this.selRing.position.set(h.x, this.heightAt(h.x, h.z) + 0.6, h.z);
  }

  setHover(hex: number | null): void {
    if (hex === null) this.U.uHover.value.set(-1, -1);
    else {
      const h = this.game.hexes[hex];
      this.U.uHover.value.set(h.col, h.row);
    }
  }

  /** Per frame: glide armies to their hexes, keep labels a readable size, hide unseen foes. */
  update(dt: number, t: number, cam: THREE.Camera, visible: Set<number>): void {
    this.U.uTime.value = t;
    const G = this.game;
    const camPos = cam.position;
    for (const a of G.armies) {
      const o = this.armyObjs.get(a.id);
      if (!o) continue;
      const h = G.hexes[a.hex];
      // Two armies in one hex (a siege from the next hex doesn't count) stand apart.
      const k = Math.min(1, dt * 5);
      o.x += (h.x - o.x) * k;
      o.z += (h.z - o.z) * k;
      const inCity = G.cityAt(a.hex);
      const ox = inCity ? 7 : 0;
      o.g.position.set(o.x + ox, this.heightAt(o.x, o.z) + (inCity ? 1.2 : 0), o.z + (inCity ? 5 : 0));
      const moving = Math.hypot(h.x - o.x, h.z - o.z) > 0.5;
      o.g.rotation.y = moving ? Math.atan2(h.x - o.x, h.z - o.z) : o.g.rotation.y;
      const seen = a.owner === G.player || visible.has(a.hex);
      o.g.visible = seen;
      o.label.visible = seen && !(inCity && inCity.owner === a.owner);
      const dist = camPos.distanceTo(o.g.position);
      const sc = Math.max(0.5, Math.min(3, dist / 260));
      o.g.scale.setScalar(Math.max(1, Math.min(2.6, dist / 360)));
      o.label.scale.set(32 * 0.8 * sc, 9.6 * 0.8 * sc, 1);
      o.label.position.set(o.g.position.x, o.g.position.y + 14 * o.g.scale.x + 4 * sc, o.g.position.z);
    }
    for (const c of G.cities) {
      const o = this.cityObjs.get(c.id)!;
      const dist = camPos.distanceTo(o.g.position);
      const sc = Math.max(0.55, Math.min(3.2, dist / 260));
      const k = c.capital ? 1.15 : 1;
      o.label.scale.set(32 * sc * k, 9.6 * sc * k, 1);
      o.label.position.y = o.g.position.y + 12 + 6 * sc;
      o.g.scale.setScalar(1.25 * Math.max(1, Math.min(2.2, dist / 420)));
      o.flag.rotation.y = Math.sin(t * 1.3 + c.id) * 0.25;
    }
    this.selRing.rotation.y += dt * 0.6;
  }
}

export function hexUnder(x: number, z: number): [number, number] {
  return hexAt(x, z);
}
