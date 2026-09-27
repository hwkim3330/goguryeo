/** Historical battles (and a free one): the ground, the armies, where they stand, what they do. */
import type { Look } from "./engine/scene";
import type { Battle } from "./sim/battle";
import type { FieldSpec } from "./world/terrain";

export interface Scenario {
  id: string;
  year: string;
  title: string;
  sub: string;
  story: string[];
  goal: string;
  field: FieldSpec;
  look: Look;
  setup(b: Battle): void;
  /** Where the camera starts. */
  cam: { x: number; z: number; dist: number; yaw: number; pitch: number };
}

const N = 0; // facing +z (south)
const S = Math.PI; // facing -z (north)

export const SCENARIOS: Scenario[] = [
  {
    id: "salsu",
    year: "612년 여름",
    title: "살수대첩",
    sub: "薩水大捷 · 을지문덕",
    story: [
      "수 양제의 30만 별동대가 평양성 앞까지 왔다가 굶주림 끝에 물러난다.",
      "을지문덕의 시 한 수에 속은 그들은 지금 살수(청천강)를 건너 북으로 달아나는 중이다.",
      "절반이 강을 건넜을 때, 뒤를 친다. 강 한가운데서 대오가 무너질 것이다.",
    ],
    goal: "수나라 군이 북쪽 끝으로 빠져나가기 전에 무너뜨리십시오. 여울(얕은 물목)에서 발이 묶인 적이 가장 약합니다.",
    field: {
      seed: 612,
      size: 1600,
      hills: 0.8,
      forest: 0.7,
      river: {
        pts: [
          [-820, -300],
          [-420, -250],
          [-120, -205],
          [160, -230],
          [480, -190],
          [820, -240],
        ],
        width: 74,
        depth: 2.6,
        fords: [
          [-120, -206, 70],
          [300, -212, 60],
        ],
      },
      roads: [
        [
          [0, 800],
          [-40, 300],
          [-100, 0],
          [-120, -206],
          [-160, -500],
          [-200, -800],
        ],
        [
          [-40, 300],
          [140, 60],
          [300, -212],
          [360, -600],
        ],
      ],
      bumps: [
        [520, 120, 260, 34],
        [-560, 180, 240, 26],
        [0, 480, 300, 16],
      ],
    },
    look: { sunElev: 16, sunAz: 245, turbidity: 6, rayleigh: 1.6, fog: 0.00032, exposure: 0.95 },
    setup(b) {
      // Sui: some across already, the rest in the fords and columns on the south bank, marching north.
      const sui: [string, number, number][] = [
        ["suiSpear", -150, -340],
        ["suiBow", -60, -330],
        ["suiSword", -125, -215],
        ["suiSpear", 300, -225],
        ["suiCav", 330, -110],
        ["suiSword", -110, -60],
        ["suiBow", 220, -40],
        ["suiSpear", -40, 40],
        ["suiGeneral", 60, -20],
        ["suiCav", -250, -20],
        ["suiSword", 120, 90],
      ];
      for (const [t, x, z] of sui) {
        const u = b.addUnit(t, 1, 1, x, z, S);
        u.files = Math.round(u.type.files * 0.55);
        // North to the map's edge (and home): whoever gets there has escaped.
        u.march = [x < 90 ? -170 : 360, -800];
      }
      // 고구려: the main body south, horse on the eastern hill.
      b.addUnit("general", 0, 0, 0, 470, S, "을지문덕");
      b.addUnit("spear", 0, 0, -120, 390, S, "창수 제1대");
      b.addUnit("sword", 0, 0, 40, 400, S, "환도수 제1대");
      b.addUnit("axe", 0, 0, 190, 390, S, "부월수");
      b.addUnit("maekgung", 0, 0, -60, 440, S, "맥궁 궁수 제1대");
      b.addUnit("maekgung", 0, 0, 120, 445, S, "맥궁 궁수 제2대");
      b.addUnit("gaema", 0, 0, 540, 150, -Math.PI / 2 - 0.4, "개마무사 제1대");
      b.addUnit("gaema", 0, 0, 470, 220, -Math.PI / 2 - 0.4, "개마무사 제2대");
      b.addUnit("horsebow", 0, 0, -520, 200, Math.PI / 2 + 0.4, "기사대");
      b.addUnit("sword", 0, 0, -380, 330, S + 0.5, "환도수 제2대");
    },
    cam: { x: 60, z: 420, dist: 330, yaw: 0.25, pitch: 0.55 },
  },
  {
    id: "yodong",
    year: "645년 봄",
    title: "요동벌 회전",
    sub: "遼東 · 당 태종의 친정",
    story: [
      "당 태종 이세민이 몸소 대군을 이끌고 요하를 건넜다.",
      "요동성을 구하러 나선 고구려군이 트인 벌판에서 당군과 마주 섰다.",
      "정면으로 부딪쳐 이기려면 개마무사의 돌격과 맥궁의 화살을 맞춰 써야 한다.",
    ],
    goal: "당군을 물리치십시오. 창병에게 기병을 정면으로 들이박지 마십시오. 옆과 뒤를 치십시오.",
    field: { seed: 645, size: 1600, hills: 0.45, forest: 0.35, roads: [[[-800, 40], [0, 0], [800, -60]]], bumps: [[0, 380, 260, 14], [0, -380, 260, 12]] },
    look: { sunElev: 38, sunAz: 150, turbidity: 3.5, rayleigh: 1.2, fog: 0.0003, exposure: 1.0 },
    setup(b) {
      const tang: [string, number, number][] = [
        ["suiSpear", -150, -210],
        ["suiSword", 0, -210],
        ["suiSpear", 150, -210],
        ["suiBow", -80, -250],
        ["suiBow", 80, -250],
        ["suiCav", -330, -190],
        ["suiCav", 330, -190],
        ["suiSword", 0, -300],
        ["suiGeneral", 0, -340],
      ];
      for (const [t, x, z] of tang) b.addUnit(t, 1, 2, x, z, N, t === "suiGeneral" ? "당 태종 친위대" : undefined);
      b.addUnit("general", 0, 0, 0, 320, S, "고연수");
      b.addUnit("spear", 0, 0, -160, 210, S, "창수 제1대");
      b.addUnit("sword", 0, 0, 0, 210, S, "환도수");
      b.addUnit("spear", 0, 0, 160, 210, S, "창수 제2대");
      b.addUnit("maekgung", 0, 0, -80, 250, S, "맥궁 궁수 제1대");
      b.addUnit("maekgung", 0, 0, 80, 250, S, "맥궁 궁수 제2대");
      b.addUnit("gaema", 0, 0, -340, 220, S, "개마무사 좌익");
      b.addUnit("gaema", 0, 0, 340, 220, S, "개마무사 우익");
      b.addUnit("axe", 0, 0, 0, 280, S, "부월수");
    },
    cam: { x: 0, z: 330, dist: 380, yaw: 0, pitch: 0.6 },
  },
];
