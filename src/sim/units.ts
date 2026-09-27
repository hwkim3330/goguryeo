/** Unit types: who they are, how they fight, what they carry. Numbers are per soldier. */
import type { Kit } from "../units/soldierMesh";

export type Role = "spear" | "sword" | "axe" | "bow" | "cav" | "hcav" | "hbow" | "general";

export interface UnitType {
  id: string;
  name: string;
  role: Role;
  kit: Kit;
  elite: boolean;
  men: number;
  files: number;
  hp: number;
  attack: number;
  defence: number;
  armour: number;
  /** Bonus damage against mounted foes (spears) / on the charge (horse). */
  antiCav: number;
  charge: number;
  walk: number;
  run: number;
  morale: number;
  range: number;
  ammo: number;
  /** Seconds between blows / shots. */
  rate: number;
  mounted: boolean;
  desc: string;
  cost: number;
}

export const TYPES: Record<string, UnitType> = {
  // 고구려
  gaema: { id: "gaema", name: "개마무사", role: "hcav", kit: "rider", elite: true, men: 60, files: 15, hp: 22, attack: 13, defence: 9, armour: 11, antiCav: 2, charge: 34, walk: 4.3, run: 11.7, morale: 88, range: 0, ammo: 0, rate: 1.4, mounted: true, desc: "사람과 말 모두 찰갑을 두른 중장기병. 돌격이 전장을 가른다.", cost: 900 },
  horsebow: { id: "horsebow", name: "기사(騎射)", role: "hbow", kit: "bow", elite: false, men: 60, files: 20, hp: 12, attack: 6, defence: 5, armour: 3, antiCav: 0, charge: 8, walk: 4.9, run: 13.0, morale: 72, range: 140, ammo: 24, rate: 3.0, mounted: true, desc: "달리며 활을 쏘는 기마 궁수. 치고 빠진다.", cost: 700 },
  spear: { id: "spear", name: "창수", role: "spear", kit: "spear", elite: false, men: 160, files: 40, hp: 11, attack: 7, defence: 9, armour: 6, antiCav: 9, charge: 4, walk: 2.2, run: 4.4, morale: 70, range: 0, ammo: 0, rate: 1.6, mounted: false, desc: "긴 창으로 방진을 이룬다. 기병에게 강하다.", cost: 350 },
  sword: { id: "sword", name: "환도수", role: "sword", kit: "sword", elite: true, men: 140, files: 35, hp: 12, attack: 9, defence: 8, armour: 8, antiCav: 0, charge: 6, walk: 2.2, run: 4.7, morale: 76, range: 0, ammo: 0, rate: 1.3, mounted: false, desc: "고리자루칼과 방패의 중보병. 난전에 강하다.", cost: 450 },
  axe: { id: "axe", name: "부월수", role: "axe", kit: "axe", elite: false, men: 120, files: 30, hp: 12, attack: 12, defence: 5, armour: 5, antiCav: 2, charge: 8, walk: 2.2, run: 4.8, morale: 74, range: 0, ammo: 0, rate: 1.7, mounted: false, desc: "도끼로 갑옷을 쪼갠다. 방어는 약하다.", cost: 400 },
  maekgung: { id: "maekgung", name: "맥궁 궁수", role: "bow", kit: "bow", elite: false, men: 120, files: 40, hp: 9, attack: 4, defence: 3, armour: 2, antiCav: 0, charge: 2, walk: 2.2, run: 4.7, morale: 62, range: 175, ammo: 30, rate: 5.5, mounted: false, desc: "고구려의 각궁(맥궁). 멀리, 세게 쏜다.", cost: 400 },
  general: { id: "general", name: "대장군과 친위대", role: "general", kit: "rider", elite: true, men: 24, files: 8, hp: 30, attack: 14, defence: 10, armour: 12, antiCav: 2, charge: 30, walk: 4.3, run: 11.1, morale: 95, range: 0, ammo: 0, rate: 1.3, mounted: true, desc: "장군이 가까이 있으면 사기가 오른다. 잃으면 군이 흔들린다.", cost: 0 },
  // 수·당
  suiSpear: { id: "suiSpear", name: "수 창병", role: "spear", kit: "spear", elite: false, men: 180, files: 45, hp: 10, attack: 6, defence: 8, armour: 5, antiCav: 8, charge: 3, walk: 2.0, run: 4.2, morale: 58, range: 0, ammo: 0, rate: 1.7, mounted: false, desc: "", cost: 0 },
  suiSword: { id: "suiSword", name: "수 도순수", role: "sword", kit: "sword", elite: false, men: 150, files: 38, hp: 11, attack: 8, defence: 7, armour: 6, antiCav: 0, charge: 5, walk: 2.0, run: 4.3, morale: 60, range: 0, ammo: 0, rate: 1.4, mounted: false, desc: "", cost: 0 },
  suiBow: { id: "suiBow", name: "수 궁노수", role: "bow", kit: "bow", elite: false, men: 140, files: 45, hp: 9, attack: 5, defence: 3, armour: 3, antiCav: 0, charge: 2, walk: 2.0, run: 4.2, morale: 52, range: 190, ammo: 26, rate: 6.5, mounted: false, desc: "", cost: 0 },
  suiCav: { id: "suiCav", name: "수 기병", role: "cav", kit: "rider", elite: false, men: 70, files: 18, hp: 16, attack: 10, defence: 7, armour: 7, antiCav: 1, charge: 24, walk: 4.3, run: 11.1, morale: 62, range: 0, ammo: 0, rate: 1.5, mounted: true, desc: "", cost: 0 },
  suiGeneral: { id: "suiGeneral", name: "수 장수 우중문", role: "general", kit: "rider", elite: true, men: 24, files: 8, hp: 26, attack: 12, defence: 9, armour: 11, antiCav: 2, charge: 26, walk: 4.3, run: 10.4, morale: 80, range: 0, ammo: 0, rate: 1.4, mounted: true, desc: "", cost: 0 },
};
