/**
 * Who is on the map and what they can build: the six powers (고구려 and its neighbours, with
 * 수 becoming 당 in 618), their cities with their places, walls and people at the start, what
 * each can raise (고구려's own regiments; the others' soldiers dressed in their colours under
 * their names), the buildings of a city and the learning (문물) a kingdom can pursue.
 */
import { TYPES, type UnitType } from "../sim/units";

export type FactionId = "goguryeo" | "sui" | "baekje" | "silla" | "malgal" | "khitan";

export interface Faction {
  id: FactionId;
  name: string;
  hanja: string;
  /** Battle palette index (soldier colours and standards). */
  team: number;
  color: number;
  roster: string[];
  /** Name prefixes for their soldiers. */
  prefix: string;
}

export const FACTIONS: Record<FactionId, Faction> = {
  goguryeo: { id: "goguryeo", name: "고구려", hanja: "高句麗", team: 0, color: 0xb8322a, roster: ["spear", "sword", "axe", "maekgung", "horsebow", "gaema"], prefix: "" },
  sui: { id: "sui", name: "수", hanja: "隋", team: 1, color: 0xd8b048, roster: ["suiSpear", "suiSword", "suiBow", "suiCav", "suiRam"], prefix: "수" },
  baekje: { id: "baekje", name: "백제", hanja: "百濟", team: 4, color: 0x7a4aa8, roster: ["suiSpear", "suiSword", "suiBow", "suiCav"], prefix: "백제" },
  silla: { id: "silla", name: "신라", hanja: "新羅", team: 5, color: 0x3a9a6a, roster: ["suiSpear", "suiSword", "suiBow", "suiCav"], prefix: "신라" },
  malgal: { id: "malgal", name: "말갈", hanja: "靺鞨", team: 3, color: 0x8a6a48, roster: ["axe", "horsebow", "suiCav"], prefix: "말갈" },
  khitan: { id: "khitan", name: "거란", hanja: "契丹", team: 6, color: 0x4a7ab0, roster: ["horsebow", "suiCav", "suiSpear"], prefix: "거란" },
};
export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

/** The name a faction's soldiers of `typeId` go by, and their stats (with a small national cast). */
export function unitTypeFor(f: FactionId, typeId: string, tang = false): UnitType {
  const t = TYPES[typeId];
  if (f === "goguryeo") return t;
  const role: Record<string, string> = { suiSpear: "창병", suiSword: "도순수", suiBow: "궁노수", suiCav: "기병", suiRam: "충차", axe: "도끼병", horsebow: "기마궁수", suiGeneral: "장수" };
  let prefix = FACTIONS[f].prefix;
  if (f === "sui" && tang) prefix = "당";
  const name = `${prefix} ${role[typeId] ?? t.name}`;
  const c: UnitType = { ...t, name };
  if (f === "silla" && typeId === "suiSword") Object.assign(c, { name: "신라 낭당(郎幢)", morale: t.morale + 10, attack: t.attack + 1 });
  if (f === "baekje" && typeId === "suiBow") Object.assign(c, { name: "백제 궁수", attack: t.attack + 1 });
  if (f === "malgal") Object.assign(c, { morale: t.morale + 6, armour: Math.max(1, t.armour - 2) });
  if (f === "khitan" && typeId === "horsebow") Object.assign(c, { name: "거란 기마궁수", ammo: t.ammo + 6 });
  if (f === "sui" && tang && typeId === "suiCav") Object.assign(c, { name: "당 철기(鐵騎)", armour: t.armour + 2, attack: t.attack + 1 });
  return c;
}

export function factionName(f: FactionId, tang: boolean): string {
  return f === "sui" && tang ? "당" : FACTIONS[f].name;
}

export interface CitySeed {
  name: string;
  lon: number;
  lat: number;
  owner: FactionId;
  pop: number;
  walls: number;
  capital?: boolean;
  /** Mountain fortress (산성): harder to take. */
  mountain?: boolean;
}

export const CITIES: CitySeed[] = [
  // 고구려
  { name: "평양성", lon: 125.75, lat: 39.02, owner: "goguryeo", pop: 8, walls: 3, capital: true },
  { name: "국내성", lon: 126.18, lat: 41.13, owner: "goguryeo", pop: 5, walls: 3, mountain: true },
  { name: "요동성", lon: 123.17, lat: 41.27, owner: "goguryeo", pop: 6, walls: 3 },
  { name: "안시성", lon: 122.72, lat: 40.82, owner: "goguryeo", pop: 3, walls: 3, mountain: true },
  { name: "신성", lon: 123.95, lat: 41.9, owner: "goguryeo", pop: 3, walls: 3, mountain: true },
  { name: "건안성", lon: 122.35, lat: 40.25, owner: "goguryeo", pop: 2, walls: 2 },
  { name: "비사성", lon: 121.62, lat: 39.1, owner: "goguryeo", pop: 2, walls: 3, mountain: true },
  { name: "오골성", lon: 124.35, lat: 40.5, owner: "goguryeo", pop: 2, walls: 3, mountain: true },
  { name: "졸본성", lon: 125.4, lat: 41.32, owner: "goguryeo", pop: 2, walls: 2, mountain: true },
  { name: "부여성", lon: 124.5, lat: 43.2, owner: "goguryeo", pop: 3, walls: 2 },
  { name: "책성", lon: 130.0, lat: 42.9, owner: "goguryeo", pop: 2, walls: 2 },
  { name: "한성", lon: 125.3, lat: 38.4, owner: "goguryeo", pop: 3, walls: 2 },
  { name: "비열홀", lon: 127.45, lat: 38.95, owner: "goguryeo", pop: 2, walls: 1 },
  { name: "무려라", lon: 122.15, lat: 41.95, owner: "goguryeo", pop: 1, walls: 1 },
  { name: "용담성", lon: 127.2, lat: 40.2, owner: "goguryeo", pop: 2, walls: 2, mountain: true },
  // 수
  { name: "탁군", lon: 116.4, lat: 39.9, owner: "sui", pop: 10, walls: 3, capital: true },
  { name: "유성", lon: 120.45, lat: 41.57, owner: "sui", pop: 5, walls: 2 },
  { name: "임유관", lon: 119.75, lat: 40.0, owner: "sui", pop: 3, walls: 3 },
  { name: "북평", lon: 118.9, lat: 39.9, owner: "sui", pop: 4, walls: 2 },
  { name: "동래", lon: 120.1, lat: 37.2, owner: "sui", pop: 5, walls: 2 },
  { name: "청주", lon: 118.5, lat: 36.7, owner: "sui", pop: 7, walls: 2 },
  { name: "하간", lon: 116.3, lat: 38.4, owner: "sui", pop: 7, walls: 2 },
  { name: "회원진", lon: 121.4, lat: 41.55, owner: "sui", pop: 1, walls: 1 },
  // 백제
  { name: "사비성", lon: 126.91, lat: 36.28, owner: "baekje", pop: 7, walls: 3, capital: true },
  { name: "금마저", lon: 127.03, lat: 35.93, owner: "baekje", pop: 3, walls: 2 },
  { name: "임존성", lon: 126.62, lat: 36.62, owner: "baekje", pop: 2, walls: 2, mountain: true },
  { name: "남방성", lon: 126.85, lat: 35.1, owner: "baekje", pop: 3, walls: 1 },
  // 신라
  { name: "서라벌", lon: 129.21, lat: 35.84, owner: "silla", pop: 7, walls: 2, capital: true },
  { name: "한산성", lon: 127.2, lat: 37.5, owner: "silla", pop: 5, walls: 2 },
  { name: "국원성", lon: 127.93, lat: 36.97, owner: "silla", pop: 3, walls: 2 },
  { name: "대야성", lon: 128.16, lat: 35.57, owner: "silla", pop: 3, walls: 2, mountain: true },
  { name: "삼년산성", lon: 127.72, lat: 36.48, owner: "silla", pop: 2, walls: 3, mountain: true },
  { name: "하슬라", lon: 128.9, lat: 37.75, owner: "silla", pop: 2, walls: 1 },
  { name: "금관성", lon: 128.88, lat: 35.23, owner: "silla", pop: 3, walls: 1 },
  { name: "사벌주", lon: 128.16, lat: 36.42, owner: "silla", pop: 3, walls: 1 },
  // 말갈
  { name: "속말부", lon: 126.55, lat: 43.85, owner: "malgal", pop: 3, walls: 0 },
  { name: "백산부", lon: 128.6, lat: 42.8, owner: "malgal", pop: 2, walls: 0 },
  { name: "안거골부", lon: 128.0, lat: 45.0, owner: "malgal", pop: 2, walls: 0 },
  { name: "불열부", lon: 129.9, lat: 44.5, owner: "malgal", pop: 2, walls: 0 },
  { name: "흑수부", lon: 130.8, lat: 45.7, owner: "malgal", pop: 2, walls: 0 },
  // 거란
  { name: "거란 대하씨", lon: 119.9, lat: 43.4, owner: "khitan", pop: 3, walls: 0, capital: true },
  { name: "해(奚)", lon: 118.4, lat: 41.9, owner: "khitan", pop: 2, walls: 0 },
  { name: "실위", lon: 121.6, lat: 45.2, owner: "khitan", pop: 2, walls: 0 },
];

export interface Building {
  id: string;
  name: string;
  cost: number;
  turns: number;
  desc: string;
  needs?: string;
}
export const BUILDINGS: Building[] = [
  { id: "farm", name: "둔전·농지", cost: 40, turns: 1, desc: "곡식 +3" },
  { id: "market", name: "저자(시장)", cost: 50, turns: 1, desc: "재화 +4" },
  { id: "barracks", name: "병영", cost: 60, turns: 1, desc: "환도수·부월수 징집, 신병 사기 +5" },
  { id: "smithy", name: "철장(대장간)", cost: 80, turns: 2, desc: "신병 갑옷 +2, 개마무사 징집(문물 필요)" },
  { id: "stable", name: "목장", cost: 60, turns: 1, desc: "기병 징집, 기병 비용 -20%" },
  { id: "school", name: "경당·태학", cost: 70, turns: 2, desc: "문물 +3" },
  { id: "temple", name: "사찰", cost: 50, turns: 1, desc: "인구 성장 +50%, 민심 안정" },
  { id: "walls", name: "성벽 보강", cost: 90, turns: 2, desc: "성벽 한 단계 (최대 3, 산성 축조로 4)" },
];

export interface Tech {
  id: string;
  name: string;
  cost: number;
  desc: string;
  needs?: string[];
}
export const TECHS: Tech[] = [
  { id: "dunjeon", name: "둔전제", cost: 14, desc: "모든 성 곡식 +25%" },
  { id: "bongsu", name: "봉수(烽燧)", cost: 12, desc: "적 군대를 2칸 더 멀리서 본다" },
  { id: "bow", name: "맥궁 개량", cost: 18, desc: "궁수 사거리 +15%, 공격 +1" },
  { id: "iron", name: "철갑 개량", cost: 22, desc: "모든 병사 갑옷 +2", needs: ["bow"] },
  { id: "gaema", name: "개마 무장", cost: 26, desc: "개마무사 징집 (철장 필요)", needs: ["iron"] },
  { id: "yulryeong", name: "율령 정비", cost: 18, desc: "재화 +15%" },
  { id: "buddhism", name: "불교 진흥", cost: 14, desc: "인구 성장 +30%, 사기 +3" },
  { id: "sanseong", name: "산성 축조", cost: 24, desc: "성벽 4단계, 성 방어 +20%", needs: ["dunjeon"] },
  { id: "cheongya", name: "청야 전술", cost: 22, desc: "우리 땅의 적군 소모 두 배", needs: ["sanseong"] },
  { id: "taehak", name: "태학 박사", cost: 20, desc: "문물 +30%", needs: ["buddhism"] },
  { id: "jangseong", name: "천리장성", cost: 34, desc: "요하 방면 성들 성벽 +1", needs: ["sanseong", "yulryeong"] },
];

/** Famous names for new armies' generals, by faction. */
export const GENERALS: Record<FactionId, string[]> = {
  goguryeo: ["을지문덕", "강이식", "고건무", "연개소문", "양만춘", "고연수", "온사문", "고혜진", "연남생", "검모잠", "고정의", "뇌음신", "고선", "을지소", "명림"],
  sui: ["우중문", "우문술", "내호아", "양량", "주라후", "설세웅", "이세적", "장량", "소정방", "설인귀", "계필하력", "유인궤"],
  baekje: ["계백", "윤충", "흑치상지", "의직", "성충", "복신"],
  silla: ["김유신", "김춘추", "품석", "알천", "김품일", "죽죽"],
  malgal: ["돌지계", "걸사비우", "대조영", "사리"],
  khitan: ["대하마회", "손만영", "이진충"],
};
