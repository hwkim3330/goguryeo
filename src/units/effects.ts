/**
 * The air over a battle: dust thrown up by marching feet and galloping hooves (thick behind a
 * charge), and every unit's standard, a cloth that waves in the wind on a pole carried in the
 * front rank: the three-legged crow (삼족오) on crimson for 고구려, 隋 and 唐 for the enemy.
 */
import * as THREE from "three";
import type { Battle } from "../sim/battle";

const MAXP = 4000;

export class Dust {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAXP * 3);
  private readonly life = new Float32Array(MAXP * 2);
  private readonly vel = new Float32Array(MAXP * 3);
  private head = 0;

  constructor(readonly b: Battle) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aLife", new THREE.BufferAttribute(this.life, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */ `
        attribute vec2 aLife; varying float vA;
        uniform float uScale;
        void main() {
          float t = aLife.x / max(aLife.y, 0.001);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Fade what drifts right up to the lens.
          float near = smoothstep(6.0, 30.0, -mv.z);
          vA = t > 0.0 && t < 1.0 ? sin(t * 3.14159) * 0.09 * near : 0.0;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(140.0, (1.0 + t * 3.0) * uScale / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.62, 0.55, 0.42), a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  update(dt: number, cam: THREE.Vector3): void {
    const b = this.b;
    // Emit from a sample of the moving men near the camera.
    const budget = Math.min(260, Math.round(dt * 2400));
    for (let n = 0; n < budget; n++) {
      const i = Math.floor(Math.random() * b.n);
      if (!b.alive[i]) continue;
      const u = b.units[b.unit[i]];
      const sp = Math.hypot(b.vx[i], b.vz[i]);
      const need = u.type.mounted ? 3.5 : 2.6;
      if (sp < need) continue;
      if (Math.abs(b.x[i] - cam.x) + Math.abs(b.z[i] - cam.z) > 700) continue;
      if (b.field.surface(b.x[i], b.z[i]).wet > 0.05) continue;
      if (Math.random() > (u.type.mounted ? 0.5 : 0.07)) continue;
      const k = this.head++ % MAXP;
      this.pos[k * 3] = b.x[i] + (Math.random() - 0.5) * 1.2;
      this.pos[k * 3 + 1] = b.y[i] + 0.2;
      this.pos[k * 3 + 2] = b.z[i] + (Math.random() - 0.5) * 1.2;
      this.vel[k * 3] = -b.vx[i] * 0.15 + (Math.random() - 0.5) * 0.6;
      this.vel[k * 3 + 1] = 0.35 + Math.random() * 0.5;
      this.vel[k * 3 + 2] = -b.vz[i] * 0.15 + (Math.random() - 0.5) * 0.6;
      this.life[k * 2] = 0;
      this.life[k * 2 + 1] = u.type.mounted ? 2.6 + Math.random() * 2 : 1.6 + Math.random();
    }
    for (let k = 0; k < MAXP; k++) {
      if (this.life[k * 2 + 1] <= 0) continue;
      this.life[k * 2] += dt;
      if (this.life[k * 2] > this.life[k * 2 + 1]) {
        this.life[k * 2 + 1] = 0;
        continue;
      }
      this.pos[k * 3] += (this.vel[k * 3] + 0.4) * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += (this.vel[k * 3 + 2] + 0.2) * dt;
      this.vel[k * 3 + 1] *= 0.98;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ standards

function flagTexture(kind: "crow" | "sui" | "tang"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  if (kind === "crow") {
    g.fillStyle = "#9a1c16";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#e8b640";
    g.beginPath();
    g.arc(140, 80, 52, 0, 7);
    g.fill();
    // 삼족오: a crow with three legs inside the sun.
    g.fillStyle = "#140c0a";
    g.beginPath();
    g.ellipse(140, 78, 26, 17, -0.2, 0, 7);
    g.fill();
    g.beginPath();
    g.moveTo(118, 72);
    g.lineTo(96, 56);
    g.lineTo(122, 64);
    g.fill();
    g.beginPath();
    g.moveTo(152, 66);
    g.quadraticCurveTo(175, 40, 184, 52);
    g.quadraticCurveTo(170, 60, 160, 74);
    g.fill();
    g.beginPath();
    g.arc(160, 64, 9, 0, 7);
    g.fill();
    g.beginPath();
    g.moveTo(168, 64);
    g.lineTo(180, 66);
    g.lineTo(168, 69);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#140c0a";
    for (const dx of [-8, 0, 8]) {
      g.beginPath();
      g.moveTo(140 + dx, 92);
      g.lineTo(136 + dx * 1.4, 116);
      g.stroke();
    }
    g.fillStyle = "#e8b640";
    g.fillRect(0, 0, 256, 8);
    g.fillRect(0, 152, 256, 8);
  } else {
    g.fillStyle = kind === "sui" ? "#c8a040" : "#3a4a6a";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = kind === "sui" ? "#2a1a0a" : "#e8e8e8";
    g.font = "900 110px 'Noto Serif KR', serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(kind === "sui" ? "隋" : "唐", 140, 86);
    g.fillStyle = kind === "sui" ? "#7a2a1a" : "#a8b0c0";
    g.fillRect(0, 0, 256, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Standards {
  readonly group = new THREE.Group();
  private readonly flags: { mesh: THREE.InstancedMesh; units: number[] }[] = [];
  private readonly poles: THREE.InstancedMesh;
  private readonly time = { value: 0 };

  constructor(readonly b: Battle) {
    const cloth = new THREE.PlaneGeometry(2.0, 1.25, 16, 6).translate(1.0, 0, 0);
    const kinds = new Map<string, number[]>();
    for (const u of b.units) {
      const k = u.side === 0 ? "crow" : u.team === 2 ? "tang" : "sui";
      if (!kinds.has(k)) kinds.set(k, []);
      kinds.get(k)!.push(u.id);
    }
    for (const [k, units] of kinds) {
      const mat = new THREE.MeshStandardMaterial({ map: flagTexture(k as "crow"), side: THREE.DoubleSide, roughness: 0.85 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uT = this.time;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uT;").replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float s = transformed.x / 2.0;
float ph = uT * 5.0 + float(gl_InstanceID) * 1.7;
transformed.z += sin(transformed.x * 2.6 - ph) * 0.22 * s + sin(transformed.y * 3.0 - ph * 0.7) * 0.05 * s;
transformed.y -= s * s * 0.18;`,
        );
      };
      const mesh = new THREE.InstancedMesh(cloth, mat, units.length);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.flags.push({ mesh, units });
    }
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 4.6, 5).translate(0, 2.3, 0), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 }), b.units.length);
    this.poles.castShadow = true;
    this.poles.frustumCulled = false;
    this.group.add(this.poles);
  }

  /** The bearer: a living man near the middle of the front rank. */
  private bearer(uid: number): number {
    const u = this.b.units[uid];
    const mid = Math.floor(Math.min(u.files, u.men.length) / 2);
    for (let d = 0; d < u.men.length; d++) {
      for (const k of [mid + d, mid - d]) {
        const i = u.men[k];
        if (i !== undefined && this.b.alive[i]) return i;
      }
    }
    return -1;
  }

  update(t: number): void {
    this.time.value = t;
    const b = this.b;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let np = 0;
    for (const f of this.flags) {
      f.units.forEach((uid, k) => {
        const i = this.bearer(uid);
        const u = b.units[uid];
        if (i < 0 || u.state === "gone") {
          m.makeScale(0, 0, 0);
          f.mesh.setMatrixAt(k, m);
          return;
        }
        const mounted = u.type.mounted ? 0.9 : 0;
        const base = new THREE.Vector3(b.x[i] + Math.cos(b.dir[i]) * 0.35, b.y[i] + mounted, b.z[i] - Math.sin(b.dir[i]) * 0.35);
        // Cloth streams downwind (the wind blows toward +x, +z).
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-0.25, 0.55) + (u.state === "routing" ? 0.6 : 0));
        m.compose(base.clone().add(new THREE.Vector3(0, 3.9, 0)), q, new THREE.Vector3(1, 1, 1));
        f.mesh.setMatrixAt(k, m);
        m.makeTranslation(base.x, base.y, base.z);
        this.poles.setMatrixAt(np++, m);
      });
      f.mesh.instanceMatrix.needsUpdate = true;
    }
    this.poles.count = np;
    this.poles.instanceMatrix.needsUpdate = true;
  }
}
