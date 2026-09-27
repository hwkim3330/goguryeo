/**
 * Draws the battle: one instanced mesh per (kit, armour) for the men and per barding for the
 * horses, rewritten from the simulation's arrays every frame (position, facing, gait, strike,
 * death); arrows in flight and stuck in the ground; a banner over every unit with its name
 * and strength; rings under the selected men; the ghost of a formation being ordered.
 */
import * as THREE from "three";
import type { Battle, Unit } from "../sim/battle";
import { soldierMaterials, soldierMesh, type Kit } from "./soldierMesh";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

interface Group {
  mesh: THREE.InstancedMesh;
  men: number[];
  ride: boolean;
  horse: boolean;
}

export class ArmyView {
  readonly root = new THREE.Group();
  private groups: Group[] = [];
  private readonly arrows: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly ghost: THREE.InstancedMesh;
  private readonly banners = new Map<number, { sprite: THREE.Sprite; canvas: HTMLCanvasElement; last: string }>();

  constructor(readonly b: Battle) {
    const mats = soldierMaterials();
    // Group soldiers by what they look like.
    const byKey = new Map<string, { kit: Kit; elite: boolean; ride: boolean; men: number[] }>();
    const horses = new Map<string, number[]>();
    for (const u of b.units) {
      const t = u.type;
      const key = `${t.kit}|${t.elite}|${t.mounted}`;
      if (!byKey.has(key)) byKey.set(key, { kit: t.kit, elite: t.elite, ride: t.mounted, men: [] });
      byKey.get(key)!.men.push(...u.men);
      if (t.mounted) {
        const hk = t.elite ? "barded" : "plain";
        if (!horses.has(hk)) horses.set(hk, []);
        horses.get(hk)!.push(...u.men);
      }
    }
    for (const g of byKey.values()) {
      const mesh = soldierMesh(g.kit, g.elite, g.men.length, mats);
      this.root.add(mesh);
      this.groups.push({ mesh, men: g.men, ride: g.ride, horse: false });
    }
    for (const [k, men] of horses) {
      const mesh = soldierMesh("horse", k === "barded", men.length, mats);
      this.root.add(mesh);
      this.groups.push({ mesh, men, ride: false, horse: true });
    }
    // Arrows: a shaft with a pale fletching.
    const ag = new THREE.CylinderGeometry(0.012, 0.012, 0.85, 3).rotateX(Math.PI / 2);
    this.arrows = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 }), 6000);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    this.root.add(this.arrows);
    const rg = new THREE.RingGeometry(0.45, 0.62, 12).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0x7affc0, transparent: true, opacity: 0.85, depthWrite: false }), 3000);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 3;
    this.root.add(this.rings);
    const gg = new THREE.PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2);
    this.ghost = new THREE.InstancedMesh(gg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), 3000);
    this.ghost.frustumCulled = false;
    this.ghost.count = 0;
    this.ghost.renderOrder = 3;
    this.root.add(this.ghost);
    for (const u of b.units) this.banner(u);
  }

  private banner(u: Unit): void {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(16, 6, 1);
    sprite.renderOrder = 10;
    this.root.add(sprite);
    this.banners.set(u.id, { sprite, canvas: c, last: "" });
  }

  private drawBanner(u: Unit, men: number): void {
    const bn = this.banners.get(u.id)!;
    const key = `${men}|${Math.round(u.morale / 5)}|${u.state}|${u.selected}`;
    if (key === bn.last) return;
    bn.last = key;
    const g = bn.canvas.getContext("2d")!;
    g.clearRect(0, 0, 256, 96);
    const own = u.side === 0;
    const base = own ? "rgba(120,20,16,0.92)" : "rgba(60,52,40,0.9)";
    g.fillStyle = u.selected ? "rgba(40,160,110,0.95)" : base;
    g.beginPath();
    g.roundRect(8, 6, 240, 58, 10);
    g.fill();
    g.strokeStyle = own ? "#e8c070" : "#b8a888";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#fff";
    g.font = "700 26px 'Noto Serif KR', serif";
    g.textAlign = "center";
    g.fillText(u.name, 128, 34);
    g.font = "600 18px 'Noto Serif KR', serif";
    g.fillText(u.state === "routing" ? "패주!" : `${men}명`, 128, 56);
    // Morale bar.
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(28, 70, 200, 10);
    const m = Math.max(0, Math.min(1, u.morale / 100));
    g.fillStyle = m > 0.5 ? "#6fd06a" : m > 0.25 ? "#e8c040" : "#e04a3a";
    g.fillRect(28, 70, 200 * m, 10);
    (bn.sprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  /** Formation preview for an order being dragged. */
  setGhost(slots: [number, number][], color: number): void {
    const f = this.b.field;
    slots.slice(0, 3000).forEach(([x, z], k) => {
      _m.makeTranslation(x, f.height(x, z) + 0.15, z);
      this.ghost.setMatrixAt(k, _m);
    });
    this.ghost.count = Math.min(3000, slots.length);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.ghost.instanceMatrix.needsUpdate = true;
  }

  update(camPos: THREE.Vector3): void {
    const b = this.b;
    for (const g of this.groups) {
      const anim = g.mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
      const pose = g.mesh.geometry.attributes.iPose as THREE.InstancedBufferAttribute;
      const A = anim.array as Float32Array;
      const P = pose.array as Float32Array;
      g.men.forEach((i, k) => {
        const u = b.units[b.unit[i]];
        const dead = !b.alive[i];
        const speed = Math.min(1, Math.hypot(b.vx[i], b.vz[i]) / (u.type.mounted ? 6 : 3));
        let x = b.x[i];
        let z = b.z[i];
        // A fallen rider lies beside his horse.
        if (dead && g.ride) {
          x += Math.cos(b.dir[i]) * 1.2;
          z -= Math.sin(b.dir[i]) * 1.2;
        }
        _p.set(x, b.y[i], z);
        _q.setFromAxisAngle(UP, b.dir[i]);
        _m.compose(_p, _q, _s);
        g.mesh.setMatrixAt(k, _m);
        A[k * 4] = b.phase[i];
        A[k * 4 + 1] = dead ? 0 : speed;
        A[k * 4 + 2] = b.action[i];
        A[k * 4 + 3] = b.death[i];
        let p = 0;
        if (g.ride) p = dead ? 0 : 3;
        else if (!g.horse) {
          if (u.type.kit === "bow" && b.action[i] > 0) p = 2;
          else if (u.type.kit === "spear" && (u.state === "fighting" || u.state === "ready") && speed < 0.2) p = 1;
        }
        P[k * 4] = p;
        P[k * 4 + 1] = u.team;
        P[k * 4 + 2] = b.seed[i];
        P[k * 4 + 3] = b.flash[i] * 0.6;
      });
      g.mesh.count = g.men.length;
      g.mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
      pose.needsUpdate = true;
    }
    // Arrows.
    let n = 0;
    for (const a of b.arrows) {
      if (n >= 6000) break;
      _p.set(a.x, a.y, a.z);
      const v = new THREE.Vector3(a.vx, a.vy, a.vz);
      if (a.stuck > 0) v.set(a.vx, a.vy * 1.6, a.vz);
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.normalize());
      _m.compose(_p, _q, _s);
      this.arrows.setMatrixAt(n++, _m);
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
    // Rings under the selected, banners over every unit.
    let r = 0;
    for (const u of b.units) {
      const bn = this.banners.get(u.id)!;
      const men = b.livingMen(u);
      if (u.state === "gone" || !men) {
        bn.sprite.visible = false;
        continue;
      }
      const [cx, cz] = b.pos(u);
      const d = camPos.distanceTo(_p.set(cx, b.field.height(cx, cz), cz));
      bn.sprite.visible = true;
      const sc = Math.max(0.6, Math.min(3.2, d / 140));
      bn.sprite.scale.set(16 * sc, 6 * sc, 1);
      bn.sprite.position.set(cx, b.field.height(cx, cz) + 12 + sc * 5, cz);
      this.drawBanner(u, men);
      if (!u.selected) continue;
      for (const i of u.men) {
        if (!b.alive[i] || r >= 3000) continue;
        _m.makeTranslation(b.x[i], b.y[i] + 0.1, b.z[i]);
        if (u.type.mounted) _m.scale(new THREE.Vector3(2, 1, 2));
        this.rings.setMatrixAt(r++, _m);
      }
    }
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
