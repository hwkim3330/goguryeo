/**
 * Soldiers and horses as instanced part-built meshes animated entirely in the vertex shader.
 * Every vertex knows its part (torso, legs, arms, weapon…), the part's joint and its material
 * slot; per instance the simulation writes an animation vector (gait phase, speed, action,
 * death) and a pose (braced spear, drawn bow, riding). The shader swings legs and arms, raises
 * and brings down the weapon, draws the bow, lays the fallen on the ground, and paints
 * lamellar armour (찰갑) row by row onto the armour and the horses' barding.
 */
import * as THREE from "three";

export const PART = { torso: 0, head: 1, helm: 2, legL: 3, legR: 4, armL: 5, armR: 6, weapon: 7, shield: 8, cape: 9, hBody: 10, hNeck: 11, hLegFL: 12, hLegFR: 13, hLegBL: 14, hLegBR: 15, hTail: 16 } as const;
export const MAT = { cloth: 0, skin: 1, armour: 2, wood: 3, leather: 4, crest: 5, coat: 6, barding: 7, steel: 8, hair: 9 } as const;

export type Kit = "spear" | "sword" | "bow" | "rider" | "horse" | "axe" | "banner";

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  part: number[] = [];
  pivot: number[] = [];
  mat: number[] = [];
  local: number[] = [];

  add(g0: THREE.BufferGeometry, part: number, pivot: [number, number, number], mat: number): this {
    // Keep the primitives' own (smooth) normals: recomputing after un-indexing faceted everything.
    if (!g0.attributes.normal) g0.computeVertexNormals();
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal.array as Float32Array;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      this.part.push(part);
      this.pivot.push(...pivot);
      this.mat.push(mat);
      // Local coordinates in the part, for the lamellar pattern.
      this.local.push(p[i] - bb.min.x, p[i + 1] - bb.min.y, p[i + 2] - bb.min.z);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aPart", new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute("aPivot", new THREE.Float32BufferAttribute(this.pivot, 3));
    g.setAttribute("aMat", new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute("aLocal", new THREE.Float32BufferAttribute(this.local, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number, d = 1) => new THREE.IcosahedronGeometry(r, d).translate(x, y, z);
/** A tapered limb from a to b (radius ra at a, rb at b). */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number, seg = 7): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const m = va.clone().add(vb).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

/** A foot soldier with `kit` (a rider shares the body; the shader seats him). */
function human(b: Builder, kit: Kit, elite: boolean): void {
  const P = PART;
  const coat = elite ? MAT.armour : MAT.cloth;
  // Legs, hip joints at y 0.92: thigh, shin, boot.
  for (const [x, part] of [
    [-0.1, P.legL],
    [0.1, P.legR],
  ] as const) {
    const pv: [number, number, number] = [x, 0.92, 0];
    b.add(limb([x, 0.92, 0], [x, 0.5, 0.01], 0.085, 0.07), part, pv, MAT.cloth);
    b.add(limb([x, 0.5, 0.01], [x, 0.14, 0], 0.066, 0.058), part, pv, MAT.cloth);
    b.add(limb([x, 0.2, 0], [x, 0.03, 0.02], 0.068, 0.07), part, pv, MAT.leather);
    b.add(box(0.1, 0.06, 0.2, x, 0.03, 0.06), part, pv, MAT.leather);
  }
  // Lamellar skirt (a flared cone), torso (broad at the shoulders), belt, collar.
  b.add(new THREE.CylinderGeometry(0.19, 0.27, 0.44, 12, 1, true).translate(0, 0.8, 0), P.torso, [0, 0, 0], coat);
  b.add(new THREE.CylinderGeometry(0.2, 0.16, 0.52, 12).scale(1.2, 1, 0.78).translate(0, 1.23, 0), P.torso, [0, 0, 0], coat);
  b.add(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 12).scale(1.12, 1, 0.8).translate(0, 1.0, 0), P.torso, [0, 0, 0], MAT.leather);
  b.add(cyl(0.07, 0.08, 0.1, 0, 1.52, 0), P.torso, [0, 0, 0], MAT.skin);
  if (elite || kit === "sword" || kit === "spear") {
    // Shoulder guards.
    b.add(ball(0.1, -0.23, 1.42, 0, 1).scale(1, 0.7, 1.1), P.torso, [0, 0, 0], MAT.armour);
    b.add(ball(0.1, 0.23, 1.42, 0, 1).scale(1, 0.7, 1.1), P.torso, [0, 0, 0], MAT.armour);
  }
  // Head and the vertical-plate helmet (종장판주) with neck guard and plume.
  b.add(ball(0.11, 0, 1.63, 0.01, 2), P.head, [0, 0, 0], MAT.skin);
  b.add(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.66, 0), P.helm, [0, 0, 0], MAT.steel);
  b.add(new THREE.CylinderGeometry(0.13, 0.16, 0.12, 12, 1, true, Math.PI * 0.35, Math.PI * 1.3).translate(0, 1.6, -0.005), P.helm, [0, 0, 0], MAT.armour);
  b.add(cyl(0.004, 0.022, 0.16, 0, 1.86, 0, 5), P.helm, [0, 0, 0], MAT.steel);
  b.add(box(0.02, 0.26, 0.06, 0, 2.04, -0.03).rotateX(-0.25), P.helm, [0, 0, 0], MAT.crest);
  // Arms, shoulder joints at y 1.42: upper arm, forearm, hand.
  for (const [x, part] of [
    [-0.25, P.armL],
    [0.25, P.armR],
  ] as const) {
    const pv: [number, number, number] = [x, 1.42, 0];
    b.add(limb([x, 1.42, 0], [x * 1.08, 1.14, 0.01], 0.062, 0.052), part, pv, elite ? MAT.armour : MAT.cloth);
    b.add(limb([x * 1.08, 1.14, 0.01], [x * 1.1, 0.88, 0.05], 0.05, 0.042), part, pv, MAT.cloth);
    b.add(ball(0.045, x * 1.1, 0.84, 0.06, 1), part, pv, MAT.skin);
  }
  const W = P.weapon;
  const sh: [number, number, number] = [0.25, 1.42, 0];
  const hx = 0.275;
  if (kit === "spear" || kit === "rider") {
    const len = kit === "rider" ? 3.7 : 3.3;
    b.add(cyl(0.018, 0.022, len, hx, 0.84 + len * 0.22, 0.07, 5), W, sh, MAT.wood);
    b.add(new THREE.OctahedronGeometry(0.06, 0).scale(0.6, 3.2, 0.25).translate(hx, 0.84 + len * 0.72 + 0.18, 0.07), W, sh, MAT.steel);
    b.add(cyl(0.024, 0.024, 0.08, hx, 0.84 + len * 0.72, 0.07, 5), W, sh, MAT.steel);
  } else if (kit === "sword") {
    // 환두대도: a straight single-edged blade with a ring pommel.
    b.add(box(0.036, 0.78, 0.012, hx, 1.28, 0.1), W, sh, MAT.steel);
    b.add(box(0.07, 0.022, 0.05, hx, 0.88, 0.1), W, sh, MAT.leather);
    b.add(new THREE.TorusGeometry(0.035, 0.009, 5, 10).translate(hx, 0.76, 0.1), W, sh, MAT.steel);
  } else if (kit === "axe") {
    b.add(cyl(0.02, 0.024, 1.25, hx, 1.3, 0.08, 5), W, sh, MAT.wood);
    b.add(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 10, 1, false, 0, Math.PI * 0.6).rotateZ(Math.PI / 2).translate(hx, 1.84, 0.12), W, sh, MAT.steel);
  } else if (kit === "bow") {
    // 맥궁: a short, strongly recurved horn bow in the left hand; a quiver on the back.
    const bow = new THREE.TorusGeometry(0.5, 0.014, 4, 16, Math.PI * 0.8).rotateZ(Math.PI / 2 + Math.PI * 0.1).rotateY(Math.PI / 2).translate(-0.3, 0.9, 0.2);
    b.add(bow, P.armL, [-0.25, 1.42, 0], MAT.wood);
    b.add(ball(0.03, -0.3, 1.38, 0.06, 0), P.armL, [-0.25, 1.42, 0], MAT.wood);
    b.add(ball(0.03, -0.3, 0.42, 0.06, 0), P.armL, [-0.25, 1.42, 0], MAT.wood);
    b.add(cyl(0.06, 0.05, 0.55, 0.1, 1.2, -0.17), P.torso, [0, 0, 0], MAT.leather);
    for (let k = 0; k < 3; k++) b.add(cyl(0.006, 0.006, 0.2, 0.08 + k * 0.02, 1.55, -0.17, 3), P.torso, [0, 0, 0], MAT.crest);
  } else if (kit === "banner") {
    b.add(cyl(0.022, 0.022, 3.8, hx, 2.1, 0.06), W, sh, MAT.wood);
    b.add(box(0.02, 1.1, 0.7, hx, 3.3, 0.42), W, sh, MAT.crest);
  }
  if (kit === "sword" || kit === "axe") b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14).scale(1, 1, 1.25).rotateZ(Math.PI / 2).translate(-0.36, 1.02, 0.12), P.shield, [-0.25, 1.42, 0], MAT.wood);
  if (elite && kit !== "rider") b.add(box(0.4, 0.66, 0.02, 0, 1.1, -0.16), P.cape, [0, 1.42, -0.15], MAT.crest);
}

/** The armoured horse (개마): body, arched neck, long head, four jointed legs, barding. */
function horse(b: Builder, barded: boolean): void {
  const P = PART;
  const bm = barded ? MAT.barding : MAT.coat;
  // Body: a long capsule, hindquarters a little higher and rounder.
  b.add(new THREE.CapsuleGeometry(0.33, 1.0, 6, 12).rotateX(Math.PI / 2).scale(1, 1.08, 1).translate(0, 1.28, 0), P.hBody, [0, 0, 0], MAT.coat);
  b.add(ball(0.36, 0, 1.33, -0.55, 1).scale(1, 1, 1.1), P.hBody, [0, 0, 0], MAT.coat);
  b.add(ball(0.34, 0, 1.3, 0.55, 1), P.hBody, [0, 0, 0], MAT.coat);
  // Saddle.
  b.add(box(0.5, 0.1, 0.55, 0, 1.64, -0.05), P.hBody, [0, 0, 0], MAT.leather);
  // Neck (arched) and head, jointed at the withers.
  const nk: [number, number, number] = [0, 1.5, 0.62];
  b.add(limb([0, 1.42, 0.62], [0, 1.95, 1.02], 0.24, 0.15, 9), P.hNeck, nk, MAT.coat);
  b.add(limb([0, 2.0, 1.02], [0, 1.72, 1.48], 0.12, 0.075, 8), P.hNeck, nk, barded ? MAT.steel : MAT.coat);
  b.add(cyl(0.02, 0.035, 0.14, -0.07, 2.14, 1.0, 4), P.hNeck, nk, MAT.coat);
  b.add(cyl(0.02, 0.035, 0.14, 0.07, 2.14, 1.0, 4), P.hNeck, nk, MAT.coat);
  b.add(box(0.05, 0.62, 0.12, 0, 1.86, 0.82).rotateX(-0.72), P.hNeck, nk, MAT.hair);
  // Legs: upper (muscle), lower (cannon), hoof.
  for (const [x, z, part, hind] of [
    [-0.18, 0.6, P.hLegFL, false],
    [0.18, 0.6, P.hLegFR, false],
    [-0.18, -0.62, P.hLegBL, true],
    [0.18, -0.62, P.hLegBR, true],
  ] as const) {
    const pv: [number, number, number] = [x, 1.12, z];
    b.add(limb([x, 1.2, z], [x, 0.62, z + (hind ? -0.06 : 0.02)], hind ? 0.14 : 0.11, 0.065), part, pv, MAT.coat);
    b.add(limb([x, 0.62, z + (hind ? -0.06 : 0.02)], [x, 0.1, z], 0.045, 0.042, 6), part, pv, MAT.coat);
    b.add(cyl(0.05, 0.06, 0.1, x, 0.05, z + 0.01, 6), part, pv, MAT.hair);
  }
  b.add(limb([0, 1.45, -0.95], [0, 0.8, -1.12], 0.07, 0.03, 5), P.hTail, [0, 1.45, -0.95], MAT.hair);
  if (barded) {
    // Lamellar barding (마갑): a rounded shell over the body that hangs to the knees, the neck
    // guard, and a skirt of plates round the chest and haunches.
    b.add(new THREE.CapsuleGeometry(0.4, 1.02, 6, 14).rotateX(Math.PI / 2).scale(1.02, 1.12, 1).translate(0, 1.22, -0.02), P.hBody, [0, 0, 0], bm);
    b.add(new THREE.CylinderGeometry(0.42, 0.46, 0.34, 14, 1, true).rotateX(Math.PI / 2).scale(1, 1.25, 1.0).translate(0, 1.0, 0.72), P.hBody, [0, 0, 0], bm);
    b.add(new THREE.CylinderGeometry(0.42, 0.46, 0.34, 14, 1, true).rotateX(Math.PI / 2).scale(1, 1.25, 1.0).translate(0, 1.0, -0.74), P.hBody, [0, 0, 0], bm);
    b.add(limb([0, 1.38, 0.66], [0, 1.9, 1.0], 0.28, 0.17, 10), P.hNeck, nk, bm);
  }
}

export function buildGeometry(kit: Kit, elite: boolean): THREE.BufferGeometry {
  const b = new Builder();
  if (kit === "horse") horse(b, elite);
  else human(b, kit, elite);
  return b.build();
}

// ------------------------------------------------------------------ the shader

export interface ArmyPalette {
  cloth: THREE.Color;
  armour: THREE.Color;
  crest: THREE.Color;
  steel: THREE.Color;
}

const VERT_HEAD = /* glsl */ `
attribute float aPart;
attribute vec3 aPivot;
attribute float aMat;
attribute vec3 aLocal;
attribute vec4 iAnim;   // x gait phase, y speed 0..1, z action 0..1, w death 0..1
attribute vec4 iPose;   // x pose (0 stand, 1 brace, 2 bow, 3 ride), y team, z seed, w hit flash
varying float vMat;
varying vec3 vLocal;
varying float vTeam;
varying float vFlash;
varying float vSeed;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 partRot() {
  float ph = iAnim.x, sp = iAnim.y, act = iAnim.z, pose = iPose.x;
  float gait = sin(ph) * (0.25 + 0.45 * sp) * step(0.02, sp);
  mat3 R = mat3(1.0);
  int p = int(aPart + 0.5);
  if (p == 3) R = pose > 2.5 ? rotZ(-0.55) * rotX(-1.05) : rotX(gait);
  else if (p == 4) R = pose > 2.5 ? rotZ(0.55) * rotX(-1.05) : rotX(-gait);
  else if (p == 5 || p == 8) {
    R = rotX(-gait * 0.6);
    if (pose > 1.5 && pose < 2.5) R = rotX(-1.45) * rotZ(-0.15);      // bow arm out
    if (p == 8 || pose < 0.5) R = rotX(-0.55 - act * 0.3) * rotZ(0.1); // shield forward
  } else if (p == 6 || p == 7) {
    R = rotX(gait * 0.6);
    // Spear levelled when braced or riding; a strike is a raise and a drive forward.
    if (pose > 0.5 && pose < 1.5) R = rotX(-1.35);
    if (pose > 2.5) R = rotX(-1.15);
    if (pose > 1.5 && pose < 2.5) R = rotX(-1.4) * rotY(0.4 * act) * rotZ(0.2 + 0.6 * act); // draw the string
    float strike = act > 0.0 ? sin(min(act, 1.0) * 3.14159) : 0.0;
    if (pose < 1.5 || pose > 2.5) R = rotX(-2.3 * strike + (act > 0.6 ? 1.2 * (act - 0.6) : 0.0)) * R;
  } else if (p == 9) R = rotX(0.25 + sp * 0.5 + sin(ph * 0.5) * 0.08);
  else if (p == 12 || p == 15) R = rotX(sin(ph) * 0.7 * sp);
  else if (p == 13 || p == 14) R = rotX(-sin(ph) * 0.7 * sp);
  else if (p == 11) R = rotX(sin(ph * 2.0) * 0.08 * sp - 0.1 * sp);
  else if (p == 16) R = rotX(0.3 + sp * 0.6);
  return R;
}
`;

function patch(m: THREE.Material, depth: boolean): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
      .replace(
        "#include <beginnormal_vertex>",
        depth
          ? "#include <beginnormal_vertex>"
          : `#include <beginnormal_vertex>
mat3 PR = partRot();
objectNormal = PR * objectNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${depth ? "mat3 PR = partRot();" : ""}
transformed = PR * (transformed - aPivot) + aPivot;
// Riders sit higher; the fallen lie down.
if (iPose.x > 2.5) transformed.y += 0.74;
float d = iAnim.w;
if (d > 0.0) {
  float side = fract(iPose.z * 7.13) > 0.5 ? 1.0 : -1.0;
  if (aPart > 9.5) { transformed = rotZ(1.5 * d * side) * transformed; transformed.y += 0.35 * d; }
  else { transformed = rotX(-1.52 * d * side) * transformed; transformed.y += 0.14 * d; }
}
vMat = aMat; vLocal = aLocal; vTeam = iPose.y; vFlash = iPose.w; vSeed = iPose.z;`,
      );
    if (depth) return;
    sh.uniforms.uCloth = { value: pal("cloth") };
    sh.uniforms.uArmour = { value: pal("armour") };
    sh.uniforms.uCrest = { value: pal("crest") };
    sh.uniforms.uSteel = { value: pal("steel") };
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vMat; varying vec3 vLocal; varying float vTeam; varying float vFlash; varying float vSeed;
uniform vec3 uCloth[7]; uniform vec3 uArmour[7]; uniform vec3 uCrest[7]; uniform vec3 uSteel[7];
float mRough = 0.8; float mMetal = 0.0;
vec3 teamPick(vec3 a[7]) { int t = int(vTeam + 0.5); return t == 0 ? a[0] : t == 1 ? a[1] : t == 2 ? a[2] : t == 3 ? a[3] : t == 4 ? a[4] : t == 5 ? a[5] : a[6]; }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  int m = int(vMat + 0.5);
  vec3 c = vec3(0.5);
  float var = 0.9 + 0.2 * fract(vSeed * 13.7);
  if (m == 0) { c = teamPick(uCloth) * var; mRough = 0.9; }
  else if (m == 1) { c = pow(vec3(0.78, 0.58, 0.44), vec3(2.2)) * var; mRough = 0.7; }
  else if (m == 2 || m == 7) {
    // Lamellar: rows of small overlapping plates, laced.
    vec2 q = vec2(vLocal.x * 18.0 + vLocal.z * 18.0, vLocal.y * 11.0);
    float row = floor(q.y);
    q.x += mod(row, 2.0) * 0.5;
    vec2 f = fract(q);
    float plate = smoothstep(0.0, 0.12, f.x) * smoothstep(1.0, 0.88, f.x) * smoothstep(0.0, 0.25, f.y);
    float lace = step(0.92, f.y);
    c = teamPick(uArmour) * (0.55 + 0.45 * plate) * var;
    c = mix(c, teamPick(uCrest) * 0.6, lace * 0.6);
    mRough = 0.45; mMetal = 0.55;
  }
  else if (m == 3) { c = pow(vec3(0.42, 0.30, 0.18), vec3(2.2)) * var; mRough = 0.85; }
  else if (m == 4) { c = pow(vec3(0.30, 0.20, 0.13), vec3(2.2)) * var; mRough = 0.75; }
  else if (m == 5) { c = teamPick(uCrest); mRough = 0.8; }
  else if (m == 6) { c = pow(mix(vec3(0.36, 0.22, 0.13), vec3(0.2, 0.14, 0.1), fract(vSeed * 3.1)), vec3(2.2)); mRough = 0.7; }
  else if (m == 8) { c = teamPick(uSteel) * 0.5; mRough = 0.7; mMetal = 0.35; }
  else if (m == 9) { c = vec3(0.01, 0.008, 0.006); mRough = 0.8; }
  c = mix(c, vec3(1.0, 0.25, 0.2), vFlash);
  diffuseColor.rgb = c;
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mMetal;");
  };
  m.customProgramCacheKey = () => (depth ? "soldier-depth" : "soldier");
}

/**
 * Team palettes: 0 고구려 (crimson and black), 1 수 (ochre and brown), 2 당 (blue-grey),
 * 3 말갈 (hide and fur), 4 백제 (purple and bronze), 5 신라 (green and gold), 6 거란 (rust and blue).
 */
const PALETTES: Record<keyof ArmyPalette, number[]> = {
  cloth: [0x8a1f1a, 0x9a7a3a, 0x4a566a, 0x6a5a40, 0x5a2a6a, 0x2a6a4a, 0x7a4028],
  armour: [0x2a2624, 0x6a5a3a, 0x5a6270, 0x4a3a2a, 0x4a3a44, 0x5a5238, 0x5a4a3a],
  crest: [0xc8281e, 0xe0b040, 0xe8e8e8, 0x8a6a3a, 0xd8b050, 0xe8c850, 0x3a6aa0],
  steel: [0x8a8a8e, 0x9a9282, 0xa0a4ac, 0x7a746a, 0x9a8a70, 0xa89a70, 0x8a8a8a],
};
function pal(k: keyof ArmyPalette): THREE.Color[] {
  return PALETTES[k].map((c) => new THREE.Color(c));
}

export function soldierMaterials(): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });
  patch(mat, false);
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patch(depth, true);
  return { mat, depth };
}

/** An instanced mesh with the per-instance animation attributes attached. */
export function soldierMesh(kit: Kit, elite: boolean, max: number, mats: ReturnType<typeof soldierMaterials>): THREE.InstancedMesh {
  const g = buildGeometry(kit, elite);
  g.setAttribute("iAnim", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("iPose", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.InstancedMesh(g, mats.mat, max);
  m.customDepthMaterial = mats.depth;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}
