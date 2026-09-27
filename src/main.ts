/**
 * 고구려 — the shell: the title and the choice of battle, the briefing, and the battle itself:
 * a general's camera, selecting units (click, shift-click, drag a box, the cards), orders
 * (right-click ground to march, an enemy to attack, right-drag to lay out a battle line of any
 * width and facing), run / halt / loose at will, time controls, and the reckoning at the end.
 */
import * as THREE from "three";
import "./style.css";
import { BattleAudio } from "./audio";
import { Stage } from "./engine/scene";
import { SCENARIOS, type Scenario } from "./scenarios";
import { Ai } from "./sim/ai";
import { Battle, type Unit } from "./sim/battle";
import { ArmyView } from "./units/armyView";
import { Dust, Standards } from "./units/effects";
import { Field, forest, grassMesh, groundMesh, waterMesh, type WorldUniforms } from "./world/terrain";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const audio = new BattleAudio();

let stage: Stage | null = null;
let field: Field | null = null;
let battle: Battle | null = null;
let army: ArmyView | null = null;
let ai: Ai | null = null;
let dust: Dust | null = null;
let standards: Standards | null = null;
let U: WorldUniforms | null = null;
let scen: Scenario | null = null;
let speed = 0;
let started = false;
let over = false;

const cam = { x: 0, z: 0, dist: 300, yaw: 0, pitch: 0.6 };
const keys = new Set<string>();

// ------------------------------------------------------------------ UI skeleton

ui.innerHTML = `
<div id="title" class="screen">
  <div class="hero">
    <div class="mark">高句麗</div>
    <h1>고구려</h1>
    <p class="tag">개마무사의 돌격 · 맥궁의 화살 · 수·당 대군과의 결전</p>
    <div id="scens"></div>
    <p class="fine">마우스: 왼쪽 선택 · 오른쪽 명령 · 오른쪽 드래그로 전열 · 휠 확대 · WASD / 가장자리 이동 · Q E 회전</p>
  </div>
</div>
<div id="brief" class="screen off"><div class="scroll"><div class="yr" id="byear"></div><h2 id="btitle"></h2><div class="sub" id="bsub"></div><div id="bstory"></div><p class="goal" id="bgoal"></p><button id="go">전투 개시</button><button id="back" class="ghost">돌아가기</button></div></div>
<div id="hud" class="off">
  <div id="top"><div id="tname"></div><div id="bal"><i id="balA"></i><i id="balB"></i><span id="clock">0:00</span></div>
    <div class="spd"><button data-s="0">Ⅱ</button><button data-s="1">▶</button><button data-s="2">▶▶</button><button data-s="3">▶▶▶</button><button id="snd">🔊</button><button id="quit">✕</button></div></div>
  <div id="log"></div>
  <div id="orders" class="off"><button id="oRun">달리기 <kbd>R</kbd></button><button id="oHalt">정지 <kbd>⌫</kbd></button><button id="oFire">자유 사격 <kbd>F</kbd></button><button id="oWide">넓게</button><button id="oDeep">좁게</button></div>
  <div id="cards"></div>
  <div id="box"></div>
  <div id="help">왼쪽 클릭: 선택 · Shift: 추가 · 드래그: 범위 선택 · 오른쪽 클릭: 이동/공격 · 오른쪽 드래그: 전열 · Ctrl+A: 전군</div>
</div>
<div id="end" class="screen off"><div class="scroll"><h2 id="etitle"></h2><div id="estats"></div><button id="again">다시 싸운다</button><button id="menu" class="ghost">전장 선택</button></div></div>`;
const $ = (s: string) => document.getElementById(s)!;

$("scens").innerHTML = SCENARIOS.map(
  (s, i) => `<button class="scen" data-i="${i}"><span class="y">${s.year}</span><b>${s.title}</b><span class="s">${s.sub}</span></button>`,
).join("");
$("scens").querySelectorAll<HTMLButtonElement>(".scen").forEach((b) => (b.onclick = () => brief(SCENARIOS[+b.dataset.i!])));

function brief(s: Scenario): void {
  audio.start();
  scen = s;
  $("title").classList.add("off");
  $("brief").classList.remove("off");
  $("byear").textContent = s.year;
  $("btitle").textContent = s.title;
  $("bsub").textContent = s.sub;
  $("bstory").innerHTML = s.story.map((l) => `<p>${l}</p>`).join("");
  $("bgoal").textContent = s.goal;
  load(s);
}
$("back").onclick = () => {
  $("brief").classList.add("off");
  $("title").classList.remove("off");
};
$("go").onclick = () => {
  $("brief").classList.add("off");
  $("hud").classList.remove("off");
  started = true;
  setSpeed(1);
  audio.horn();
  log("북이 울린다. 전투 개시!", "gold");
};
$("again").onclick = () => {
  if (!scen) return;
  $("end").classList.add("off");
  brief(scen);
};
$("menu").onclick = () => location.reload();
$("quit").onclick = () => location.reload();
$("snd").onclick = () => {
  audio.muted = !audio.muted;
  $("snd").textContent = audio.muted ? "🔇" : "🔊";
};
document.querySelectorAll<HTMLButtonElement>(".spd button[data-s]").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.s!)));

function setSpeed(s: number): void {
  speed = s;
  document.querySelectorAll<HTMLButtonElement>(".spd button[data-s]").forEach((b) => b.classList.toggle("on", +b.dataset.s! === s));
}

function log(t: string, kind = ""): void {
  const d = document.createElement("div");
  d.className = kind;
  d.textContent = t;
  $("log").prepend(d);
  setTimeout(() => d.classList.add("gone"), 8000);
  setTimeout(() => d.remove(), 9000);
  while ($("log").children.length > 6) $("log").lastElementChild?.remove();
}

// ------------------------------------------------------------------ building a battle

function load(s: Scenario): void {
  stage ??= new Stage(canvas);
  stage.clearWorld();
  stage.setLook(s.look);
  field = new Field(s.field);
  const tex = field.textures();
  U = {
    uHeight: { value: tex.height },
    uSplat: { value: tex.splat },
    uSize: { value: field.spec.size },
    uTime: { value: 0 },
    uWater: { value: field.waterLevel },
    uWind: { value: new THREE.Vector2(0.55, 0.25) },
    uCam: { value: new THREE.Vector3() },
    uSunDir: { value: stage.sunDir.clone() },
  };
  stage.world.add(groundMesh(field, U));
  if (field.hasWater) stage.world.add(waterMesh(field, U, new THREE.Color(0.55, 0.62, 0.7)));
  const grass = grassMesh(U);
  stage.world.add(grass);
  stage.world.add(forest(field));
  battle = new Battle(field);
  s.setup(battle);
  army = new ArmyView(battle);
  stage.world.add(army.root);
  dust = new Dust(battle);
  stage.world.add(dust.points);
  standards = new Standards(battle);
  stage.world.add(standards.group);
  ai = new Ai(battle, 1);
  Object.assign(cam, s.cam);
  over = false;
  started = false;
  speed = 0;
  buildCards();
  $("tname").innerHTML = `<b>${s.title}</b> <small>${s.year}</small>`;
}

// ------------------------------------------------------------------ cards and orders

function mine(): Unit[] {
  return battle ? battle.units.filter((u) => u.side === 0) : [];
}
function selected(): Unit[] {
  return mine().filter((u) => u.selected && u.state !== "gone");
}

const ICON: Record<string, string> = { hcav: "騎", cav: "騎", hbow: "射", spear: "槍", sword: "刀", axe: "斧", bow: "弓", general: "將" };
function buildCards(): void {
  $("cards").innerHTML = mine()
    .map((u) => `<div class="card" data-u="${u.id}"><div class="ic">${ICON[u.type.role]}</div><div class="nm">${u.name}</div><div class="mn"></div><div class="mo"><i></i></div><div class="st"></div></div>`)
    .join("");
  $("cards").querySelectorAll<HTMLElement>(".card").forEach((el) => {
    el.onmousedown = (e) => {
      e.stopPropagation();
      const u = battle!.units[+el.dataset.u!];
      if (!e.shiftKey) for (const m of mine()) m.selected = false;
      u.selected = !u.selected || !e.shiftKey;
      refreshOrders();
    };
    el.ondblclick = () => {
      const [x, z] = battle!.pos(battle!.units[+el.dataset.u!]);
      cam.x = x;
      cam.z = z;
    };
  });
}
function updateCards(): void {
  if (!battle) return;
  $("cards").querySelectorAll<HTMLElement>(".card").forEach((el) => {
    const u = battle!.units[+el.dataset.u!];
    const men = battle!.livingMen(u);
    el.classList.toggle("sel", u.selected);
    el.classList.toggle("dead", u.state === "gone");
    el.classList.toggle("rout", u.state === "routing");
    (el.querySelector(".mn") as HTMLElement).textContent = `${men}/${u.start}`;
    const m = Math.max(0, Math.min(1, u.morale / 100));
    const bar = el.querySelector(".mo i") as HTMLElement;
    bar.style.width = `${m * 100}%`;
    bar.style.background = m > 0.5 ? "#6fd06a" : m > 0.25 ? "#e8c040" : "#e04a3a";
    const st: Record<string, string> = { ready: "대기", moving: "이동", fighting: "교전", shooting: "사격", routing: "패주", gone: "전멸" };
    (el.querySelector(".st") as HTMLElement).textContent = st[u.state] + (u.ammo && u.type.range ? ` · 화살 ${u.ammo}` : "");
  });
}
function refreshOrders(): void {
  const s = selected();
  $("orders").classList.toggle("off", !s.length);
  $("oFire").style.display = s.some((u) => u.type.range > 0) ? "" : "none";
  $("oFire").classList.toggle("on", s.some((u) => u.fireAtWill && u.type.range > 0));
  $("oRun").classList.toggle("on", runMode);
}
let runMode = false;
$("oRun").onclick = () => {
  runMode = !runMode;
  for (const u of selected()) if (u.order.k !== "hold") u.order = { ...u.order, run: runMode } as typeof u.order;
  refreshOrders();
};
$("oHalt").onclick = () => halt();
$("oFire").onclick = () => {
  const s = selected();
  const on = !s.some((u) => u.fireAtWill && u.type.range > 0);
  for (const u of s) u.fireAtWill = on;
  refreshOrders();
};
$("oWide").onclick = () => reshape(1.35);
$("oDeep").onclick = () => reshape(1 / 1.35);
function halt(): void {
  for (const u of selected()) {
    const [x, z] = battle!.pos(u);
    battle!.order(u, { k: "move", x, z, face: u.face, run: false });
  }
}
function reshape(k: number): void {
  for (const u of selected()) {
    const [x, z] = battle!.pos(u);
    battle!.order(u, { k: "move", x, z, face: u.face, files: Math.round(u.files * k), run: false });
  }
}

// ------------------------------------------------------------------ picking

const ray = new THREE.Raycaster();
function groundAt(cx: number, cy: number): THREE.Vector3 | null {
  if (!stage || !field) return null;
  ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1), stage.camera);
  // March along the ray until it goes under the ground.
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  let prev = 0;
  for (let t = 1; t < 5000; t += Math.max(1, t * 0.01)) {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (o.y + d.y * t < field.height(x, z)) {
      // Refine.
      let a = prev;
      let b = t;
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m < field.height(o.x + d.x * m, o.z + d.z * m)) b = m;
        else a = m;
      }
      return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
    }
    prev = t;
  }
  return null;
}
function unitAt(p: THREE.Vector3, r = 3.5): Unit | null {
  if (!battle) return null;
  let best = -1;
  let bd = r * r;
  battle.near(p.x, p.z, r, (j, d2) => {
    if (d2 < bd) {
      bd = d2;
      best = j;
    }
  });
  return best >= 0 ? battle.units[battle.unit[best]] : null;
}
function project(x: number, z: number): [number, number] {
  const v = new THREE.Vector3(x, field!.height(x, z) + 1, z).project(stage!.camera);
  return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
}

let lDrag: { x: number; y: number; moved: boolean } | null = null;
let rDrag: { x: number; y: number; p: THREE.Vector3 | null; moved: boolean; t: number } | null = null;
let mDrag: { x: number; y: number } | null = null;
let lastRight = 0;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  if (!battle || !started) return;
  canvas.setPointerCapture(e.pointerId);
  audio.start();
  if (e.button === 0) lDrag = { x: e.clientX, y: e.clientY, moved: false };
  else if (e.button === 2) rDrag = { x: e.clientX, y: e.clientY, p: groundAt(e.clientX, e.clientY), moved: false, t: performance.now() };
  else if (e.button === 1) mDrag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (mDrag) {
    cam.yaw -= (e.clientX - mDrag.x) * 0.005;
    cam.pitch = Math.max(0.12, Math.min(1.4, cam.pitch + (e.clientY - mDrag.y) * 0.004));
    mDrag = { x: e.clientX, y: e.clientY };
  }
  if (lDrag && Math.hypot(e.clientX - lDrag.x, e.clientY - lDrag.y) > 6) {
    lDrag.moved = true;
    const bx = $("box");
    bx.style.display = "block";
    bx.style.left = `${Math.min(e.clientX, lDrag.x)}px`;
    bx.style.top = `${Math.min(e.clientY, lDrag.y)}px`;
    bx.style.width = `${Math.abs(e.clientX - lDrag.x)}px`;
    bx.style.height = `${Math.abs(e.clientY - lDrag.y)}px`;
  }
  if (rDrag && rDrag.p && Math.hypot(e.clientX - rDrag.x, e.clientY - rDrag.y) > 10) {
    rDrag.moved = true;
    const q = groundAt(e.clientX, e.clientY);
    if (q) army?.setGhost(lineSlots(rDrag.p, q).flatMap((l) => l.slots), 0x9affd0);
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (!battle) return;
  if (e.button === 0 && lDrag) {
    if (lDrag.moved) {
      const x0 = Math.min(e.clientX, lDrag.x);
      const x1 = Math.max(e.clientX, lDrag.x);
      const y0 = Math.min(e.clientY, lDrag.y);
      const y1 = Math.max(e.clientY, lDrag.y);
      if (!e.shiftKey) for (const u of mine()) u.selected = false;
      for (const u of mine()) {
        if (u.state === "gone") continue;
        const [px, py] = project(...battle.pos(u));
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) u.selected = true;
      }
    } else {
      const p = groundAt(e.clientX, e.clientY);
      const u = p ? unitAt(p) : null;
      if (!e.shiftKey) for (const m of mine()) m.selected = false;
      if (u && u.side === 0) u.selected = true;
    }
    $("box").style.display = "none";
    lDrag = null;
    refreshOrders();
  } else if (e.button === 2 && rDrag) {
    const sel = selected();
    const now = performance.now();
    const dbl = now - lastRight < 350;
    lastRight = now;
    const run = runMode || dbl;
    const q = groundAt(e.clientX, e.clientY);
    if (sel.length && rDrag.p && q) {
      if (rDrag.moved) {
        for (const l of lineSlots(rDrag.p, q)) battle.order(l.u, { k: "move", x: l.x, z: l.z, face: l.face, files: l.files, run });
      } else {
        const t = unitAt(q, 4);
        if (t && t.side === 1) {
          for (const u of sel) battle.order(u, { k: "attack", unit: t.id, run });
          flashOrder(q, 0xff5040);
        } else {
          // Keep the formation; face the direction of travel.
          let cx = 0;
          let cz = 0;
          for (const u of sel) {
            const [x, z] = battle.pos(u);
            cx += x;
            cz += z;
          }
          cx /= sel.length;
          cz /= sel.length;
          const face = Math.atan2(q.x - cx, q.z - cz);
          for (const u of sel) {
            const [x, z] = battle.pos(u);
            battle.order(u, { k: "move", x: q.x + (x - cx), z: q.z + (z - cz), face: sel.length > 1 ? face : face, run });
          }
          flashOrder(q, 0x9affd0);
        }
      }
    }
    army?.setGhost([], 0xffffff);
    rDrag = null;
  } else if (e.button === 1) mDrag = null;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.dist = Math.max(18, Math.min(1400, cam.dist * Math.exp(e.deltaY * 0.0011)));
}, { passive: false });
const mouse = { x: -1, y: -1 };

/** Lay the selected units side by side along a dragged line, facing away from the drag's left. */
function lineSlots(a: THREE.Vector3, b: THREE.Vector3): { u: Unit; x: number; z: number; face: number; files: number; slots: [number, number][] }[] {
  const sel = selected();
  if (!sel.length || !battle) return [];
  const len = Math.max(8, Math.hypot(b.x - a.x, b.z - a.z));
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  // Facing: the line's normal on the side away from the units.
  let face = Math.atan2(-dz, dx);
  let cx = 0;
  let cz = 0;
  for (const u of sel) {
    const [x, z] = battle.pos(u);
    cx += x;
    cz += z;
  }
  cx /= sel.length;
  cz /= sel.length;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  if (Math.sin(face) * (mx - cx) + Math.cos(face) * (mz - cz) < 0) face += Math.PI;
  // Split the width by each unit's natural width.
  const widths = sel.map((u) => battle!.spacing(u.type)[0] * u.files);
  const total = widths.reduce((s, w) => s + w, 0);
  let at = 0;
  return sel.map((u, k) => {
    const w = (widths[k] / total) * len;
    const c = at + w / 2;
    at += w;
    const x = a.x + dx * c;
    const z = a.z + dz * c;
    const files = Math.max(3, Math.round(w / battle!.spacing(u.type)[0]));
    const men = battle!.livingMen(u);
    const slots: [number, number][] = [];
    for (let s = 0; s < men; s++) slots.push(battle!.slotPos(u, s, x, z, face, files));
    return { u, x, z, face, files, slots };
  });
}

/** A brief marker where an order was given. */
function flashOrder(p: THREE.Vector3, col: number): void {
  if (!battle || !army) return;
  const ring: [number, number][] = [];
  for (let k = 0; k < 24; k++) ring.push([p.x + Math.cos((k / 24) * 6.283) * 4, p.z + Math.sin((k / 24) * 6.283) * 4]);
  army.setGhost(ring, col);
  setTimeout(() => army?.setGhost([], col), 450);
}

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (!battle || !started) return;
  if (e.code === "Space") {
    e.preventDefault();
    setSpeed(speed ? 0 : 1);
  }
  if (e.code === "KeyR") $("oRun").click();
  if (e.code === "KeyF") $("oFire").click();
  if (e.code === "Backspace") halt();
  if (e.code === "KeyA" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    for (const u of mine()) if (u.state !== "gone") u.selected = true;
    refreshOrders();
  }
  if (/^Digit[1-9]$/.test(e.code)) {
    const u = mine()[+e.code.slice(5) - 1];
    if (u) {
      if (!e.shiftKey) for (const m of mine()) m.selected = false;
      u.selected = true;
      refreshOrders();
    }
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

// ------------------------------------------------------------------ the loop

let last = performance.now();
let simAcc = 0;
let lastDeaths = 0;
let volleysSeen = 0;
let routsSeen = 0;
let ralliesSeen = 0;
let t = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  if (stage && field && battle && army && U) {
    // Camera.
    const pan = cam.dist * 0.9 * dt;
    let f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    let r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") && !keys.has("ControlLeft") || keys.has("ArrowLeft") ? 1 : 0);
    if (started && mouse.x >= 0) {
      if (mouse.x < 6) r = -1;
      if (mouse.x > window.innerWidth - 6) r = 1;
      if (mouse.y < 6) f = 1;
      if (mouse.y > window.innerHeight - 6) f = -1;
    }
    cam.x += (-Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * r) * pan;
    cam.z += (-Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * r) * pan;
    if (keys.has("KeyQ")) cam.yaw += dt * 1.3;
    if (keys.has("KeyE")) cam.yaw -= dt * 1.3;
    if (!started) cam.yaw += dt * 0.03;
    const lim = field.spec.size / 2 - 40;
    cam.x = Math.max(-lim, Math.min(lim, cam.x));
    cam.z = Math.max(-lim, Math.min(lim, cam.z));
    const gy = field.height(cam.x, cam.z);
    const c = Math.cos(cam.pitch);
    const camPos = new THREE.Vector3(cam.x + Math.sin(cam.yaw) * c * cam.dist, gy + Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * c * cam.dist);
    camPos.y = Math.max(camPos.y, field.height(camPos.x, camPos.z) + 3);
    stage.camera.position.copy(camPos);
    stage.camera.lookAt(cam.x, gy + 2, cam.z);
    stage.fitShadows(new THREE.Vector3(cam.x, gy, cam.z), cam.dist * 1.1);
    U.uTime.value = t;
    U.uCam.value.copy(camPos);
    // Simulation.
    if (started && !over && speed > 0) {
      simAcc += dt * speed;
      let steps = 0;
      while (simAcc >= 1 / 30 && steps < 8) {
        battle.step(1 / 30);
        ai!.update(1 / 30);
        simAcc -= 1 / 30;
        steps++;
      }
    }
    army.update(camPos);
    dust?.update(dt * Math.max(0.3, started ? speed : 0.3), camPos);
    standards?.update(t);
    // Sound: how much fighting is near the camera.
    const ev = battle.ev;
    let melee = 0;
    let horse = 0;
    battle.near(cam.x, cam.z, Math.max(80, cam.dist * 0.8), (j) => {
      if (battle!.target[j] >= 0) melee++;
      const u = battle!.units[battle!.unit[j]];
      if (u.type.mounted && Math.hypot(battle!.vx[j], battle!.vz[j]) > 4) horse++;
    });
    const k = Math.max(0.2, Math.min(1, 200 / cam.dist));
    audio.update(dt, melee * k, horse * k, Math.min(1, melee / 120));
    if (ev.volleys > volleysSeen) {
      volleysSeen = ev.volleys;
      audio.volley(k);
    }
    while (routsSeen < ev.routs.length) {
      const n = ev.routs[routsSeen++];
      const u = battle.units.find((x) => x.name === n);
      log(`${n}이(가) 무너져 달아난다!`, u?.side === 0 ? "bad" : "gold");
      if (u?.side === 1) audio.horn();
    }
    while (ralliesSeen < ev.rallies.length) log(`${ev.rallies[ralliesSeen++]}이(가) 다시 대오를 갖춘다`, "");
    if (ev.deaths - lastDeaths > 0) lastDeaths = ev.deaths;
    // HUD.
    if (started) {
      updateCards();
      const a = battle.strength(0);
      const b = battle.strength(1);
      ($("balA") as HTMLElement).style.width = `${(a / (a + b || 1)) * 100}%`;
      ($("balB") as HTMLElement).style.width = `${(b / (a + b || 1)) * 100}%`;
      const s = Math.floor(battle.time);
      $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (battle.result >= 0 && !over) {
        over = true;
        setTimeout(finish, 2500);
      }
    }
    stage.render();
  }
}

function finish(): void {
  const b = battle!;
  const win = b.result === 0;
  $("hud").classList.add("off");
  $("end").classList.remove("off");
  $("etitle").textContent = win ? "대승 (大勝)" : "패배";
  const side = (s: 0 | 1) => {
    let start = 0;
    let alive = 0;
    for (const u of b.units)
      if (u.side === s) {
        start += u.start;
        alive += b.livingMen(u);
      }
    return [start, alive];
  };
  const [a0, a1] = side(0);
  const [e0, e1] = side(1);
  const best = mine().sort((x, y) => y.kills - x.kills)[0];
  $("estats").innerHTML = `
    <table><tr><th></th><th>출전</th><th>생존</th><th>전사</th></tr>
    <tr><td>고구려</td><td>${a0}</td><td>${a1}</td><td>${a0 - a1}</td></tr>
    <tr><td>${scen?.id === "yodong" ? "당" : "수"}</td><td>${e0}</td><td>${e1}</td><td>${e0 - e1}</td></tr></table>
    ${b.ev.escaped ? `<p>강을 건너 달아난 적: <b>${b.ev.escaped}명</b> (${b.ev.escapedUnits.join(", ")})</p>` : ""}
    <p>전투 시간 ${Math.floor(b.time / 60)}분 ${Math.floor(b.time % 60)}초 · 가장 많이 벤 부대: <b>${best?.name ?? "-"}</b> (${best?.kills ?? 0})</p>
    <p class="fine">${win ? "적이 흩어져 달아난다. 고구려의 이름이 요동에 울려 퍼진다." : "후퇴의 북이 울린다. 다음 싸움을 기약한다."}</p>`;
}

declare global {
  interface Window {
    __g: Record<string, unknown>;
  }
}
window.__g = {
  get battle() {
    return battle;
  },
  get stage() {
    return stage;
  },
  cam,
  brief: (i: number) => brief(SCENARIOS[i]),
  go: () => $("go").click(),
  /** Tests: let an AI command our side too. */
  autoplay: () => {
    const a0 = new Ai(battle!, 0);
    const tick = () => {
      if (!battle || battle.result >= 0) return;
      a0.update(0.1 * Math.max(1, speed));
      setTimeout(tick, 100);
    };
    tick();
  },
  setSpeed,
};

// A quiet field behind the title.
load(SCENARIOS[0]);
cam.dist = 520;
cam.pitch = 0.32;
requestAnimationFrame(frame);
