// Data + grid logic for the isometric voxel village (the second display
// section). The grid itself is generated offline by scripts/generate-village.mjs
// from the same Zimbabwe boundary the particle mosaic uses.

export const CELL = {
  OUTSIDE: 0,
  STREET: 1,
  EDGE: 2, // the outline ring villagers walk out to and stand on
  BUILDING: 3,
  PLAZA: 4,
} as const;

export type Village = {
  gridCols: number;
  gridRows: number;
  spawn: { x: number; y: number };
  /** Flattened gridCols*gridRows, row-major (y*gridCols+x). See CELL. */
  types: number[];
  /** Building voxel height (1..6) at BUILDING cells, else 0. */
  heights: number[];
  /** 0..1 per cell, for per-building colour variation. */
  colorSeed: number[];
};

export async function loadVillage(): Promise<Village> {
  const res = await fetch("/data/village.json");
  if (!res.ok) throw new Error("Failed to load village grid");
  return res.json();
}

/**
 * Everything the runtime needs that can be derived once from the raw grid:
 * a BFS tree rooted at the spawn cell (so any villager's path is just a
 * parent-chain lookup), the list of reachable outline cells ordered around
 * the ring, and an outward-facing direction for each outline cell.
 */
export type VillageGraph = {
  cols: number;
  rows: number;
  spawnIndex: number;
  /** BFS parent over walkable cells (street + edge); -1 for spawn/unreachable. */
  parent: Int32Array;
  /** BFS distance in cells from spawn; -1 if unreachable. */
  dist: Int32Array;
  /** Manhattan distance (in cells) from the nearest outside cell, for every inside cell. */
  edgeDepth: Int32Array;
  /** Reachable outline cells, ordered by angle around the island's centroid. */
  targets: number[];
  /** Unit outward direction (worldX, worldZ) per cell; only meaningful for outline cells. */
  outward: Float32Array;
  /** World-space bounds of the inside cells (cell centres +/- half a cell). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

export function isWalkable(type: number) {
  return type === CELL.STREET || type === CELL.EDGE;
}

/** Grid (x, y) -> world (x, z). North (higher grid y) is -z so it reads "up" on screen. */
export function cellToWorld(cols: number, rows: number, index: number): [number, number] {
  const gx = index % cols;
  const gy = (index - gx) / cols;
  return [gx - (cols - 1) / 2, -(gy - (rows - 1) / 2)];
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function buildVillageGraph(v: Village): VillageGraph {
  const { gridCols: cols, gridRows: rows, types } = v;
  const total = cols * rows;
  const spawnIndex = v.spawn.y * cols + v.spawn.x;

  // --- BFS from spawn over walkable cells (4-connected) ---
  const parent = new Int32Array(total).fill(-1);
  const dist = new Int32Array(total).fill(-1);
  const queue: number[] = [spawnIndex];
  dist[spawnIndex] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (dist[ni] !== -1 || !isWalkable(types[ni])) continue;
      dist[ni] = dist[cur] + 1;
      parent[ni] = cur;
      queue.push(ni);
    }
  }

  // --- multi-source BFS from outside cells -> depth into the island ---
  const edgeDepth = new Int32Array(total).fill(-1);
  const q2: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (types[i] !== CELL.OUTSIDE) continue;
      edgeDepth[i] = 0;
      q2.push(i);
    }
  }
  // grid border also counts as "outside"
  for (let head = 0; head < q2.length; head++) {
    const cur = q2[head];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (edgeDepth[ni] !== -1) continue;
      edgeDepth[ni] = edgeDepth[cur] + 1;
      q2.push(ni);
    }
  }
  for (let i = 0; i < total; i++) {
    if (edgeDepth[i] === -1) edgeDepth[i] = 1; // grid-border cells never reached from outside
  }

  // --- centroid + bounds of inside cells ---
  let sx = 0;
  let sz = 0;
  let n = 0;
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < total; i++) {
    if (types[i] === CELL.OUTSIDE) continue;
    const [wx, wz] = cellToWorld(cols, rows, i);
    sx += wx;
    sz += wz;
    n++;
    if (wx - 0.5 < bounds.minX) bounds.minX = wx - 0.5;
    if (wx + 0.5 > bounds.maxX) bounds.maxX = wx + 0.5;
    if (wz - 0.5 < bounds.minZ) bounds.minZ = wz - 0.5;
    if (wz + 0.5 > bounds.maxZ) bounds.maxZ = wz + 0.5;
  }
  const cx = n ? sx / n : 0;
  const cz = n ? sz / n : 0;

  // --- outward direction per outline cell ---
  const outward = new Float32Array(total * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (types[i] !== CELL.EDGE) continue;
      let ox = 0;
      let oz = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          const outside =
            nx < 0 || ny < 0 || nx >= cols || ny >= rows || types[ny * cols + nx] === CELL.OUTSIDE;
          if (outside) {
            ox += dx;
            oz += -dy; // grid y is -world z
          }
        }
      }
      if (ox === 0 && oz === 0) {
        const [wx, wz] = cellToWorld(cols, rows, i);
        ox = wx - cx;
        oz = wz - cz;
      }
      const len = Math.hypot(ox, oz) || 1;
      outward[i * 2] = ox / len;
      outward[i * 2 + 1] = oz / len;
    }
  }

  // --- reachable outline cells, ordered around the ring ---
  const targets: number[] = [];
  for (let i = 0; i < total; i++) {
    if (types[i] === CELL.EDGE && dist[i] !== -1) targets.push(i);
  }
  const angleOf = (i: number) => {
    const [wx, wz] = cellToWorld(cols, rows, i);
    return Math.atan2(wz - cz, wx - cx);
  };
  targets.sort((a, b) => angleOf(a) - angleOf(b));

  return { cols, rows, spawnIndex, parent, dist, edgeDepth, targets, outward, bounds };
}

/** Cell indices from spawn (inclusive) to `target` (inclusive), via the BFS tree. */
export function pathFromSpawn(g: VillageGraph, target: number): number[] {
  const path: number[] = [];
  let cur = target;
  while (cur !== -1) {
    path.push(cur);
    if (cur === g.spawnIndex) break;
    cur = g.parent[cur];
  }
  path.reverse();
  return path;
}
