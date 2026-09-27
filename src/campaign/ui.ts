/**
 * Playing 천하: the map camera (pan with WASD, the screen edge or a drag; wheel to zoom; Q/E
 * to turn), picking hexes, selecting a city or an army, marching (the reachable hexes light
 * green, the enemies in reach red), the panels for a city (buildings, raising regiments, the
 * garrison and mustering it) and an army (its regiments, splitting, leaving a garrison), the
 * chronicle, diplomacy, learning, the events of history, and the call before every battle:
 * lead it yourself on the field, or let the generals decide.
 */
import * as THREE from "three";
import type { Stage } from "../engine/scene";
import { TYPES } from "../sim/units";
import { BUILDINGS, FACTION_IDS, FACTIONS, TECHS, unitTypeFor, type FactionId } from "./data";
import { COLS, hexAt, hexDist, MAP_H, MAP_W, neighbours, type Hex } from "./geo";
import { josa, type Army, type BattleOutcome, type BattleSetup, type City, Game, type GameEvent } from "./state";
import { MapView } from "./view";

const SAVE = "goguryeo-campaign-v1";
const TERR: Record<string, string> = { plains: "평야", steppe: "초원", hills: "구릉", mountains: "산악", forest: "숲", marsh: "늪(요택)", sea: "바다" };
/** Relations as seen from our side: "overlord" means we are theirs. */
const REL: Record<string, string> = { war: "전쟁", peace: "화친", ally: "동맹", vassal: "상국(上國)", overlord: "신하국" };
const ICON: Record<string, string> = { hcav: "騎", cav: "騎", hbow: "射", spear: "槍", sword: "刀", axe: "斧", bow: "弓", general: "將", ram: "車" };

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE);
  } catch {
    return false;
  }
}

export class Campaign {
  readonly view: MapView;
  active = false;
  private cam = { x: 0, z: 0, dist: 820, pitch: 0.95, yaw: 0 };
  private sel: { kind: "army" | "city"; id: number } | null = null;
  private reach: Map<number, { cost: number; from: number }> | null = null;
  private picked = new Set<number>();
  private busy = false;
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1 };
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private visible = new Set<number>();
  private readonly ui: HTMLElement;
  private readonly ray = new THREE.Raycaster();

  constructor(
    readonly stage: Stage,
    readonly game: Game,
    readonly hooks: { fight: (s: BattleSetup) => Promise<BattleOutcome>; toTitle: () => void },
  ) {
    this.view = new MapView(game);
    stage.scene.add(this.view.group);
    this.view.group.visible = false;
    game.onBattle = (s) => this.battle(s);
    game.onEvent = (e) => this.event(e);
    this.ui = document.createElement("div");
    this.ui.id = "camp";
    this.ui.className = "off";
    this.ui.innerHTML = `
      <div id="ctop">
        <div class="yr"><b id="cyear"></b><small id="creign"></small></div>
        <div class="res"><span title="재화">財 <b id="cgold"></b><small id="cgin"></small></span><span title="문물">文 <b id="clore"></b><small id="clin"></small></span><span id="cres"></span></div>
        <div class="btns"><button id="cdip">외교</button><button id="ctech">문물</button><button id="cnext" title="Tab">다음 군대</button><button id="cend" class="main">한 해를 보낸다 <kbd>Enter</kbd></button><button id="cquit" class="ghost">✕</button></div>
      </div>
      <div id="cpanel" class="off"></div>
      <div id="clog"></div>
      <div id="ctip" class="off"></div>
      <div id="cmodal" class="off"><div class="box" id="cbox"></div></div>
      <div id="cbusy" class="off">다른 나라들이 움직인다…</div>`;
    document.getElementById("ui")!.appendChild(this.ui);
    const $ = (id: string) => document.getElementById(id)!;
    $("cend").onclick = () => this.endTurn();
    $("cdip").onclick = () => this.diplomacy();
    $("ctech").onclick = () => this.techs();
    $("cnext").onclick = () => this.nextArmy();
    $("cquit").onclick = () => this.confirm("천하를 떠나 처음 화면으로 돌아갈까요? (진행은 저장되어 있습니다)", () => hooks.toTitle());
    const cv = stage.renderer.domElement;
    cv.addEventListener("pointerdown", (e) => this.onDown(e));
    cv.addEventListener("pointermove", (e) => this.onMove(e));
    cv.addEventListener("pointerup", (e) => this.onUp(e));
    cv.addEventListener("wheel", (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.cam.dist = Math.max(160, Math.min(1700, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === "Enter" && !this.modalOpen()) this.endTurn();
      if (e.code === "Escape") this.select(null);
      if (e.code === "Tab") {
        e.preventDefault();
        this.nextArmy();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    // Start over the capital.
    const cap = game.cities.find((c) => c.owner === game.player && c.capital) ?? game.cities.find((c) => c.owner === game.player);
    if (cap) {
      const h = game.hexes[cap.hex];
      this.cam.x = h.x - 60;
      this.cam.z = h.z - 120;
    }
  }

  private started = false;
  enter(): void {
    this.active = true;
    if (!this.started) {
      this.started = true;
      // The events of the opening year.
      setTimeout(async () => {
        this.busy = true;
        await this.game.history();
        this.busy = false;
        this.view.sync();
        this.refresh();
      }, 600);
    }
    this.view.group.visible = true;
    this.stage.setLook({ sunElev: 42, sunAz: 30, turbidity: 3, rayleigh: 1.1, fog: 0.00012, exposure: 1.05 });
    this.stage.scene.environmentIntensity = 0.55;
    this.ui.classList.remove("off");
    this.view.sync();
    this.refresh();
  }

  leave(): void {
    this.active = false;
    this.view.group.visible = false;
    this.ui.classList.add("off");
  }

  private modalOpen(): boolean {
    return !document.getElementById("cmodal")!.classList.contains("off");
  }

  save(): void {
    try {
      localStorage.setItem(SAVE, this.game.save());
    } catch {
      /* private mode: no save */
    }
  }
  static load(): Game | null {
    try {
      const s = localStorage.getItem(SAVE);
      return s ? Game.load(s) : null;
    } catch {
      return null;
    }
  }
  static clear(): void {
    try {
      localStorage.removeItem(SAVE);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number, t: number): void {
    const c = this.cam;
    const pan = c.dist * 0.9 * dt;
    let f = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    let r = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    if (this.mouse.x >= 0 && !this.drag) {
      if (this.mouse.x < 5) r = -1;
      if (this.mouse.x > window.innerWidth - 5) r = 1;
      if (this.mouse.y < 5) f = 1;
      if (this.mouse.y > window.innerHeight - 5) f = -1;
    }
    c.x += (-Math.sin(c.yaw) * f + Math.cos(c.yaw) * r) * pan;
    c.z += (-Math.cos(c.yaw) * f - Math.sin(c.yaw) * r) * pan;
    if (this.keys.has("KeyQ")) c.yaw += dt * 1.2;
    if (this.keys.has("KeyE")) c.yaw -= dt * 1.2;
    c.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, c.x));
    c.z = Math.max(-MAP_H / 2, Math.min(MAP_H / 2, c.z));
    // Look down more steeply from high up.
    const pitch = c.pitch - (1 - Math.min(1, c.dist / 900)) * 0.3;
    const cp = Math.cos(pitch);
    const pos = new THREE.Vector3(c.x + Math.sin(c.yaw) * cp * c.dist, Math.sin(pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.stage.camera.position.copy(pos);
    this.stage.camera.lookAt(c.x, 0, c.z);
    this.stage.fitShadows(new THREE.Vector3(c.x, 0, c.z), c.dist * 0.9);
    this.view.update(dt, t, this.stage.camera, this.visible);
  }

  // ------------------------------------------------------------------ picking

  private hexAtScreen(x: number, y: number): Hex | null {
    this.ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), this.stage.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    // March to the relief.
    let prev = 0;
    for (let t = 1; t < 6000; t += Math.max(1, t * 0.01)) {
      const px = o.x + d.x * t;
      const pz = o.z + d.z * t;
      if (o.y + d.y * t < Math.max(0, this.view.heightAt(px, pz))) {
        let a = prev;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m < Math.max(0, this.view.heightAt(o.x + d.x * m, o.z + d.z * m))) b = m;
          else a = m;
        }
        const [c, r] = hexAt(o.x + d.x * b, o.z + d.z * b);
        if (c < 0 || r < 0 || c >= COLS) return null;
        return this.game.hexes[r * COLS + c] ?? null;
      }
      prev = t;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (!this.active || this.busy) return;
    this.drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cz: this.cam.z, moved: false };
  }
  private onMove(e: PointerEvent): void {
    if (!this.active) return;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 6) this.drag.moved = true;
      if (this.drag.moved) {
        const k = this.cam.dist / window.innerHeight * 1.2;
        const c = Math.cos(this.cam.yaw);
        const s = Math.sin(this.cam.yaw);
        this.cam.x = this.drag.cx - (dx * c + dy * s) * k;
        this.cam.z = this.drag.cz - (-dx * s + dy * c) * k;
      }
    }
    const h = this.hexAtScreen(e.clientX, e.clientY);
    this.view.setHover(h ? h.i : null);
    this.tip(h, e.clientX, e.clientY);
  }
  private onUp(e: PointerEvent): void {
    if (!this.active) return;
    const d = this.drag;
    this.drag = null;
    if (this.busy || (d && d.moved) || this.modalOpen()) return;
    const h = this.hexAtScreen(e.clientX, e.clientY);
    if (!h) return;
    const g = this.game;
    const army = this.sel?.kind === "army" ? g.armies.find((a) => a.id === this.sel!.id) : undefined;
    // Right click (or a click on a lit hex) with an army selected: march.
    if (army && army.owner === g.player && (e.button === 2 || (this.reach?.has(h.i) && h.i !== army.hex))) {
      this.order(army, h);
      return;
    }
    if (e.button !== 0) return;
    const here = g.armiesAt(h.i);
    const mineHere = here.find((a) => a.owner === g.player);
    const city = g.cityAt(h.i);
    if (mineHere && !(this.sel?.kind === "army" && this.sel.id === mineHere.id)) this.select({ kind: "army", id: mineHere.id });
    else if (city) this.select({ kind: "city", id: city.id });
    else if (here[0] && this.visible.has(h.i)) this.select({ kind: "army", id: here[0].id });
    else this.select(null);
  }

  private tip(h: Hex | null, x: number, y: number): void {
    const el = document.getElementById("ctip")!;
    if (!h || h.terrain === "sea" || this.drag?.moved) {
      el.classList.add("off");
      return;
    }
    const g = this.game;
    const own = g.owner[h.i];
    const city = g.cityAt(h.i);
    const armies = g.armiesAt(h.i).filter((a) => a.owner === g.player || this.visible.has(h.i));
    let s = `<b>${city ? city.name : TERR[h.terrain]}</b>${h.river ? " · 강" : ""}${own ? ` · ${g.name(own)}` : ""}`;
    if (city) s += `<br><small>${TERR[h.terrain]} · ${city.pop}만 호 · 성벽 ${city.walls}${city.mountain ? " (산성)" : ""}</small>`;
    for (const a of armies) s += `<br><small>${g.name(a.owner)} ${a.general}: ${a.units.reduce((t, u) => t + u.men, 0)}명</small>`;
    const r = this.reach?.get(h.i);
    if (r && this.sel?.kind === "army") s += `<br><small class="g">이동 ${r.cost}</small>`;
    el.innerHTML = s;
    el.style.left = `${x + 16}px`;
    el.style.top = `${y + 14}px`;
    el.classList.remove("off");
  }

  // ------------------------------------------------------------------ orders

  private async order(a: Army, h: Hex): Promise<void> {
    const g = this.game;
    if (!this.reach?.has(h.i) || a.moves <= 0) return;
    const city = g.cityAt(h.i);
    const foeArmy = g.armiesAt(h.i).some((o) => g.hostile(a.owner, o.owner));
    if (city && g.hostile(a.owner, city.owner) && city.walls > 0 && !foeArmy) {
      // Walled city: get next to it first, then choose assault or siege.
      const adjacent = hexDist(g.hexes[a.hex], h) === 1;
      if (!adjacent) {
        const from = this.reach.get(h.i)!.from;
        this.busy = true;
        await g.move(a, from);
        this.busy = false;
        this.afterAction();
        if (!g.armies.includes(a) || hexDist(g.hexes[a.hex], h) !== 1) return;
      }
      this.siegeChoice(a, city);
      return;
    }
    this.busy = true;
    await g.move(a, h.i);
    this.busy = false;
    this.afterAction();
  }

  private siegeChoice(a: Army, c: City): void {
    const g = this.game;
    const setup: BattleSetup = {
      attacker: { faction: a.owner, army: a, city: null, units: a.units },
      defender: { faction: c.owner, army: null, city: c, units: c.garrison },
      hex: g.hexes[c.hex],
      siege: true,
      rams: a.siege === c.id && a.siegeTurns >= 1 ? 2 : 0,
      mound: a.siege === c.id && a.siegeTurns >= 2,
    };
    const o = g.odds(setup);
    const works = a.siege === c.id ? `포위 ${a.siegeTurns}년째 · 충차 ${setup.rams ? "준비됨" : "없음"} · 토산 ${setup.mound ? "완성" : "없음"}` : "포위하면 이듬해 충차가, 두 해면 토산이 준비됩니다. 포위된 성은 양식이 떨어져 갑니다.";
    this.modal(`<h3>${c.name} 앞에서</h3><p>${c.name}: 성벽 ${c.walls}${c.mountain ? " · 산성" : ""} · 수비 ${c.garrison.length}부대 · ${c.pop}만 호</p><p class="fine">${works}</p><p>지금 공격하면 승산 약 <b>${Math.round(o.p * 100)}%</b></p>`, [
      { label: "성을 친다", main: true, fn: async () => {
        this.busy = true;
        a.moves = 0;
        await g.attack(a, c.hex);
        this.busy = false;
        this.afterAction();
      } },
      { label: a.siege === c.id ? "포위를 계속한다" : "포위한다", fn: () => {
        g.besiege(a, c.id);
        this.afterAction();
      } },
      { label: "물러선다", fn: () => {} },
    ]);
  }

  private afterAction(): void {
    this.view.sync();
    this.select(this.sel && (this.sel.kind === "city" || this.game.armies.some((x) => x.id === this.sel!.id)) ? this.sel : null);
    this.refresh();
    this.checkOver();
  }

  private nextArmy(): void {
    const g = this.game;
    const mine = g.armies.filter((a) => a.owner === g.player);
    if (!mine.length) return;
    const i = this.sel?.kind === "army" ? mine.findIndex((a) => a.id === this.sel!.id) : -1;
    const order = [...mine.slice(i + 1), ...mine.slice(0, i + 1)];
    const a = order.find((x) => x.moves > 0) ?? order[0];
    this.select({ kind: "army", id: a.id });
    const h = g.hexes[a.hex];
    this.cam.x = h.x;
    this.cam.z = h.z + 60;
  }

  select(s: { kind: "army" | "city"; id: number } | null): void {
    this.sel = s;
    this.picked.clear();
    const g = this.game;
    this.reach = null;
    const hl = new Map<number, number>();
    if (s?.kind === "army") {
      const a = g.armies.find((x) => x.id === s.id);
      if (a) {
        this.view.setSelected(a.hex);
        if (a.owner === g.player && a.moves > 0) {
          this.reach = g.reach(a);
          for (const [i] of this.reach) {
            if (i === a.hex) continue;
            const hostile = g.armiesAt(i).some((o) => g.hostile(a.owner, o.owner)) || (g.cityAt(i) && g.hostile(a.owner, g.cityAt(i)!.owner));
            hl.set(i, hostile ? 2 : 1);
          }
          // Walled hostile cities next door can be besieged/assaulted even when not reachable as a move.
          const h = g.hexes[a.hex];
          for (const [c, r] of neighbours(h.col, h.row)) {
            const city = g.cityAt(r * COLS + c);
            if (city && g.hostile(a.owner, city.owner)) {
              hl.set(city.hex, 2);
              this.reach.set(city.hex, { cost: 1, from: a.hex });
            }
          }
        }
      }
    } else if (s?.kind === "city") {
      this.view.setSelected(g.cities[s.id].hex);
    } else this.view.setSelected(null);
    this.computeVisible();
    this.view.refreshOwners(hl, this.visible);
    this.panel();
  }

  private computeVisible(): void {
    const g = this.game;
    const R = g.powers[g.player].techs.includes("bongsu") ? 5 : 3;
    const src = [...g.cities.filter((c) => c.owner === g.player).map((c) => g.hexes[c.hex]), ...g.armies.filter((a) => a.owner === g.player).map((a) => g.hexes[a.hex])];
    // Allies share what they see.
    for (const c of g.cities) if (c.owner !== g.player && g.friendly(g.player, c.owner)) src.push(g.hexes[c.hex]);
    this.visible = new Set();
    for (const h of g.hexes) if (src.some((s) => hexDist(s, h) <= R)) this.visible.add(h.i);
  }

  // ------------------------------------------------------------------ panels

  refresh(): void {
    const g = this.game;
    const p = g.powers[g.player];
    const inc = g.income(g.player);
    const $ = (id: string) => document.getElementById(id)!;
    $("cyear").textContent = `${g.year}년`;
    $("creign").textContent = g.year < 618 ? " 영양왕" : g.year < 642 ? " 영류왕" : " 보장왕";
    $("cgold").textContent = String(Math.round(p.gold));
    const net = inc.gold - inc.upkeep;
    $("cgin").textContent = ` (${net >= 0 ? "+" : ""}${net})`;
    ($("cgin") as HTMLElement).className = net >= 0 ? "" : "neg";
    $("clore").textContent = String(Math.round(p.lore));
    $("clin").textContent = ` (+${inc.lore})`;
    const t = p.researching ? TECHS.find((x) => x.id === p.researching) : null;
    $("cres").innerHTML = t ? `연구: ${t.name} <small>${Math.round(p.lore)}/${t.cost}</small>` : `<span class="warn">연구할 문물을 고르십시오</span>`;
    $("clog").innerHTML = g.log.slice(0, 14).map((l) => `<div class="${l.kind}"><small>${l.year}</small> ${l.text}</div>`).join("");
    this.computeVisible();
    this.panel();
  }

  private panel(): void {
    const el = document.getElementById("cpanel")!;
    const g = this.game;
    const s = this.sel;
    if (!s) {
      el.classList.add("off");
      return;
    }
    el.classList.remove("off");
    if (s.kind === "city") return this.cityPanel(el, g.cities[s.id]);
    const a = g.armies.find((x) => x.id === s.id);
    if (!a) {
      el.classList.add("off");
      return;
    }
    this.armyPanel(el, a);
  }

  private unitRow(u: { id: number; type: string; name: string; men: number; max: number; xp: number }, f: FactionId, pick: boolean): string {
    const t = TYPES[u.type];
    const k = u.men / u.max;
    return `<div class="urow ${this.picked.has(u.id) ? "on" : ""}" ${pick ? `data-u="${u.id}"` : ""}><i>${ICON[t.role]}</i><span>${u.name}<small>${unitTypeFor(f, u.type, this.game.tang).name}${u.xp ? ` · ${"★".repeat(Math.min(3, Math.ceil(u.xp / 3)))}` : ""}</small></span><b>${u.men}</b><em><u style="width:${k * 100}%;background:${k > 0.6 ? "#6fd06a" : k > 0.3 ? "#e8c040" : "#e04a3a"}"></u></em></div>`;
  }

  private cityPanel(el: HTMLElement, c: City): void {
    const g = this.game;
    const mine = c.owner === g.player;
    const h = g.hexes[c.hex];
    const p = g.powers[c.owner];
    const need = 4 + c.pop * 1.6;
    let s = `<h3>${c.name}${c.capital ? " <small>도읍</small>" : ""}</h3>
      <div class="sub" style="color:#${FACTIONS[c.owner].color.toString(16).padStart(6, "0")}">${g.name(c.owner)} · ${TERR[h.terrain]}${h.river ? " · 강가" : ""}${c.mountain ? " · 산성" : ""}</div>
      <div class="stats"><span>인구 <b>${c.pop}</b>만 호</span><span>성벽 <b>${c.walls}</b></span>${mine ? `<span>곡식 ${c.food.toFixed(1)}/${need.toFixed(0)}</span>` : ""}${c.besieged ? `<span class="warn">포위 ${c.besieged}년</span>` : ""}</div>`;
    if (mine) {
      s += `<div class="sec">건물</div><div class="chips">${c.buildings.map((b) => `<span class="chip">${BUILDINGS.find((x) => x.id === b)?.name}</span>`).join("")}</div>`;
      if (c.build) {
        const b = BUILDINGS.find((x) => x.id === c.build!.id)!;
        s += `<p class="fine">짓는 중: <b>${b.name}</b> (${c.build.left}년 남음)</p>`;
      } else {
        s += `<div class="grid">${BUILDINGS.filter((b) => (b.id === "walls" ? c.walls < (p.techs.includes("sanseong") ? 4 : 3) : !c.buildings.includes(b.id)))
          .map((b) => `<button class="opt" data-b="${b.id}" ${p.gold < b.cost ? "disabled" : ""} title="${b.desc}"><b>${b.name}</b><small>${b.cost}財 · ${b.turns}년</small><small>${b.desc}</small></button>`)
          .join("")}</div>`;
      }
      s += `<div class="sec">징집</div>`;
      if (c.recruit) s += `<p class="fine">징집 중: <b>${unitTypeFor(c.owner, c.recruit.type, g.tang).name}</b> (내년)</p>`;
      else
        s += `<div class="grid">${FACTIONS[c.owner].roster
          .map((t) => {
            const ok = g.canRecruit(c, t);
            const ty = unitTypeFor(c.owner, t, g.tang);
            return `<button class="opt" data-r="${t}" ${ok.ok ? "" : "disabled"} title="${ty.desc}"><b>${ICON[ty.role]} ${ty.name}</b><small>${g.recruitCost(c, t)}財 · ${ty.men}명 · 유지 ${g.upkeep(t)}</small>${ok.ok ? "" : `<small class="warn">${ok.why}</small>`}</button>`;
          })
          .join("")}</div>`;
      s += `<div class="sec">수비대 (${c.garrison.length})</div>${c.garrison.map((u) => this.unitRow(u, c.owner, true)).join("") || `<p class="fine">없음</p>`}`;
      if (c.garrison.length) s += `<div class="row"><button id="pMuster" class="main">${this.picked.size ? "고른 부대 출진" : "모두 출진"}</button></div>`;
    } else {
      const rel = g.rel(g.player, c.owner);
      s += `<p class="fine">${REL[rel]} · 수비 ${this.visible.has(c.hex) ? `${c.garrison.length}부대` : "알 수 없음"}</p>`;
    }
    el.innerHTML = s;
    el.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => {
      g.startBuild(c, b.dataset.b!);
      this.refresh();
    }));
    el.querySelectorAll<HTMLButtonElement>("[data-r]").forEach((b) => (b.onclick = () => {
      g.startRecruit(c, b.dataset.r!);
      this.refresh();
    }));
    this.bindPicks(el);
    const m = el.querySelector<HTMLButtonElement>("#pMuster");
    if (m) m.onclick = () => {
      const ids = this.picked.size ? [...this.picked] : c.garrison.map((u) => u.id);
      const a = g.muster(c, ids);
      if (a) {
        a.moves = g.maxMoves(a);
        this.view.sync();
        this.select({ kind: "army", id: a.id });
        this.refresh();
      }
    };
  }

  private armyPanel(el: HTMLElement, a: Army): void {
    const g = this.game;
    const mine = a.owner === g.player;
    const men = a.units.reduce((s, u) => s + u.men, 0);
    const city = g.cityAt(a.hex);
    let s = `<h3>${a.general}</h3><div class="sub" style="color:#${FACTIONS[a.owner].color.toString(16).padStart(6, "0")}">${g.name(a.owner)} · ${men.toLocaleString()}명 · ${a.units.length}부대${a.expedition ? " · 원정군" : ""}</div>`;
    if (mine) {
      s += `<div class="stats"><span>이동 <b>${a.moves}</b>/${g.maxMoves(a)}</span>${a.siege >= 0 ? `<span class="warn">${g.cities[a.siege].name} 포위 ${a.siegeTurns}년</span>` : ""}<span>힘 ${Math.round(g.armyPower(a) / 100)}</span></div>`;
      s += `<p class="fine">녹색 칸을 눌러 행군 · 붉은 칸은 적 · 성 옆에서 성을 누르면 공성</p>`;
    }
    s += `<div class="sec">부대</div>${a.units.map((u) => this.unitRow(u, a.owner, mine)).join("")}`;
    if (mine) {
      s += `<div class="row">`;
      if (this.picked.size && this.picked.size < a.units.length) s += `<button id="pSplit">고른 부대 분리</button>`;
      if (city && city.owner === g.player) s += `<button id="pGarr">${this.picked.size ? "고른 부대 주둔" : "모두 주둔"}</button>`;
      if (a.siege >= 0) s += `<button id="pAssault" class="main">${g.cities[a.siege].name} 공격</button><button id="pLift">포위 풀기</button>`;
      s += `</div>`;
    } else if (!this.visible.has(a.hex)) s = `<h3>알 수 없는 군대</h3>`;
    el.innerHTML = s;
    this.bindPicks(el);
    const on = (id: string, fn: () => void) => {
      const b = el.querySelector<HTMLButtonElement>(`#${id}`);
      if (b) b.onclick = fn;
    };
    on("pSplit", () => {
      const b = g.split(a, [...this.picked]);
      this.view.sync();
      if (b) this.select({ kind: "army", id: b.id });
    });
    on("pGarr", () => {
      g.garrison(a, this.picked.size ? [...this.picked] : a.units.map((u) => u.id));
      this.view.sync();
      this.select(g.armies.includes(a) ? { kind: "army", id: a.id } : city ? { kind: "city", id: city.id } : null);
      this.refresh();
    });
    on("pAssault", () => this.siegeChoice(a, g.cities[a.siege]));
    on("pLift", () => {
      a.siege = -1;
      a.siegeTurns = 0;
      this.afterAction();
    });
  }

  private bindPicks(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>(".urow[data-u]").forEach((r) => (r.onclick = () => {
      const id = +r.dataset.u!;
      if (this.picked.has(id)) this.picked.delete(id);
      else this.picked.add(id);
      this.panel();
    }));
  }

  // ------------------------------------------------------------------ modals

  private modal(html: string, buttons: { label: string; main?: boolean; hint?: string; fn: () => void | Promise<void> }[], wide = false): Promise<void> {
    return new Promise((res) => {
      const m = document.getElementById("cmodal")!;
      const box = document.getElementById("cbox")!;
      box.className = `box${wide ? " wide" : ""}`;
      box.innerHTML = `${html}<div class="mbtns">${buttons.map((b, i) => `<button data-i="${i}" class="${b.main ? "main" : ""}">${b.label}${b.hint ? `<small>${b.hint}</small>` : ""}</button>`).join("")}</div>`;
      m.classList.remove("off");
      box.querySelectorAll<HTMLButtonElement>(".mbtns button").forEach((el) => (el.onclick = async () => {
        m.classList.add("off");
        await buttons[+el.dataset.i!].fn();
        res();
      }));
    });
  }

  private confirm(text: string, yes: () => void): void {
    this.modal(`<p>${text}</p>`, [{ label: "예", main: true, fn: yes }, { label: "아니오", fn: () => {} }]);
  }

  private async event(e: GameEvent): Promise<void> {
    const html = `<div class="evt"><div class="seal">史</div><h3>${e.title}</h3>${e.text.map((t) => `<p>${t}</p>`).join("")}</div>`;
    if (e.choices?.length) await this.modal(html, e.choices.map((c, i) => ({ label: c.label, hint: c.hint, main: i === 0, fn: () => c.apply(this.game) })));
    else await this.modal(html, [{ label: "알겠다", main: true, fn: () => {} }]);
    this.view.sync();
    this.refresh();
  }

  private async battle(s: BattleSetup): Promise<BattleOutcome> {
    const g = this.game;
    const involved = s.attacker.faction === g.player || s.defender.faction === g.player;
    if (!involved) return g.autoResolve(s);
    const o = g.odds(s);
    const mineAtt = s.attacker.faction === g.player;
    const pWin = mineAtt ? o.p : 1 - o.p;
    const side = (b: typeof s.attacker, label: string) =>
      `<div class="bside"><div class="t" style="color:#${FACTIONS[b.faction].color.toString(16).padStart(6, "0")}">${g.name(b.faction)} <small>${label}</small></div><div class="g">${b.army?.general ?? (b.city ? `${b.city.name} 수비대` : "")}</div><div>${b.units.length}부대 · ${b.units.reduce((t, u) => t + u.men, 0).toLocaleString()}명</div><div class="icons">${b.units.map((u) => ICON[TYPES[u.type].role]).join("")}</div></div>`;
    const where = s.defender.city ? `${s.defender.city.name}${s.siege ? " 공성전" : ""}` : `${TERR[s.hex.terrain]}${s.hex.river ? " · 강" : ""}`;
    let result: BattleOutcome = { attackerWon: false };
    // Jump the camera there.
    this.cam.x = s.hex.x;
    this.cam.z = s.hex.z + 80;
    await this.modal(
      `<h3>${g.year}년 · ${where}</h3><div class="vs">${side(s.attacker, "공격")}<div class="x">對</div>${side(s.defender, "방어")}</div><p>자동 전투 승산 약 <b>${Math.round(pWin * 100)}%</b>${s.siege ? ` · 충차 ${s.rams} · 토산 ${s.mound ? "있음" : "없음"}` : ""}</p>`,
      [
        { label: "직접 지휘한다", main: true, hint: "실시간 전투", fn: async () => {
          this.leave();
          result = await this.hooks.fight(s);
          this.enter();
        } },
        { label: "장수에게 맡긴다", hint: "자동 전투", fn: () => {
          result = g.autoResolve(s);
        } },
      ],
      true,
    );
    const won = mineAtt === result.attackerWon;
    this.toast(won ? "승전보가 올라왔다!" : "패전의 소식이 들려온다…", won ? "gold" : "bad");
    return result;
  }

  private toast(t: string, kind: string): void {
    const d = document.createElement("div");
    d.className = `ctoast ${kind}`;
    d.textContent = t;
    this.ui.appendChild(d);
    setTimeout(() => d.classList.add("gone"), 2200);
    setTimeout(() => d.remove(), 3000);
  }

  private diplomacy(): void {
    const g = this.game;
    const me = g.player;
    const rows = FACTION_IDS.filter((f) => f !== me && g.powers[f].alive)
      .map((f) => {
        const r = g.rel(me, f);
        const att = Math.round(g.powers[f].attitude[me]);
        const ratio = g.totalPower(f) / Math.max(1, g.totalPower(me));
        const pct = (x: number) => `${Math.round(x * 100)}%`;
        const btn = (id: string, label: string, ok: boolean, sub = "") => `<button data-a="${id}" data-f="${f}" ${ok ? "" : "disabled"}>${label}${sub ? `<small>${sub}</small>` : ""}</button>`;
        return `<div class="drow"><div class="dn" style="color:#${FACTIONS[f].color.toString(16).padStart(6, "0")}"><b>${g.name(f)}</b><small>${FACTIONS[f].hanja === "隋" && g.tang ? "唐" : FACTIONS[f].hanja}</small></div>
          <div class="dr ${r}">${REL[r]}</div><div class="da"><u style="width:${(att + 100) / 2}%"></u><small>호감 ${att}</small></div><div class="dp"><small>국력 ×${ratio.toFixed(2)}</small></div>
          <div class="dbtn">${r === "war" ? btn("peace", "화친 제의", true, pct(g.peaceChance(f))) : ""}${r === "peace" ? btn("ally", "동맹", true, pct(g.allianceChance(f))) + btn("war", "선전포고", true) : ""}${r !== "vassal" && r !== "overlord" ? btn("vassal", "조공 요구", true, pct(g.vassalChance(f))) : ""}${btn("gift", "예물", g.powers[me].gold >= 50, "50財")}</div></div>`;
      })
      .join("");
    this.modal(`<h3>외교</h3><div class="dip">${rows}</div>`, [{ label: "닫기", fn: () => {} }], true).then(() => this.refresh());
    document.querySelectorAll<HTMLButtonElement>("#cbox [data-a]").forEach((b) => (b.onclick = () => {
      const f = b.dataset.f as FactionId;
      const act = b.dataset.a;
      if (act === "peace") g.offerPeace(f);
      if (act === "ally") g.offerAlliance(f);
      if (act === "war") g.declare(me, f);
      if (act === "vassal") g.demandVassal(f);
      if (act === "gift") g.gift(f);
      document.getElementById("cmodal")!.classList.add("off");
      this.view.sync();
      this.refresh();
      this.diplomacy();
    }));
  }

  private techs(): void {
    const g = this.game;
    const p = g.powers[g.player];
    const rows = TECHS.map((t) => {
      const done = p.techs.includes(t.id);
      const ok = !done && (t.needs ?? []).every((n) => p.techs.includes(n));
      const cur = p.researching === t.id;
      return `<button class="tech ${done ? "done" : ok ? "" : "locked"} ${cur ? "cur" : ""}" data-t="${t.id}" ${ok ? "" : "disabled"}><b>${t.name}</b><small>${t.desc}</small><small>${done ? "이룸" : `${t.cost} 文`}${t.needs ? ` · 선행: ${t.needs.map((n) => TECHS.find((x) => x.id === n)!.name).join(", ")}` : ""}</small></button>`;
    }).join("");
    this.modal(`<h3>문물 <small>文 ${Math.round(p.lore)}</small></h3><div class="techs">${rows}</div>`, [{ label: "닫기", fn: () => {} }], true).then(() => this.refresh());
    document.querySelectorAll<HTMLButtonElement>("#cbox [data-t]").forEach((b) => (b.onclick = () => {
      p.researching = b.dataset.t!;
      document.getElementById("cmodal")!.classList.add("off");
      this.refresh();
    }));
  }

  async endTurn(): Promise<void> {
    if (this.busy || this.game.over) return;
    this.busy = true;
    this.select(null);
    document.getElementById("cbusy")!.classList.remove("off");
    await this.game.endTurn();
    document.getElementById("cbusy")!.classList.add("off");
    this.busy = false;
    this.view.sync();
    this.refresh();
    this.save();
    this.checkOver();
    const g = this.game;
    if (!g.over && !g.powers[g.player].researching && TECHS.some((t) => !g.powers[g.player].techs.includes(t.id))) this.toast("연구할 문물을 고르십시오 (文)", "");
  }

  private checkOver(): void {
    const o = this.game.over;
    if (!o) return;
    Campaign.clear();
    this.modal(`<div class="evt"><div class="seal">${o.win ? "勝" : "終"}</div><h3>${o.title}</h3><p>${o.text}</p></div>`, [{ label: "처음 화면으로", main: true, fn: () => this.hooks.toTitle() }]);
  }
}

export { josa };
