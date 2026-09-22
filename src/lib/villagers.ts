// Runtime simulation for the voxel villagers. Deliberately React-free: the
// scene component owns one instance in a ref and calls update() from a single
// useFrame loop, then copies the resulting transforms into InstancedMeshes.
//
// Villagers drop into the town square and then stroll the streets, but only
// through cells the colour front has reached — as more people join, more of
// the island is painted and more of it opens up to walk in.
import { DIRS4, cellToWorld, isWalkable, type Village, type VillageGraph } from "./village";
import { mulberry32 } from "./prng";

export const MAX_VILLAGERS = 600;

const STEP_SECONDS = 0.36; // walking pace, seconds per cell (varied per villager)
const DROP_SECONDS = 0.7; // spawn animation: falls in from above like the mosaic's tiles
const DROP_HEIGHT = 7;
const GAIT_RATE = 10.5; // walk-cycle radians per second at pace 1
const PAUSE_CHANCE = 0.09; // chance, on reaching a cell, of stopping for a moment
const PAUSE_MIN = 0.6;
const PAUSE_MAX = 2.6;

// Clothing/skin palette, drawing from the app's greens + gold and warm earth tones.
export const SHIRT_COLORS = [
  0x0e8c5c, 0x14d28c, 0x095d3e, 0xe8b23c, 0xf2e6c9, 0xc9763f, 0xd94f3d, 0x2f6f4e, 0xf0b56b, 0xffffff,
];
export const PANTS_COLORS = [0x2c2418, 0x3b3a4a, 0x5a3b26, 0x1c3a2f, 0x6b6156];
export const SKIN_COLORS = [0x6b3f23, 0x8a5533, 0x4e2d18, 0xa5694a];
export const HAIR_COLORS = [0x151210, 0x2a1c12, 0xe8b23c, 0x095d3e, 0xd94f3d];

export type Villager = {
  cell: number;
  next: number; // -1 while paused
  dir: number; // index into DIRS4 of the last move
  stepStart: number;
  stepDur: number;
  spawnTime: number;
  dropping: boolean;
  pauseUntil: number;
  // current pose
  x: number;
  y: number;
  z: number;
  yaw: number;
  targetYaw: number;
  walk: number; // 0..1 blend of the walk cycle
  phase: number; // walk-cycle phase
  gait: number; // pace multiplier
  // lateral offset inside the street so a crowd doesn't march single-file
  ox: number;
  oz: number;
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
};

export class VillagerSystem {
  readonly villagers: Villager[] = [];
  now = 0;
  private readonly rand: () => number;
  private readonly types: number[];

  constructor(
    private readonly graph: VillageGraph,
    village: Village
  ) {
    this.rand = mulberry32(20261003);
    this.types = village.types;
  }

  get total() {
    return this.villagers.length;
  }

  reset() {
    this.villagers.length = 0;
  }

  /** A cell people may stand on right now: walkable, connected to the square, and painted. */
  private open(i: number, radius: number) {
    return isWalkable(this.types[i]) && this.graph.dist[i] !== -1 && this.graph.unlockRank[i] <= radius;
  }

  /**
   * Add one villager. `instant` seats it somewhere in the painted streets
   * straight away (used when the page loads mid-event so the village reflects
   * the existing count instead of replaying every arrival).
   */
  spawn(instant: boolean, radius: number): boolean {
    if (this.villagers.length >= MAX_VILLAGERS) return false;
    const g = this.graph;
    const r = this.rand;

    let cell = g.spawnIndex;
    if (instant) {
      const candidates: number[] = [];
      for (let i = 0; i < g.cols * g.rows; i++) if (this.open(i, radius)) candidates.push(i);
      if (candidates.length) cell = candidates[Math.floor(r() * candidates.length)];
    }
    const [sx, sz] = cellToWorld(g.cols, g.rows, cell);
    const ox = (r() - 0.5) * 0.44;
    const oz = (r() - 0.5) * 0.44;

    const v: Villager = {
      cell,
      next: -1,
      dir: Math.floor(r() * 4),
      stepStart: this.now + DROP_SECONDS,
      stepDur: STEP_SECONDS * (0.85 + r() * 0.35),
      spawnTime: this.now,
      dropping: !instant,
      pauseUntil: instant ? this.now + r() * 1.5 : 0,
      x: sx + ox,
      y: instant ? 0 : DROP_HEIGHT,
      z: sz + oz,
      yaw: r() * Math.PI * 2,
      targetYaw: 0,
      walk: 0,
      phase: r() * Math.PI * 2,
      gait: 0.9 + r() * 0.25,
      ox,
      oz,
      shirt: SHIRT_COLORS[Math.floor(r() * SHIRT_COLORS.length)],
      pants: PANTS_COLORS[Math.floor(r() * PANTS_COLORS.length)],
      skin: SKIN_COLORS[Math.floor(r() * SKIN_COLORS.length)],
      hair: HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)],
    };
    v.targetYaw = v.yaw;
    this.villagers.push(v);
    return true;
  }

  /**
   * Pick the next cell for a stroll: prefer carrying straight on, sometimes
   * turn, only double back when there's nowhere else to go.
   */
  private chooseNext(v: Villager, radius: number): number {
    const g = this.graph;
    const cx = v.cell % g.cols;
    const cy = (v.cell - cx) / g.cols;
    const back = v.dir ^ 1; // DIRS4 pairs (+x,-x) and (+y,-y)
    let totalW = 0;
    const options: { cell: number; dir: number; w: number }[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS4[d][0];
      const ny = cy + DIRS4[d][1];
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const ni = ny * g.cols + nx;
      if (!this.open(ni, radius)) continue;
      const w = d === v.dir ? 3 : d === back ? 0.12 : 1;
      options.push({ cell: ni, dir: d, w });
      totalW += w;
    }
    if (!options.length) return -1;
    let pick = this.rand() * totalW;
    for (const o of options) {
      pick -= o.w;
      if (pick <= 0) {
        v.dir = o.dir;
        return o.cell;
      }
    }
    v.dir = options[options.length - 1].dir;
    return options[options.length - 1].cell;
  }

  update(now: number, dt: number, radius: number) {
    this.now = now;
    const g = this.graph;
    const turn = 1 - Math.exp(-10 * dt);
    const blend = 1 - Math.exp(-8 * dt);

    for (const v of this.villagers) {
      if (v.dropping) {
        const age = now - v.spawnTime;
        if (age < DROP_SECONDS) {
          const t = age / DROP_SECONDS;
          v.y = DROP_HEIGHT * (1 - t * t);
          v.walk += (0 - v.walk) * blend;
          v.phase += dt * GAIT_RATE * 0.06;
          continue;
        }
        v.dropping = false;
        v.y = 0;
        v.stepStart = now;
        v.next = this.chooseNext(v, radius);
      }

      if (v.next === -1) {
        // paused (or boxed in): sway a little, then try to move on
        v.walk += (0 - v.walk) * blend;
        if (now >= v.pauseUntil) {
          v.next = this.chooseNext(v, radius);
          v.stepStart = now;
          if (v.next === -1) v.pauseUntil = now + 0.5;
        }
      } else {
        let p = (now - v.stepStart) / v.stepDur;
        while (p >= 1 && v.next !== -1) {
          v.cell = v.next;
          v.stepStart += v.stepDur;
          if (this.rand() < PAUSE_CHANCE) {
            v.next = -1;
            v.pauseUntil = now + PAUSE_MIN + this.rand() * (PAUSE_MAX - PAUSE_MIN);
            const [wx, wz] = cellToWorld(g.cols, g.rows, v.cell);
            v.x = wx + v.ox;
            v.z = wz + v.oz;
            break;
          }
          v.next = this.chooseNext(v, radius);
          p = (now - v.stepStart) / v.stepDur;
        }
        if (v.next !== -1) {
          const [ax, az] = cellToWorld(g.cols, g.rows, v.cell);
          const [bx, bz] = cellToWorld(g.cols, g.rows, v.next);
          v.x = ax + (bx - ax) * p + v.ox;
          v.z = az + (bz - az) * p + v.oz;
          v.targetYaw = Math.atan2(bx - ax, bz - az);
          v.walk += (1 - v.walk) * blend;
        }
      }

      // shortest-arc yaw damping
      let diff = v.targetYaw - v.yaw;
      diff = ((((diff + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      v.yaw += diff * turn;

      v.phase += dt * GAIT_RATE * v.gait * Math.max(v.walk, 0.06);
    }
  }
}
