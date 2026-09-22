// Runtime simulation for the voxel villagers. Deliberately React-free: the
// scene component owns one instance in a ref and calls update() from a single
// useFrame loop, then copies the resulting transforms into InstancedMeshes.
import { cellToWorld, pathFromSpawn, type VillageGraph } from "./village";
import { mulberry32 } from "./prng";

export const MAX_VILLAGERS = 600;
/** How many villagers may share one outline cell once the ring is full. */
export const CELL_CAPACITY = 3;

const STEP_SECONDS = 0.34; // walking pace, seconds per cell (varied per villager)
const DROP_SECONDS = 0.7; // spawn animation: falls in from above like the mosaic's tiles
const DROP_HEIGHT = 7;
const GAIT_RATE = 10.5; // walk-cycle radians per second at pace 1

// Clothing/skin palette, drawing from the app's greens + gold and warm earth tones.
export const SHIRT_COLORS = [
  0x0e8c5c, 0x14d28c, 0x095d3e, 0xe8b23c, 0xf2e6c9, 0xc9763f, 0xd94f3d, 0x2f6f4e, 0xf0b56b, 0xffffff,
];
export const PANTS_COLORS = [0x2c2418, 0x3b3a4a, 0x5a3b26, 0x1c3a2f, 0x6b6156];
export const SKIN_COLORS = [0x6b3f23, 0x8a5533, 0x4e2d18, 0xa5694a];
export const HAIR_COLORS = [0x151210, 0x2a1c12, 0xe8b23c, 0x095d3e, 0xd94f3d];

export type Villager = {
  path: number[];
  step: number;
  stepStart: number;
  stepDur: number;
  spawnTime: number;
  arrived: boolean;
  // current pose
  x: number;
  y: number;
  z: number;
  yaw: number;
  targetYaw: number;
  walk: number; // 0..1 blend of the walk cycle
  phase: number; // walk-cycle phase
  gait: number; // pace multiplier
  // lateral wobble inside the street so a crowd doesn't march single-file
  ox: number;
  oz: number;
  // where it will stand forever
  fx: number;
  fz: number;
  finalYaw: number;
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
};

const GOLDEN = 0.6180339887498949;

export class VillagerSystem {
  readonly villagers: Villager[] = [];
  now = 0;
  private readonly rand: () => number;
  private occupancy: Uint8Array;
  private pick = 0;

  constructor(private readonly graph: VillageGraph) {
    this.rand = mulberry32(20261003);
    this.occupancy = new Uint8Array(graph.targets.length);
  }

  get total() {
    return this.villagers.length;
  }

  /** True once no more villagers can be placed (ring full at CELL_CAPACITY, or hard cap). */
  get full() {
    return this.villagers.length >= MAX_VILLAGERS || this.minOccupancy() >= CELL_CAPACITY;
  }

  reset() {
    this.villagers.length = 0;
    this.occupancy.fill(0);
    this.pick = 0;
  }

  private minOccupancy() {
    let min = 255;
    for (let i = 0; i < this.occupancy.length; i++) if (this.occupancy[i] < min) min = this.occupancy[i];
    return this.occupancy.length ? min : 255;
  }

  /**
   * Choose the next outline cell. Rather than strictly nearest-first (which
   * would clump the first hundred villagers into the corner nearest the spawn),
   * targets are dealt around the ring with a golden-ratio sequence, so the
   * border reads as Zimbabwe after just a dozen arrivals and fills in evenly.
   * Once every cell has one villager, a second (then third) layer is added.
   */
  private nextTarget(): { cell: number; slot: number } | null {
    const n = this.graph.targets.length;
    if (n === 0) return null;
    const level = this.minOccupancy();
    if (level >= CELL_CAPACITY) return null;
    const start = Math.floor(((this.pick * GOLDEN) % 1) * n);
    this.pick++;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (this.occupancy[i] === level) {
        this.occupancy[i]++;
        return { cell: this.graph.targets[i], slot: level };
      }
    }
    return null;
  }

  /**
   * Add one villager. `instant` places it directly on its outline cell (used
   * when the page loads mid-event so the border reflects the existing count).
   */
  spawn(instant: boolean): boolean {
    if (this.villagers.length >= MAX_VILLAGERS) return false;
    const target = this.nextTarget();
    if (!target) return false;
    const g = this.graph;
    const r = this.rand;
    const path = pathFromSpawn(g, target.cell);

    const [tx, tz] = cellToWorld(g.cols, g.rows, target.cell);
    const outX = g.outward[target.cell * 2];
    const outZ = g.outward[target.cell * 2 + 1];
    // extra occupants stand along the ring's tangent, either side of the first
    const tangentX = -outZ;
    const tangentZ = outX;
    const side = target.slot === 0 ? 0 : target.slot === 1 ? 0.4 : -0.4;
    const fx = tx + tangentX * side + outX * (0.12 - target.slot * 0.08) + (r() - 0.5) * 0.06;
    const fz = tz + tangentZ * side + outZ * (0.12 - target.slot * 0.08) + (r() - 0.5) * 0.06;
    const finalYaw = Math.atan2(outX, outZ);

    const [sx, sz] = cellToWorld(g.cols, g.rows, g.spawnIndex);
    const ox = (r() - 0.5) * 0.4;
    const oz = (r() - 0.5) * 0.4;

    const v: Villager = {
      path,
      step: 0,
      stepStart: this.now + DROP_SECONDS,
      stepDur: STEP_SECONDS * (0.85 + r() * 0.35),
      spawnTime: this.now,
      arrived: instant,
      x: instant ? fx : sx + ox,
      y: instant ? 0 : DROP_HEIGHT,
      z: instant ? fz : sz + oz,
      yaw: instant ? finalYaw : r() * Math.PI * 2,
      targetYaw: finalYaw,
      walk: 0,
      phase: r() * Math.PI * 2,
      gait: 0.9 + r() * 0.25,
      ox,
      oz,
      fx,
      fz,
      finalYaw,
      shirt: SHIRT_COLORS[Math.floor(r() * SHIRT_COLORS.length)],
      pants: PANTS_COLORS[Math.floor(r() * PANTS_COLORS.length)],
      skin: SKIN_COLORS[Math.floor(r() * SKIN_COLORS.length)],
      hair: HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)],
    };
    this.villagers.push(v);
    return true;
  }

  update(now: number, dt: number) {
    this.now = now;
    const g = this.graph;
    const turn = 1 - Math.exp(-10 * dt);
    const blend = 1 - Math.exp(-8 * dt);

    for (const v of this.villagers) {
      if (!v.arrived) {
        const age = now - v.spawnTime;
        if (age < DROP_SECONDS) {
          const t = age / DROP_SECONDS;
          v.y = DROP_HEIGHT * (1 - t * t);
          v.walk += (0 - v.walk) * blend;
        } else {
          v.y = 0;
          // advance along the path; a long frame may cover several cells
          let p = (now - v.stepStart) / v.stepDur;
          while (p >= 1 && !v.arrived) {
            v.step++;
            v.stepStart += v.stepDur;
            if (v.step >= v.path.length - 1) {
              v.arrived = true;
            }
            p = (now - v.stepStart) / v.stepDur;
          }
          if (!v.arrived) {
            const [ax, az] = cellToWorld(g.cols, g.rows, v.path[v.step]);
            const [bx, bz] = cellToWorld(g.cols, g.rows, v.path[v.step + 1]);
            v.x = ax + (bx - ax) * p + v.ox;
            v.z = az + (bz - az) * p + v.oz;
            v.targetYaw = Math.atan2(bx - ax, bz - az);
            v.walk += (1 - v.walk) * blend;
          }
        }
      }
      if (v.arrived) {
        // ease onto the exact standing spot from wherever the last step left us
        v.x += (v.fx - v.x) * blend;
        v.z += (v.fz - v.z) * blend;
        v.y = 0;
        v.targetYaw = v.finalYaw;
        v.walk += (0 - v.walk) * blend;
      }

      // shortest-arc yaw damping
      let diff = v.targetYaw - v.yaw;
      diff = ((((diff + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      v.yaw += diff * turn;

      v.phase += dt * GAIT_RATE * v.gait * Math.max(v.walk, 0.06);
    }
  }
}
