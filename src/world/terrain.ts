/**
 * The battlefield: a height field shaped per scenario (rolling fbm hills, a carved river valley
 * with fords, roads, forests), baked to a height texture and a splat texture (road, forest
 * floor, riverbank, rock) that the ground shader, the grass and the water all read. The ground
 * blends grass, dry grass, dirt, sand and rock from those masks, slope and world-space noise;
 * the grass is a field of instanced blades that follows the camera and bends in the wind; the
 * water shades by depth with a fresnel sky, moving ripples and shore foam; trees are instanced.
 */
import * as THREE from "three";
import { Fort, type FortSpec } from "./fort";
import { GLSL_NOISE, Noise, rng } from "./noise";

export interface FieldSpec {
  seed: number;
  size: number;
  hills: number;
  /** River as a polyline (x, z) with width; fords are shallow stretches. */
  river?: { pts: [number, number][]; width: number; depth: number; fords: [number, number, number][] };
  roads?: [number, number][][];
  forest: number;
  /** Raise or lower a region: [x, z, radius, height]. */
  bumps?: [number, number, number, number][];
  /** A walled fortress; its ground is levelled a little so the walls sit well. */
  fort?: FortSpec;
}

export class Field {
  readonly N = 512;
  readonly heights: Float32Array;
  /** r road, g forest floor, b bank/sand, a rock. */
  readonly splat: Uint8Array;
  readonly waterLevel: number;
  readonly hasWater: boolean;
  readonly forest: Float32Array;
  readonly fort: Fort | null = null;
  private readonly noise: Noise;

  constructor(readonly spec: FieldSpec) {
    const N = this.N;
    this.noise = new Noise(spec.seed);
    this.heights = new Float32Array(N * N);
    this.splat = new Uint8Array(N * N * 4);
    this.forest = new Float32Array(N * N);
    this.hasWater = !!spec.river;
    this.waterLevel = spec.river ? -spec.river.depth * 0.35 : -100;
    const S = spec.size;
    const nz = this.noise;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1) - 0.5) * S;
        const z = (j / (N - 1) - 0.5) * S;
        const u = x / 900;
        const v = z / 900;
        let h = nz.fbm(u, v, 5) * 34 * spec.hills + nz.ridge(u * 0.6 + 3, v * 0.6, 4) * 30 * spec.hills;
        // The edges rise a little (a valley feel, and the map ends in hills not a cliff).
        const e = Math.max(Math.abs(x), Math.abs(z)) / (S / 2);
        h += Math.max(0, e - 0.72) ** 2 * 260;
        for (const [bx, bz, r, bh] of spec.bumps ?? []) {
          const d = Math.hypot(x - bx, z - bz) / r;
          if (d < 1) h += bh * (0.5 + 0.5 * Math.cos(d * Math.PI));
        }
        this.heights[j * N + i] = h;
        const f = nz.fbm(u * 2.2 + 11, v * 2.2 - 7, 4);
        this.forest[j * N + i] = f;
      }
    // Only the river holds water: lift the land so no valley sinks below it.
    let min = Infinity;
    for (const h of this.heights) min = Math.min(min, h);
    const lift = 1.2 - min;
    for (let k = 0; k < this.heights.length; k++) this.heights[k] += lift;
    if (spec.river) this.carveRiver(spec.river);
    for (const road of spec.roads ?? []) this.paintRoad(road);
    this.finishSplat();
    if (spec.fort) {
      this.fort = new Fort(spec.fort, this);
      if (spec.fort.mound) {
        const [bx, bz, r, bh] = spec.fort.mound;
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            const x = (i / (N - 1) - 0.5) * S;
            const z = (j / (N - 1) - 0.5) * S;
            const d = Math.hypot(x - bx, z - bz) / r;
            // A flat-topped heap of rammed earth.
            if (d < 1) {
              const k = j * N + i;
              this.heights[k] = Math.max(this.heights[k], this.heights[k] * 0.3 + (this.heights[k] * 0.7 + bh) * Math.min(1, (1 - d) * 2.2));
              this.splat[k * 4 + 2] = Math.max(this.splat[k * 4 + 2], 170);
              this.splat[k * 4 + 1] = 0;
            }
          }
        this.fort.markRamps();
      }
      // No forest inside the walls or right under them.
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1) - 0.5) * S;
          const z = (j / (N - 1) - 0.5) * S;
          const zn = this.fort.zoneAt(x, z);
          const k = j * N + i;
          if (zn !== 0 || this.nearFort(x, z)) this.splat[k * 4 + 1] = 0;
          if (zn === 2) this.splat[k * 4] = Math.max(this.splat[k * 4], Math.round(90 * Math.max(0, this.noise.fbm(x / 30, z / 30, 3) + 0.2)));
        }
    }
  }

  private nearFort(x: number, z: number): boolean {
    const f = this.fort!;
    return x > f.x0 - 30 && z > f.z0 - 30 && x < f.x0 + f.nx + 30 && z < f.z0 + f.nz + 30 && Math.hypot(x - f.cx, z - f.cz) < Math.max(f.nx, f.nz) * 0.62 + 30;
  }

  /** Where a man stands: on the wall walk if he's on the wall, else on the ground. */
  stand(x: number, z: number): number {
    return this.fort ? this.fort.stand(x, z) : this.height(x, z);
  }

  private idx(x: number, z: number): [number, number] {
    const N = this.N;
    return [((x / this.spec.size) + 0.5) * (N - 1), ((z / this.spec.size) + 0.5) * (N - 1)];
  }

  private eachNear(pts: [number, number][], reach: number, fn: (k: number, d: number, t: number) => void): void {
    const N = this.N;
    const S = this.spec.size;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1) - 0.5) * S;
        const z = (j / (N - 1) - 0.5) * S;
        let best = Infinity;
        let bt = 0;
        let acc = 0;
        for (let s = 0; s + 1 < pts.length; s++) {
          const [ax, az] = pts[s];
          const [bx, bz] = pts[s + 1];
          const dx = bx - ax;
          const dz = bz - az;
          const l2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < best) {
            best = d;
            bt = acc + t * Math.sqrt(l2);
          }
          acc += Math.sqrt(l2);
        }
        if (best < reach) fn(j * N + i, best, bt);
      }
  }

  private carveRiver(r: NonNullable<FieldSpec["river"]>): void {
    const w = r.width;
    this.eachNear(r.pts, w * 3.5, (k, d, t) => {
      const i = k % this.N;
      const j = Math.floor(k / this.N);
      const x = (i / (this.N - 1) - 0.5) * this.spec.size;
      const z = (j / (this.N - 1) - 0.5) * this.spec.size;
      // Wander the banks a little.
      const wob = this.noise.n2(t / 80, 3.3) * w * 0.25;
      const dd = Math.max(0, d + wob);
      let depth = r.depth;
      for (const [fx, fz, fr] of r.fords) if (Math.hypot(x - fx, z - fz) < fr) depth = Math.min(depth, 0.9 + Math.hypot(x - fx, z - fz) / fr * 0.4);
      const bed = -depth;
      const u = dd / (w * 0.5);
      if (u < 1) this.heights[k] = bed * (1 - u * u) + this.heights[k] * 0.0 + Math.min(this.heights[k], 0.5) * u * u;
      else {
        // Flood plain easing back up to the land.
        const s = Math.min(1, (u - 1) / 5);
        this.heights[k] = 0.5 + (this.heights[k] * 0.55 - 0.5) * s * s + this.heights[k] * 0.45 * s;
      }
      this.splat[k * 4 + 2] = Math.max(this.splat[k * 4 + 2], Math.round(255 * Math.max(0, 1 - Math.abs(u - 1.05) / 0.7)));
    });
  }

  private paintRoad(pts: [number, number][]): void {
    this.eachNear(pts, 9, (k, d) => {
      const v = Math.max(0, 1 - d / 5.5);
      this.splat[k * 4] = Math.max(this.splat[k * 4], Math.round(v * 230 + (this.noise.n2(k * 0.013, 1) * 20)));
      // Roads flatten the ground a touch.
      this.heights[k] = this.heights[k] * (1 - v * 0.15) + this.smoothAt(k) * v * 0.15;
    });
  }

  private smoothAt(k: number): number {
    const N = this.N;
    let s = 0;
    let n = 0;
    for (const o of [-1, 1, -N, N]) {
      const q = k + o;
      if (q >= 0 && q < N * N) {
        s += this.heights[q];
        n++;
      }
    }
    return s / n;
  }

  private finishSplat(): void {
    const N = this.N;
    const S = this.spec.size;
    const cell = S / (N - 1);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hx = this.heights[Math.min(N - 1, i + 1) + j * N] - this.heights[Math.max(0, i - 1) + j * N];
        const hz = this.heights[i + Math.min(N - 1, j + 1) * N] - this.heights[i + Math.max(0, j - 1) * N];
        const slope = Math.hypot(hx, hz) / (2 * cell);
        this.splat[k * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (slope - 0.42) * 3)));
        const inForest = this.forest[k] > 0.55 - this.spec.forest * 0.3 && this.heights[k] > this.waterLevel + 1.5 && this.splat[k * 4] < 60 && slope < 0.6;
        this.splat[k * 4 + 1] = inForest ? 255 : 0;
      }
  }

  /** Bilinear height at world (x, z). */
  height(x: number, z: number): number {
    const N = this.N;
    const [fx, fz] = this.idx(x, z);
    const i = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i));
    const v = Math.max(0, Math.min(1, fz - j));
    const h = this.heights;
    const a = h[j * N + i];
    const b = h[j * N + i + 1];
    const c = h[(j + 1) * N + i];
    const d = h[(j + 1) * N + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  /** Ground or water surface under (x, z), and how deep the water is there. */
  surface(x: number, z: number): { y: number; wet: number } {
    const h = this.height(x, z);
    const wet = this.hasWater ? Math.max(0, this.waterLevel - h) : 0;
    return { y: h, wet };
  }

  sample(x: number, z: number, ch: number): number {
    const N = this.N;
    const [fx, fz] = this.idx(x, z);
    const i = Math.max(0, Math.min(N - 1, Math.round(fx)));
    const j = Math.max(0, Math.min(N - 1, Math.round(fz)));
    return this.splat[(j * N + i) * 4 + ch] / 255;
  }

  isForest(x: number, z: number): boolean {
    return this.sample(x, z, 1) > 0.5;
  }

  /** Textures for the GPU: height (R32F) and splat (RGBA8). */
  textures(): { height: THREE.DataTexture; splat: THREE.DataTexture } {
    const N = this.N;
    const height = new THREE.DataTexture(this.heights, N, N, THREE.RedFormat, THREE.FloatType);
    height.magFilter = height.minFilter = THREE.LinearFilter;
    height.needsUpdate = true;
    const splat = new THREE.DataTexture(this.splat, N, N, THREE.RGBAFormat);
    splat.magFilter = splat.minFilter = THREE.LinearFilter;
    splat.needsUpdate = true;
    return { height, splat };
  }
}

// ------------------------------------------------------------------ ground

export interface WorldUniforms {
  uHeight: { value: THREE.Texture };
  uSplat: { value: THREE.Texture };
  uSize: { value: number };
  uTime: { value: number };
  uWater: { value: number };
  uWind: { value: THREE.Vector2 };
  uCam: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
}

export function groundMesh(f: Field, U: WorldUniforms): THREE.Mesh {
  const S = f.spec.size;
  const seg = 384;
  const geo = new THREE.PlaneGeometry(S, S, seg, seg).rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) p.setY(k, f.height(p.getX(k), p.getZ(k)));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;\nvarying vec3 vWN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vW;
varying vec3 vWN;
uniform sampler2D uSplat;
uniform float uSize;
uniform float uWater;
uniform float uTime;
float gRough = 0.92;
${GLSL_NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec2 uv = vW.xz / uSize + 0.5;
  vec4 sp = texture2D(uSplat, uv);
  float n1 = fbm2(vW.xz * 0.045);
  float n2 = fbm2(vW.xz * 0.31 + 5.0);
  float n3 = vnoise(vW.xz * 2.1);
  vec3 grassA = vec3(0.30, 0.42, 0.14);
  vec3 grassB = vec3(0.46, 0.50, 0.20);
  vec3 dry = vec3(0.62, 0.56, 0.32);
  vec3 dirt = vec3(0.45, 0.35, 0.24);
  vec3 sand = vec3(0.62, 0.56, 0.44);
  vec3 rock = vec3(0.47, 0.46, 0.43);
  vec3 floorC = vec3(0.22, 0.24, 0.12);
  vec3 c = mix(grassA, grassB, smoothstep(0.35, 0.7, n1));
  c = mix(c, dry, smoothstep(0.7, 0.9, n1 + n2 * 0.3) * 0.45);
  c *= 0.86 + 0.28 * n2 + 0.1 * n3;
  c = mix(c, floorC * (0.8 + 0.4 * n2), sp.g * 0.85);
  float road = smoothstep(0.25, 0.6, sp.r + (n3 - 0.5) * 0.25);
  c = mix(c, dirt * (0.85 + 0.3 * n3), road);
  float bank = smoothstep(0.2, 0.7, sp.b + (n2 - 0.5) * 0.3);
  c = mix(c, sand * (0.85 + 0.25 * n3), bank);
  float slope = 1.0 - vWN.y;
  float rk = max(sp.a, smoothstep(0.35, 0.55, slope + (n2 - 0.5) * 0.2));
  c = mix(c, rock * (0.75 + 0.5 * n2) * (0.9 + 0.2 * n3), rk);
  // Wet darkening near the waterline, mud under it.
  float wetBand = smoothstep(1.2, 0.0, vW.y - uWater);
  c *= 1.0 - wetBand * 0.35;
  // Cloud shadows drifting across the field.
  float cloud = smoothstep(0.48, 0.72, fbm2(vW.xz * 0.0022 + vec2(uTime * 0.006, uTime * 0.003)));
  c *= 1.0 - cloud * 0.32;
  diffuseColor.rgb = pow(c, vec3(2.2));
  gRough = mix(0.95, 0.55, wetBand) - rk * 0.1;
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;");
  };
  mat.customProgramCacheKey = () => "ground";
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ water

export function waterMesh(f: Field, U: WorldUniforms, sky: THREE.Color): THREE.Mesh {
  const S = f.spec.size;
  const geo = new THREE.PlaneGeometry(S, S, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { ...U, uSky: { value: sky } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uHeight; uniform float uSize, uTime, uWater; uniform vec3 uCam, uSunDir, uSky;
      varying vec3 vW;
      ${GLSL_NOISE}
      void main() {
        vec2 uv = vW.xz / uSize + 0.5;
        float ground = texture2D(uHeight, uv).r;
        float depth = uWater - ground;
        if (depth < -0.05) discard;
        vec2 p = vW.xz * 0.35;
        float e = 0.08;
        float h0 = fbm2(p + uTime * vec2(0.18, 0.11));
        float hx = fbm2(p + vec2(e, 0.0) + uTime * vec2(0.18, 0.11));
        float hz = fbm2(p + vec2(0.0, e) + uTime * vec2(0.18, 0.11));
        vec3 n = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
        vec3 v = normalize(uCam - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 deep = vec3(0.05, 0.16, 0.18);
        vec3 shallow = vec3(0.24, 0.36, 0.30);
        vec3 col = pow(mix(shallow, deep, smoothstep(0.0, 2.5, depth)), vec3(2.2));
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 180.0) * 3.0;
        col = mix(col, uSky * 0.9, fres * 0.8) + spec;
        float foam = smoothstep(0.35, 0.0, depth) * (0.55 + 0.45 * vnoise(vW.xz * 1.5 + uTime * 0.6));
        col = mix(col, vec3(0.75), foam * 0.5);
        float a = smoothstep(-0.05, 0.4, depth) * mix(0.72, 0.95, fres);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = f.waterLevel;
  m.renderOrder = 2;
  return m;
}

// ------------------------------------------------------------------ grass

/** A field of blades on a grid that follows the camera (tiled by `wrap` so it never pops). */
export function grassMesh(U: WorldUniforms, count = 90000, radius = 95): THREE.Mesh {
  const blade = new THREE.BufferGeometry();
  // Three-segment tapered blade.
  const pos = [-0.06, 0, 0, 0.06, 0, 0, -0.045, 0.33, 0.02, 0.045, 0.33, 0.02, -0.025, 0.66, 0.05, 0.025, 0.66, 0.05, 0, 1, 0.1];
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
  blade.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  blade.setIndex(idx);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  const offs = new Float32Array(count * 4);
  const R = rng(99);
  const side = Math.sqrt(count);
  for (let k = 0; k < count; k++) {
    const i = k % side;
    const j = Math.floor(k / side);
    offs[k * 4] = ((i + R()) / side - 0.5) * radius * 2;
    offs[k * 4 + 1] = ((j + R()) / side - 0.5) * radius * 2;
    offs[k * 4 + 2] = R() * Math.PI * 2;
    offs[k * 4 + 3] = 0.22 + R() * 0.3;
  }
  geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(offs, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uRadius: { value: radius } }]),
    fog: true,
    vertexShader: /* glsl */ `
      uniform sampler2D uHeight, uSplat; uniform float uSize, uTime, uWater, uRadius; uniform vec2 uWind; uniform vec3 uCam;
      attribute vec4 aOff;
      varying float vY; varying vec3 vCol; varying float vFade;
      #include <fog_pars_vertex>
      ${GLSL_NOISE}
      void main() {
        // Wrap the patch around the camera.
        vec2 wp = uCam.xz + mod(aOff.xy - uCam.xz + uRadius, 2.0 * uRadius) - uRadius;
        vec2 uv = wp / uSize + 0.5;
        float gh = texture2D(uHeight, uv).r;
        vec4 sp = texture2D(uSplat, uv);
        float dens = (1.0 - sp.r) * (1.0 - sp.a) * (1.0 - sp.b * 0.8) * (1.0 - sp.g * 0.6) * step(uWater + 0.3, gh);
        float patchy = smoothstep(0.25, 0.6, vnoise(wp * 0.07));
        float d = length(wp - uCam.xz) / uRadius;
        vFade = 1.0 - smoothstep(0.7, 1.0, d);
        float h = aOff.w * (0.35 + 0.65 * patchy) * dens * vFade * (0.8 + 0.4 * vnoise(wp * 0.5));
        vec3 p = position;
        float c = cos(aOff.z), s = sin(aOff.z);
        p.xz = mat2(c, -s, s, c) * p.xz;
        float y = position.y;
        // Wind: a slow gust field plus flutter.
        float gust = vnoise(wp * 0.04 + uTime * vec2(0.25, 0.12));
        vec2 bend = (uWind * (0.4 + gust) + vec2(sin(uTime * 2.3 + wp.x), cos(uTime * 1.9 + wp.y)) * 0.12) * y * y;
        vec3 world = vec3(wp.x + p.x + bend.x * h, gh + p.y * h, wp.y + p.z + bend.y * h);
        vY = y;
        vCol = mix(vec3(0.30, 0.42, 0.14), vec3(0.50, 0.50, 0.22), smoothstep(0.45, 0.9, vnoise(wp * 0.02 + 3.0)));
        vCol *= 0.8 + 0.4 * vnoise(wp * 0.9);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        if (h < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vY; varying vec3 vCol; varying float vFade;
      uniform vec3 uSunDir;
      #include <fog_pars_fragment>
      void main() {
        vec3 c = pow(vCol, vec3(2.2)) * mix(0.35, 1.1, vY);
        c += vec3(0.5, 0.45, 0.2) * pow(vY, 3.0) * 0.08 * max(uSunDir.y, 0.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // The shared world uniforms stay shared (merge() would have cloned them).
  Object.assign(mat.uniforms, U);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------ trees

export function forest(f: Field, max = 9000): THREE.Group {
  const g = new THREE.Group();
  // Pines (소나무/잣나무): tiers of drooping boughs; broadleaf (참나무): a lumpy crown of three masses.
  const tiers: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const r = 2.9 - k * 0.6;
    const c = new THREE.ConeGeometry(r, 3.8 - k * 0.3, 9, 1, true).translate(0, 5.2 + k * 2.3, 0);
    // Droop the rim and jitter it so the silhouette isn't a clean cone.
    const p = c.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 5.2 + k * 2.3 - 1) p.setY(i, y - 0.35 * Math.sin(i * 1.7) - 0.3);
    }
    c.computeVertexNormals();
    tiers.push(c);
  }
  const pineGeo = mergeSimple(tiers);
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 5, 6).translate(0, 2.5, 0);
  const blobs = [new THREE.SphereGeometry(3.0, 14, 10).translate(0, 7.2, 0), new THREE.SphereGeometry(2.3, 12, 9).translate(1.6, 6.2, 0.6), new THREE.SphereGeometry(2.2, 12, 9).translate(-1.4, 6.5, -0.8)];
  for (const b of blobs) {
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const w = 1 + 0.12 * Math.sin(p.getX(i) * 2.1 + p.getY(i) * 1.3) * Math.cos(p.getZ(i) * 1.7);
      p.setXYZ(i, p.getX(i) * w, p.getY(i) * (0.9 + (w - 1)), p.getZ(i) * w);
    }
    b.computeVertexNormals();
  }
  const leafy = mergeSimple(blobs);
  const R = rng(f.spec.seed * 3 + 1);
  const mPine = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ color: 0x2c4a2a, roughness: 0.95, side: THREE.DoubleSide }), max);
  const mLeaf = new THREE.InstancedMesh(leafy, new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 0.9 }), max);
  const mTrunk = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), max * 2);
  let np = 0;
  let nl = 0;
  let nt = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const S = f.spec.size;
  for (let tries = 0; tries < max * 8 && np + nl < max; tries++) {
    const x = (R() - 0.5) * S * 0.98;
    const z = (R() - 0.5) * S * 0.98;
    const inside = f.isForest(x, z);
    if (!inside && R() > 0.012) continue;
    const s = f.surface(x, z);
    if (s.wet > 0 || f.sample(x, z, 0) > 0.2 || f.sample(x, z, 3) > 0.6) continue;
    const sc = 0.7 + R() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
    m4.compose(new THREE.Vector3(x, s.y - 0.3, z), q, new THREE.Vector3(sc, sc * (0.85 + R() * 0.4), sc));
    col.setHSL(0.24 + R() * 0.07, 0.3 + R() * 0.18, 0.13 + R() * 0.09);
    if (R() < 0.62) {
      mPine.setMatrixAt(np, m4);
      mPine.setColorAt(np++, col);
    } else {
      mLeaf.setMatrixAt(nl, m4);
      mLeaf.setColorAt(nl++, col.offsetHSL(0.03, 0, 0.06));
    }
    mTrunk.setMatrixAt(nt++, m4);
  }
  for (const [m, n] of [
    [mPine, np],
    [mLeaf, nl],
    [mTrunk, nt],
  ] as [THREE.InstancedMesh, number][]) {
    m.count = n;
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    g.add(m);
  }
  return g;
}

function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of gs) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
