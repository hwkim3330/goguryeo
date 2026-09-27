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

/** 안시성's ring: an irregular oval on the hill, the gate facing south. */
function ansiRing(): [number, number][] {
  const pts: [number, number][] = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 205 + Math.sin(a * 3 + 0.7) * 22 + Math.sin(a * 5 + 2.1) * 10;
    pts.push([Math.sin(a) * r * 1.12, -60 + Math.cos(a) * r * 0.9]);
  }
  return pts;
}
const ANSI = ansiRing();
/** A point on the ring between vertex i and i+1 (t along), pushed out by `out`. */
function onWall(i: number, t: number, out: number): [number, number, number] {
  const [ax, az] = ANSI[i % ANSI.length];
  const [bx, bz] = ANSI[(i + 1) % ANSI.length];
  const x = ax + (bx - ax) * t;
  const z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az);
  let nx = (bz - az) / l;
  let nz = -(bx - ax) / l;
  if (nx * x + nz * (z + 60) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [x + nx * out, z + nz * out, Math.atan2(nx, nz)];
}

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
  {
    id: "ansi",
    year: "645년 가을",
    title: "안시성 공방전",
    sub: "安市城 · 양만춘과 당 태종",
    story: [
      "요동성과 백암성이 무너졌다. 당 태종의 대군이 안시성을 에워싼 지 두 달.",
      "당군은 성보다 높은 토산(土山)을 쌓아 성벽 동남쪽에 붙였다. 충차가 성문을 두드린다.",
      "성주 양만춘은 물러서지 않는다. 해가 질 때까지 성을 지켜라. 겨울이 오면 저들은 돌아간다.",
    ],
    goal: "해가 질 때까지(15분) 성을 지키십시오. 궁수는 성벽 위에서 더 멀리 쏘고, 여장 뒤에서 화살을 덜 맞습니다. 사다리로 올라오는 적은 성벽 위에서 떨어뜨리고, 토산을 빼앗기지 마십시오. 성문(G)을 열면 기병으로 역습할 수 있습니다.",
    field: {
      seed: 645,
      size: 1600,
      hills: 0.6,
      forest: 0.5,
      bumps: [
        [0, -80, 520, 48],
        [-420, -520, 300, 40],
        [420, -560, 280, 36],
      ],
      roads: [
        [
          [0, 800],
          [20, 420],
          [onWall(0, 0.5, 0)[0], onWall(0, 0.5, 0)[1]],
        ],
      ],
      fort: {
        ring: ANSI,
        gate: 0,
        height: 9,
        thick: 7,
        side: 0,
        hold: 900,
        // The mound against the south-east wall.
        mound: [onWall(4, 0.5, 24)[0], onWall(4, 0.5, 24)[1], 46, 12],
      },
    },
    look: { sunElev: 26, sunAz: 250, turbidity: 3.5, rayleigh: 1.3, fog: 0.00022, exposure: 0.95 },
    setup(b) {
      // 고구려: archers along the south walls, foot inside, horse behind the gate.
      b.addUnit("general", 0, 0, 0, -120, N, "양만춘");
      for (const [i, name] of [
        [29, "맥궁 궁수 제1대"],
        [1, "맥궁 궁수 제2대"],
        [3, "맥궁 궁수 제3대"],
        [26, "맥궁 궁수 제4대"],
      ] as [number, string][]) {
        const [x, z, face] = onWall(i, 0.5, 2.2);
        const u = b.addUnit("maekgung", 0, 0, x, z, face, name);
        u.files = 40;
        b.order(u, { k: "move", x, z, face, files: 40, run: false });
      }
      const [mx, mz, mface] = onWall(4, 0.5, -16);
      b.addUnit("spear", 0, 0, mx, mz, mface, "토산 수비대");
      const [gx, gz] = onWall(0, 0.5, -40);
      b.addUnit("sword", 0, 0, gx - 50, gz, N, "환도수 제1대");
      b.addUnit("sword", 0, 0, gx + 50, gz, N, "환도수 제2대");
      b.addUnit("axe", 0, 0, gx, gz - 30, N, "부월수");
      b.addUnit("spear", 0, 0, gx - 90, gz - 60, N, "창수");
      b.addUnit("gaema", 0, 0, gx + 10, gz - 90, N, "개마무사");
      // 당: the whole army before the south face, rams at the gate, a column at the mound.
      const tang: [string, number, number, string?][] = [
        ["suiRam", 0, 330, "충차 제1대"],
        ["suiRam", 40, 350, "충차 제2대"],
        ["suiSword", -170, 340],
        ["suiSword", 170, 340],
        ["suiSpear", -300, 380],
        ["suiSpear", 300, 360],
        ["suiSword", -60, 420],
        ["suiSword", 90, 420],
        ["suiSpear", 260, 250],
        ["suiBow", -120, 300],
        ["suiBow", 120, 300],
        ["suiBow", 330, 190],
        ["suiCav", -420, 420],
        ["suiCav", 420, 420],
        ["suiGeneral", 0, 520, "당 태종 이세민"],
      ];
      for (const [t, x, z, name] of tang) b.addUnit(t, 1, 2, x, z, S, name);
    },
    cam: { x: 40, z: 120, dist: 360, yaw: 0.35, pitch: 0.5 },
  },
];