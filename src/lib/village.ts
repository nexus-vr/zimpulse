// Data + grid logic for the isometric voxel village (the second display
// section). The grid itself is generated offline by scripts/generate-village.mjs
// from the same Zimbabwe boundary the particle mosaic uses.

export const CELL = {
  OUTSIDE: 0,
  STREET: 1,
  EDGE: 2, // the outline ring around the island (walkable, never built on)
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

/** How many heartbeats it takes to paint the whole island, by default. */
export const DEFAULT_FULL_COLOR_COUNT = 150;

/**
 * Everything the runtime needs that can be derived once from the raw grid.
 */
export type VillageGraph = {
  cols: number;
  rows: number;
  spawnIndex: number;
  /** BFS distance in cells from spawn over walkable cells; -1 if unreachable. */
  dist: Int32Array;
  /** Manhattan distance (in cells) from the nearest outside cell, for every inside cell. */
  edgeDepth: Int32Array;
  /**
   * 0 at the town square rising to 1 at the far coast, following the island's
   * own connectivity (BFS over every inside cell). Colour is "unlocked" for a
   * cell once the colour radius passes its rank, so paint spreads outward.
   */
  unlockRank: Float32Array;
  /** Rank one grid cell of BFS distance corresponds to (1 / max distance). */
  unlockPerCell: number;
  /** World-space (x, z) each cell moves to when the island reassembles as a heart. */
  heartX: Float32Array;
  heartZ: Float32Array;
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

/**
 * The colour radius (in unlock-rank units, 0..1) for a given heartbeat count.
 * Nothing is painted at zero. The first heartbeat paints the town square; the
 * curve then eases outward so early guests see a big change and the last few
 * cells fill in gently. Slightly negative at zero so the soft edge of the
 * paint front doesn't half-tint the spawn cell.
 */
export function colorRadiusFor(count: number, fullCount: number, g: VillageGraph) {
  if (count <= 0) return -0.05;
  const square = g.unlockPerCell * 4.5;
  const t = Math.min(1, count / Math.max(1, fullCount));
  return Math.min(1.02, square + (1.02 - square) * Math.pow(t, 0.7));
}

export const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function buildVillageGraph(v: Village): VillageGraph {
  const { gridCols: cols, gridRows: rows, types } = v;
  const total = cols * rows;
  const spawnIndex = v.spawn.y * cols + v.spawn.x;

  const bfs = (passable: (i: number) => boolean) => {
    const d = new Int32Array(total).fill(-1);
    const queue: number[] = [spawnIndex];
    d[spawnIndex] = 0;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (d[ni] !== -1 || !passable(ni)) continue;
        d[ni] = d[cur] + 1;
        queue.push(ni);
      }
    }
    return d;
  };

  // --- walkable connectivity from the spawn (streets + outline ring) ---
  const dist = bfs((i) => isWalkable(types[i]));

  // --- unlock order: BFS over every inside cell, so paint follows the land ---
  const landDist = bfs((i) => types[i] !== CELL.OUTSIDE);
  let maxLand = 1;
  for (let i = 0; i < total; i++) if (landDist[i] > maxLand) maxLand = landDist[i];
  const unlockRank = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    unlockRank[i] = landDist[i] === -1 ? 1 : landDist[i] / maxLand;
  }

  // --- multi-source BFS from outside cells -> depth into the island ---
  const edgeDepth = new Int32Array(total).fill(-1);
  const q2: number[] = [];
  for (let i = 0; i < total; i++) {
    if (types[i] !== CELL.OUTSIDE) continue;
    edgeDepth[i] = 0;
    q2.push(i);
  }
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

  const { heartX, heartZ } = buildHeartTargets(v, cx, cz);

  return {
    cols,
    rows,
    spawnIndex,
    dist,
    edgeDepth,
    unlockRank,
    unlockPerCell: 1 / maxLand,
    heartX,
    heartZ,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Heart mapping. Every inside cell gets a spot inside a heart of (roughly) the
// same area, centred on the island. Rows of the island map to rows of the
// heart by cumulative cell count (equal-area), spread continuously along each
// heart row's spans, so blocks travel coherently and don't pile up.
// ---------------------------------------------------------------------------

function heartInside(x: number, y: number) {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

type Span = { start: number; len: number };

function rasterHeart(scale: number) {
  const r = Math.ceil(1.4 * scale);
  const rows: { j: number; spans: Span[]; count: number }[] = [];
  let total = 0;
  for (let j = -r; j <= r; j++) {
    const spans: Span[] = [];
    let run = -1;
    for (let i = -r; i <= r + 1; i++) {
      const inside = i <= r && heartInside(i / scale, j / scale);
      if (inside && run === -1) run = i;
      if (!inside && run !== -1) {
        spans.push({ start: run, len: i - run });
        run = -1;
      }
    }
    if (spans.length) {
      const count = spans.reduce((s, sp) => s + sp.len, 0);
      rows.push({ j, spans, count });
      total += count;
    }
  }
  return { rows, total };
}

function buildHeartTargets(v: Village, cx: number, cz: number) {
  const { gridCols: cols, gridRows: rows, types } = v;
  const total = cols * rows;
  const heartX = new Float32Array(total);
  const heartZ = new Float32Array(total);

  // island rows, south -> north, each west -> east
  const islandRows: number[][] = [];
  let islandCount = 0;
  for (let gy = 0; gy < rows; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx;
      if (types[i] !== CELL.OUTSIDE) row.push(i);
    }
    if (row.length) {
      islandRows.push(row);
      islandCount += row.length;
    }
  }
  if (!islandCount) return { heartX, heartZ };

  // scale the heart until it holds about as many cells as the island
  let lo = 4;
  let hi = 80;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (rasterHeart(mid).total < islandCount) lo = mid;
    else hi = mid;
  }
  const heart = rasterHeart((lo + hi) / 2);
  const hRows = heart.rows;
  // cumulative fraction at the middle of each heart row
  const hMid: number[] = [];
  let acc = 0;
  for (const hr of hRows) {
    hMid.push((acc + hr.count / 2) / heart.total);
    acc += hr.count;
  }

  let before = 0;
  for (const row of islandRows) {
    const f = (before + row.length / 2) / islandCount;
    before += row.length;

    // continuous heart-row position for this island row
    let b = 0;
    while (b < hRows.length - 2 && hMid[b + 1] <= f) b++;
    const span = Math.max(1e-6, hMid[b + 1] - hMid[b]);
    const frac = Math.min(1, Math.max(0, (f - hMid[b]) / span));
    const jCont = hRows[b].j + frac * (hRows[b + 1].j - hRows[b].j);
    const useRow = frac < 0.5 ? hRows[b] : hRows[b + 1];

    const L = useRow.count;
    for (let p = 0; p < row.length; p++) {
      const q = ((p + 0.5) / row.length) * L;
      let along = q;
      let sp = useRow.spans[0];
      for (const s of useRow.spans) {
        sp = s;
        if (along <= s.len) break;
        along -= s.len;
      }
      const xh = sp.start - 0.5 + along;
      const i = row[p];
      heartX[i] = cx + xh;
      heartZ[i] = cz - jCont;
    }
  }
  return { heartX, heartZ };
}
