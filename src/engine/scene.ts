/**
 * Renderer and look: an atmospheric sky (Preetham) with a low golden sun, the sky baked into an
 * environment map so lamellar armour and helmets catch it, exponential fog in the sky's
 * horizon colour, a fitted shadow box that follows the camera, and a post chain: multisampled
 * render, gentle bloom, then a grade (warm lift, contrast, vignette) before tone mapping.
 */
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export interface Look {
  sunElev: number;
  sunAz: number;
  turbidity: number;
  rayleigh: number;
  fog: number;
  exposure: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6000);
  readonly sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  readonly sunDir = new THREE.Vector3();
  readonly horizon = new THREE.Color();
  private readonly composer: EffectComposer;
  private readonly sky = new Sky();

  /** Everything a battle adds (ground, water, men); cleared between battles. */
  readonly world = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = r;
    this.scene.add(this.world, this.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(0xc8dcff, 0x6a5a3a, 0.55));
    // Post.
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(size, 0.1, 0.4, 3.0));
    this.composer.addPass(new ShaderPass(GRADE));
    this.composer.addPass(new OutputPass());
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  private env: THREE.WebGLRenderTarget | null = null;

  /** Sky, sun, fog and the environment light for a battle's time of day. */
  setLook(look: Look): void {
    const r = this.renderer;
    r.toneMappingExposure = look.exposure;
    // Sky and sun.
    this.sky.scale.setScalar(5000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = look.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const phi = THREE.MathUtils.degToRad(90 - look.sunElev);
    const theta = THREE.MathUtils.degToRad(look.sunAz);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    // Environment from the sky (for armour and water).
    const pm = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.turbidity, { value: look.turbidity });
    sky2.material.uniforms.rayleigh.value = look.rayleigh;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    this.env?.dispose();
    this.env = pm.fromScene(envScene, 0, 0.1, 2000);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.4;
    pm.dispose();
    // Horizon colour for the fog: the sky just above the horizon, opposite-ish the sun.
    const elev = look.sunElev;
    this.horizon.setRGB(0.66 + (elev < 20 ? 0.12 : 0), 0.7 + (elev < 20 ? 0.02 : 0.02), 0.76 - (elev < 20 ? 0.12 : 0), THREE.SRGBColorSpace);
    this.scene.fog = new THREE.FogExp2(this.horizon, look.fog);
    this.sun.position.copy(this.sunDir).multiplyScalar(800);
    this.sun.color.setHSL(0.09, 0.6, look.sunElev < 20 ? 0.78 : 0.9);
  }

  clearWorld(): void {
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.world.clear();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow box around what the camera looks at, sized to the view. */
  fitShadows(target: THREE.Vector3, radius: number): void {
    const s = this.sun;
    s.target.position.copy(target);
    s.position.copy(target).addScaledVector(this.sunDir, 900);
    const c = s.shadow.camera;
    const r = Math.max(40, Math.min(900, radius));
    c.left = c.bottom = -r;
    c.right = c.top = r;
    c.near = 100;
    c.far = 2200;
    c.updateProjectionMatrix();
  }

  render(): void {
    this.composer.render();
  }
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.28 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 x = c.rgb;
      // Warm highlights, cool shadows, a touch of contrast and saturation.
      float l = dot(x, vec3(0.299, 0.587, 0.114));
      x = mix(vec3(l), x, 1.08);
      x *= mix(vec3(0.95, 0.98, 1.05), vec3(1.05, 1.0, 0.93), smoothstep(0.1, 0.8, l));
      x = pow(max(x, 0.0), vec3(1.04));
      vec2 d = vUv - 0.5;
      x *= 1.0 - uVig * dot(d, d) * 2.2;
      gl_FragColor = vec4(x, c.a);
    }`,
};
