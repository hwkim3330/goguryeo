/**
 * Drawing the fortress: the stone face in receding courses, the wall walk and the earth bank
 * behind it, a parapet with merlons (여장) along the outer edge, square bastions (치), the gate
 * with its lintel, doors and gatehouse pavilion (문루) with a tiled hip roof, tiled houses and
 * granaries inside, and — while a siege is on — ladders against the wall and battering rams.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Battle } from "../sim/battle";
import { BANK, type Fort, Z_IN } from "./fort";
import { rng } from "./noise";

function stoneTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6a6258";
  g.fillRect(0, 0, W, H);
  const R = rng(77);
  // Courses of dressed granite blocks, each a little different.
  const rows = 8;
  const rh = H / rows;
  for (let r = 0; r < rows; r++) {
    let x = -R() * 40;
    while (x < W) {
      const w = 34 + R() * 46;
      const l = 38 + R() * 20;
      g.fillStyle = `hsl(${30 + R() * 14}, ${8 + R() * 10}%, ${l}%)`;
      g.fillRect(x + 1.5, r * rh + 1.5, w - 3, rh - 3);
      // Weathering.
      g.fillStyle = `rgba(40,36,30,${0.12 + R() * 0.2})`;
      g.fillRect(x + 1.5, r * rh + rh - 7, w - 3, 5.5);
      g.fillStyle = `rgba(255,250,235,${0.05 + R() * 0.08})`;
      g.fillRect(x + 1.5, r * rh + 1.5, w - 3, 3);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(${R() < 0.5 ? "30,28,24" : "210,200,180"},${0.06 + R() * 0.08})`;
        g.fillRect(x + R() * w, r * rh + R() * rh, 2 + R() * 6, 1 + R() * 3);
      }
      x += w;
    }
  }
  // Moss and dark streaks toward the bottom of the tile.
  for (let k = 0; k < 160; k++) {
    g.fillStyle = `rgba(${50 + R() * 20},${64 + R() * 20},${34},${0.05 + R() * 0.07})`;
    g.fillRect(R() * W, H * 0.5 + R() * H * 0.5, 3 + R() * 12, 2 + R() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

class Mesher {
  pos: number[] = [];
  uv: number[] = [];
  constructor(readonly flip = false) {}
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]): void {
    const tri: [THREE.Vector3, [number, number]][] = [
      [a, ua],
      [b, ub],
      [c, uc],
      [a, ua],
      [c, uc],
      [d, ud],
    ];
    if (this.flip) tri.reverse();
    for (const [p, u] of tri) {
      this.pos.push(p.x, p.y, p.z);
      this.uv.push(u[0], u[1]);
    }
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A tiled hip roof over a w × d footprint, eaves overhanging, ridge along x. */
function hipRoof(w: number, d: number, h: number, color: number): THREE.BufferGeometry {
  const o = 1.25;
  const W = w / 2 + o;
  const D = d / 2 + o;
  const r = w / 2 - d / 4;
  const m = new Mesher();
  const e = -0.25; // eaves tip up a little at the corners
  const A = V(-W, e, -D);
  const B = V(W, e, -D);
  const C = V(W, e, D);
  const Dd = V(-W, e, D);
  const P = V(-r, h, 0);
  const Q = V(r, h, 0);
  m.quad(A, P, Q, B, [0, 0], [0.3, 1], [0.7, 1], [1, 0]);
  m.quad(C, Q, P, Dd, [0, 0], [0.3, 1], [0.7, 1], [1, 0]);
  m.quad(B, Q, Q, C, [0, 0], [0.5, 1], [0.5, 1], [1, 0]);
  m.quad(Dd, P, P, A, [0, 0], [0.5, 1], [0.5, 1], [1, 0]);
  const g = m.geo();
  const col = new THREE.Color(color);
  const cols: number[] = [];
  for (let i = 0; i < g.attributes.position.count; i++) cols.push(col.r, col.g, col.b);
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

function tinted(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const gg = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(color);
  const cols: number[] = [];
  for (let i = 0; i < gg.attributes.position.count; i++) cols.push(col.r, col.g, col.b);
  gg.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  if (!gg.attributes.uv) gg.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
  return gg;
}

export class FortView {
  readonly group = new THREE.Group();
  private readonly doors: THREE.Group;
  private readonly ladders: THREE.InstancedMesh;
  private readonly rams = new Map<number, THREE.Group>();
  private readonly ramGeo: THREE.BufferGeometry;
  private readonly woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

  constructor(
    readonly fort: Fort,
    readonly b: Battle,
  ) {
    const f = fort;
    const field = f.field;
    const R = f.spec.ring;
    const n = R.length;
    const half = f.spec.thick / 2;
    // Orientation: outward normal of each segment.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [ax, az] = R[i];
      const [bx, bz] = R[(i + 1) % n];
      area += ax * bz - bx * az;
    }
    const sgn = area > 0 ? -1 : 1;
    // The ring may run either way round; wind the faces so they look outward / upward.
    const face = new Mesher(sgn > 0);
    const walk = new Mesher(sgn < 0);
    const bank = new Mesher(sgn > 0);
    const merlon: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const gateW = 12;
    const lintel = 4.8;
    let along = 0;
    for (let s = 0; s < n; s++) {
      const [ax, az] = R[s];
      const [bx, bz] = R[(s + 1) % n];
      const L = Math.hypot(bx - ax, bz - az);
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      const ox = tz * sgn;
      const oz = -tx * sgn;
      const t0 = f.vTop[s];
      const t1 = f.vTop[(s + 1) % n];
      const steps = Math.max(2, Math.ceil(L / 4));
      for (let k = 0; k < steps; k++) {
        const u0 = k / steps;
        const u1 = (k + 1) / steps;
        const m0 = u0 * L;
        const m1 = u1 * L;
        const isGate = s === f.spec.gate && Math.abs((m0 + m1) / 2 - L / 2) < gateW / 2;
        const p0x = ax + tx * m0;
        const p0z = az + tz * m0;
        const p1x = ax + tx * m1;
        const p1z = az + tz * m1;
        const top0 = t0 + (t1 - t0) * u0;
        const top1 = t0 + (t1 - t0) * u1;
        const g0 = Math.min(field.height(p0x + ox * (half + 1.5), p0z + oz * (half + 1.5)), field.height(p0x, p0z)) - 2.5;
        const g1 = Math.min(field.height(p1x + ox * (half + 1.5), p1z + oz * (half + 1.5)), field.height(p1x, p1z)) - 2.5;
        const ua = (along + m0) / 5;
        const ub = (along + m1) / 5;
        // Outer face: battered (wider at the foot), textured in courses.
        const batter = 1.4;
        const bot0 = isGate ? top0 - lintel : g0;
        const bot1 = isGate ? top1 - lintel : g1;
        const bo = isGate ? 0 : batter;
        face.quad(
          V(p0x + ox * (half + bo), bot0, p0z + oz * (half + bo)),
          V(p0x + ox * half, top0, p0z + oz * half),
          V(p1x + ox * half, top1, p1z + oz * half),
          V(p1x + ox * (half + bo), bot1, p1z + oz * (half + bo)),
          [ua, bot0 / 3],
          [ua, top0 / 3],
          [ub, top1 / 3],
          [ub, bot1 / 3],
        );
        if (isGate) {
          // The lintel's underside and the gateway's inner face.
          face.quad(V(p0x - ox * half, bot0, p0z - oz * half), V(p0x + ox * half, bot0, p0z + oz * half), V(p1x + ox * half, bot1, p1z + oz * half), V(p1x - ox * half, bot1, p1z - oz * half), [ua, 0], [ua, 1], [ub, 1], [ub, 0]);
          face.quad(V(p1x - ox * half, bot1, p1z - oz * half), V(p1x - ox * half, top1, p1z - oz * half), V(p0x - ox * half, top0, p0z - oz * half), V(p0x - ox * half, bot0, p0z - oz * half), [ub, bot1 / 3], [ub, top1 / 3], [ua, top0 / 3], [ua, bot0 / 3]);
        }
        // Wall walk.
        walk.quad(V(p0x + ox * half, top0, p0z + oz * half), V(p0x - ox * half, top0, p0z - oz * half), V(p1x - ox * half, top1, p1z - oz * half), V(p1x + ox * half, top1, p1z + oz * half), [0, ua], [1, ua], [1, ub], [0, ub]);
        // Earth bank behind, sloping down to the ground inside (not over the gateway).
        if (!isGate) {
          const B = 5;
          for (let r = 0; r < B; r++) {
            const d0 = half + (BANK * r) / B;
            const d1 = half + (BANK * (r + 1)) / B;
            const y = (px: number, pz: number, d: number) => (r === 0 && d === half ? f.vTop[s] + (t1 - t0) * ((px - ax) * tx + (pz - az) * tz) / L : field.stand(px - ox * d, pz - oz * d));
            const a0 = y(p0x, p0z, d0);
            const a1 = y(p1x, p1z, d0);
            const c0 = y(p0x, p0z, d1);
            const c1 = y(p1x, p1z, d1);
            bank.quad(V(p0x - ox * d0, r === 0 ? top0 : a0, p0z - oz * d0), V(p0x - ox * d1, c0 - (r === B - 1 ? 0.6 : 0), p0z - oz * d1), V(p1x - ox * d1, c1 - (r === B - 1 ? 0.6 : 0), p1z - oz * d1), V(p1x - ox * d0, r === 0 ? top1 : a1, p1z - oz * d0), [ua, d0 / 4], [ua, d1 / 4], [ub, d1 / 4], [ub, d0 / 4]);
          }
        }
        // Parapet: a low wall along the outer edge with merlons.
        const segL = m1 - m0;
        const mx = (p0x + p1x) / 2 + ox * (half - 0.35);
        const mz = (p0z + p1z) / 2 + oz * (half - 0.35);
        const my = (top0 + top1) / 2;
        const yaw = Math.atan2(tx, tz);
        q.setFromEuler(new THREE.Euler(0, yaw, 0));
        merlon.push(new THREE.Matrix4().compose(V(mx, my + 0.35, mz), q, V(0.7, 0.7, segL + 0.05)));
        for (let e = 0.8; e < segL; e += 2.6) {
          const px = p0x + tx * e + ox * (half - 0.35);
          const pz = p0z + tz * e + oz * (half - 0.35);
          merlon.push(new THREE.Matrix4().compose(V(px, top0 + (top1 - top0) * ((m0 + e) / L - u0) * (1 / (u1 - u0)) * (u1 - u0) + 1.05, pz), q, V(0.72, 0.75, 1.5)));
        }
      }
      along += L;
    }
    const stone = stoneTexture();
    const stoneMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92, color: 0xd8d0c4 });
    const faceMesh = new THREE.Mesh(face.geo(), stoneMat);
    const walkMesh = new THREE.Mesh(walk.geo(), new THREE.MeshStandardMaterial({ color: 0x7c7266, roughness: 0.95 }));
    const bankMesh = new THREE.Mesh(bank.geo(), new THREE.MeshStandardMaterial({ color: 0x5f6a3a, roughness: 1 }));
    for (const m of [faceMesh, walkMesh, bankMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mer = new THREE.InstancedMesh(box, stoneMat, merlon.length);
    merlon.forEach((m, k) => mer.setMatrixAt(k, m));
    mer.castShadow = mer.receiveShadow = true;
    this.group.add(mer);
    // Bastions (치): square towers jutting out, every third corner away from the gate.
    const bastions = new THREE.Group();
    for (let i = 0; i < n; i++) {
      if (i % 3 !== 1 || Math.abs(i - f.spec.gate) <= 1 || Math.abs(i - f.spec.gate - 1) <= 1) continue;
      const [px, pz] = R[i];
      const [ax, az] = R[(i + n - 1) % n];
      const [bx, bz] = R[(i + 1) % n];
      let dx = (bz - az) * sgn;
      let dz = -(bx - ax) * sgn;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      const top = f.vTop[i] + 0.2;
      const bot = field.height(px + dx * 6, pz + dz * 6) - 3;
      const h = top - bot;
      const tw = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), stoneMat);
      tw.position.set(px + dx * 4.5, bot + h / 2, pz + dz * 4.5);
      tw.rotation.y = Math.atan2(dx, dz);
      tw.castShadow = tw.receiveShadow = true;
      bastions.add(tw);
      for (const [mx2, mz2] of [
        [-3.4, 3.4],
        [0, 3.4],
        [3.4, 3.4],
        [-3.4, 0],
        [3.4, 0],
      ]) {
        const mm = new THREE.Mesh(box, stoneMat);
        mm.scale.set(1.4, 1.1, 0.8);
        mm.position.set(mx2, h / 2 + 0.55, mz2);
        if (mz2 === 0) mm.scale.set(0.8, 1.1, 1.4);
        tw.add(mm);
      }
    }
    this.group.add(bastions);
    // The gate: flanking towers, doors, and the pavilion.
    {
      const nx = f.gateNX;
      const nz = f.gateNZ;
      const gx = f.gateX;
      const gz = f.gateZ;
      const yaw = Math.atan2(nx, nz);
      const top = f.wallTop(gx - nx * 0.5, gz - nz * 0.5) > -1e8 ? f.wallTop(gx - nx * 0.5, gz - nz * 0.5) : f.vTop[f.spec.gate];
      const ground = field.height(gx, gz);
      const tx = -nz;
      const tz = nx;
      for (const sd of [-1, 1]) {
        const bot = field.height(gx + tx * sd * 10, gz + tz * sd * 10) - 3;
        const h = top + 0.6 - bot;
        const tw = new THREE.Mesh(new THREE.BoxGeometry(8, h, 10), stoneMat);
        tw.position.set(gx + tx * sd * 10 + nx * 1.5, bot + h / 2, gz + tz * sd * 10 + nz * 1.5);
        tw.rotation.y = yaw;
        tw.castShadow = tw.receiveShadow = true;
        this.group.add(tw);
      }
      // Pavilion (문루): a timber hall with red pillars under a hip roof.
      const pav = new THREE.Group();
      pav.position.set(gx, top, gz);
      pav.rotation.y = yaw + Math.PI / 2;
      const pillarG = new THREE.CylinderGeometry(0.28, 0.32, 3.6, 8);
      const red = new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.7 });
      for (const px of [-7, -3.5, 0, 3.5, 7])
        for (const pz of [-3, 3]) {
          const p = new THREE.Mesh(pillarG, red);
          p.position.set(px, 1.8, pz);
          p.castShadow = true;
          pav.add(p);
        }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.8, 7), new THREE.MeshStandardMaterial({ color: 0x2a5a4a, roughness: 0.75 }));
      beam.position.y = 3.9;
      pav.add(beam);
      const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
      const roof = new THREE.Mesh(hipRoof(15, 7, 3.2, 0x3a3c40), roofMat);
      roof.position.y = 4.3;
      roof.castShadow = true;
      pav.add(roof);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.5, 7.4), new THREE.MeshStandardMaterial({ color: 0x6a5a48 }));
      flag.position.y = 0.2;
      pav.add(flag);
      this.group.add(pav);
      // Doors: two leaves of heavy planks with iron studs.
      this.doors = new THREE.Group();
      this.doors.position.set(gx, ground, gz);
      this.doors.rotation.y = yaw + Math.PI / 2;
      const leafG = new THREE.BoxGeometry(6, top - lintel - ground + 0.2, 0.5).translate(3, (top - lintel - ground + 0.2) / 2, 0);
      const wood = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 });
      for (const sd of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(-6 * sd, 0, 0);
        const leaf = new THREE.Mesh(leafG, wood);
        leaf.scale.x = sd;
        leaf.castShadow = true;
        hinge.add(leaf);
        this.doors.add(hinge);
      }
      this.group.add(this.doors);
    }
    // Houses and granaries inside: timber, whitewashed walls, dark tile or thatch.
    const Rr = rng(1409);
    const bodies: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const placed: [number, number][] = [];
    for (let tries = 0; tries < 900 && placed.length < 70; tries++) {
      const x = f.x0 + Rr() * f.nx;
      const z = f.z0 + Rr() * f.nz;
      if (f.zoneAt(x, z) !== Z_IN) continue;
      const k = Math.floor(z - f.z0) * f.nx + Math.floor(x - f.x0);
      if (f.dist[k] < half + BANK + 8) continue;
      if (Math.hypot(x - f.gateX, z - f.gateZ) < 40) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 13)) continue;
      // Keep a lane clear from the gate to the middle.
      const lx = f.cx - f.gateX;
      const lz = f.cz - f.gateZ;
      const ll = Math.hypot(lx, lz);
      const tt = ((x - f.gateX) * lx + (z - f.gateZ) * lz) / (ll * ll);
      if (tt > 0 && tt < 1.2 && Math.abs(((x - f.gateX) * lz - (z - f.gateZ) * lx) / ll) < 14) continue;
      const y = field.height(x, z);
      const hh = [field.height(x + 4, z), field.height(x - 4, z), field.height(x, z + 4), field.height(x, z - 4)];
      if (Math.max(...hh) - Math.min(...hh) > 2.5) continue;
      placed.push([x, z]);
      const big = Rr() < 0.2;
      const w = big ? 11 : 6 + Rr() * 3;
      const d = big ? 6 : 4 + Rr() * 1.2;
      const h = big ? 3.4 : 2.6;
      const yaw = Math.round(Rr() * 4) * (Math.PI / 2) + (Rr() - 0.5) * 0.2;
      const base = Math.min(...hh) - 0.4;
      const m4 = new THREE.Matrix4().compose(V(x, base, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
      const body = tinted(new THREE.BoxGeometry(w, h + (y - base), d).translate(0, (h + (y - base)) / 2, 0), big ? 0xd8ccb0 : 0xcabd9c);
      body.applyMatrix4(m4);
      bodies.push(body);
      const frame = tinted(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3).translate(0, h + (y - base) - 0.1, 0), 0x5a3a24);
      frame.applyMatrix4(m4);
      bodies.push(frame);
      const thatch = !big && Rr() < 0.45;
      const rf = hipRoof(w, d, big ? 3 : 2.2, thatch ? 0x8a7448 : 0x3e4046);
      rf.applyMatrix4(new THREE.Matrix4().makeTranslation(0, h + (y - base) + 0.1, 0).premultiply(m4));
      roofs.push(rf);
    }
    if (bodies.length) {
      const bm = new THREE.Mesh(mergeGeometries(bodies.map((g) => g.index ? g.toNonIndexed() : g)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      bm.castShadow = bm.receiveShadow = true;
      this.group.add(bm);
      const rm = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
      rm.castShadow = rm.receiveShadow = true;
      this.group.add(rm);
    }
    // Ladders: two rails and rungs, 12 m, built standing up along +y.
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-0.35, 0.35]) parts.push(new THREE.BoxGeometry(0.1, 12, 0.1).translate(sx, 6, 0));
    for (let r = 0.5; r < 12; r += 0.6) parts.push(new THREE.BoxGeometry(0.7, 0.06, 0.06).translate(0, r, 0));
    this.ladders = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }), 400);
    this.ladders.count = 0;
    this.ladders.castShadow = true;
    this.ladders.frustumCulled = false;
    this.group.add(this.ladders);
    // Ram: a wheeled shed of hides over a slung log.
    const rp: THREE.BufferGeometry[] = [];
    rp.push(tinted(hipRoof(9, 3.4, 2.2, 0x6a5238).translate(0, 2.4, 0), 0x6a5238));
    rp.push(tinted(new THREE.BoxGeometry(9.4, 0.3, 3.6).translate(0, 0.9, 0), 0x4a3422));
    for (const wx of [-3.4, 3.4]) for (const wz of [-1.9, 1.9]) rp.push(tinted(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 12).rotateX(Math.PI / 2).translate(wx, 0.75, wz), 0x3a2618));
    rp.push(tinted(new THREE.CylinderGeometry(0.32, 0.38, 11, 10).rotateZ(Math.PI / 2).translate(0.8, 1.5, 0), 0x5a4028));
    rp.push(tinted(new THREE.ConeGeometry(0.42, 0.9, 10).rotateZ(-Math.PI / 2).translate(6.7, 1.5, 0), 0x5a5a5e));
    this.ramGeo = mergeGeometries(rp.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    }));
  }

  update(): void {
    const b = this.b;
    const f = this.fort;
    // Doors: shut, swung open, or smashed and lying in the gateway.
    const [l, r] = this.doors.children;
    if (f.gateHp <= 0) {
      l.rotation.set(-Math.PI / 2 + 0.1, 0.3, 0);
      r.rotation.set(-Math.PI / 2 + 0.05, -0.4, 0);
    } else if (f.gateOpen) {
      l.rotation.set(0, -1.45, 0);
      r.rotation.set(0, 1.45, 0);
    } else {
      const shake = f.gateHp < f.gateMax ? Math.sin(performance.now() * 0.03) * 0.012 * (1 - f.gateHp / f.gateMax) : 0;
      l.rotation.set(0, shake, 0);
      r.rotation.set(0, -shake, 0);
    }
    // Ladders where men are climbing (one ladder for a few climbers).
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let i = 0; i < b.n && n < 400; i++) {
      if (!b.alive[i] || b.climb[i] <= 0 || b.seed[i] > 0.35) continue;
      const d = b.dir[i];
      const gx = b.x[i] - Math.sin(d) * 0.6;
      const gz = b.z[i] - Math.cos(d) * 0.6;
      const g = f.field.height(gx, gz);
      const tx = b.x[i] + Math.sin(d) * 3;
      const tz = b.z[i] + Math.cos(d) * 3;
      const top = f.wallTop(tx, tz) > -1e8 ? f.wallTop(tx, tz) : g + f.spec.height;
      const rise = top + 0.8 - g;
      const lean = Math.atan2(2.6, rise);
      q.setFromEuler(new THREE.Euler(lean, d, 0, "YXZ"));
      m.compose(V(gx, g, gz), q, V(1, Math.hypot(rise, 2.6) / 12, 1));
      this.ladders.setMatrixAt(n++, m);
    }
    this.ladders.count = n;
    this.ladders.instanceMatrix.needsUpdate = true;
    // Rams ride with their crews.
    for (const u of b.units) {
      if (u.type.role !== "ram") continue;
      let g = this.rams.get(u.id);
      if (!g) {
        g = new THREE.Group();
        const mesh = new THREE.Mesh(this.ramGeo, this.woodMat);
        mesh.castShadow = true;
        mesh.rotation.y = -Math.PI / 2;
        g.add(mesh);
        this.group.add(g);
        this.rams.set(u.id, g);
      }
      const alive = b.livingMen(u);
      g.visible = alive > 4 && u.state !== "routing";
      if (!g.visible) continue;
      const [cx, cz] = b.pos(u);
      g.position.set(cx, f.field.height(cx, cz), cz);
      // Point at the gate while close to it, else where the crew is heading.
      const dg = Math.hypot(f.gateX - cx, f.gateZ - cz);
      const want = dg < 60 ? Math.atan2(f.gateX - cx, f.gateZ - cz) : u.face;
      let dy = want - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * 0.05;
      // The log swings when they strike.
      const act = u.men.reduce((a, i) => Math.max(a, b.alive[i] ? b.action[i] : 0), 0);
      (g.children[0] as THREE.Mesh).position.set(Math.sin(g.rotation.y) * Math.sin(act * Math.PI) * 0.8, 0, Math.cos(g.rotation.y) * Math.sin(act * Math.PI) * 0.8);
    }
  }
}
