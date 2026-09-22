// Generates the voxel grid for the isometric Zimbabwe "village": which
// cells are streets, building plots, plazas, or the outline ring that
// villagers walk out to. Reuses the same country boundary as the particle
// mosaic (scripts/data/zwe.geojson) so both sections agree on the shape.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRID_COLS = 72;
const STREET_SPACING = 5; // every Nth row/col is a street
const EDGE_RING_CELLS = 1.15; // ring thickness, in cells, reserved for the outline
const PLAZA_CHANCE = 0.12; // fraction of building plots left as open plazas
const MAX_HEIGHT = 6;

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(x, y, rings[k])) return false;
  }
  return true;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby || 1e-12;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / lenSq));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

function distToPolygonBoundary(x, y, polygons) {
  let best = Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distToSegment(x, y, ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// ---------- load + project boundary ----------

const geo = JSON.parse(readFileSync(path.join(__dirname, "data/zwe.geojson"), "utf8"));
const geom = geo.features[0].geometry;
const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;

let sumLat = 0, n = 0;
for (const poly of polygons) for (const ring of poly) for (const [, lat] of ring) { sumLat += lat; n++; }
const latCenter = sumLat / n;
const cosLat = Math.cos((latCenter * Math.PI) / 180);

const projPolygons = polygons.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => [lon * cosLat, lat])));

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const poly of projPolygons)
  for (const ring of poly)
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

const bboxW = maxX - minX;
const bboxH = maxY - minY;
const cellWorld = bboxW / GRID_COLS; // projected units per grid cell
const gridRows = Math.max(1, Math.round(GRID_COLS * (bboxH / bboxW)));

// ---------- classify cells ----------

const TYPE = { OUTSIDE: 0, STREET: 1, EDGE: 2, BUILDING: 3, PLAZA: 4 };

const rand = mulberry32(20261003);
const total = GRID_COLS * gridRows;
const types = new Array(total).fill(TYPE.OUTSIDE);
const heights = new Array(total).fill(0);
const colorSeed = new Array(total).fill(0);
const rawEdgeDist = new Array(total).fill(0);

let maxEdgeDist = 1e-9;

for (let gy = 0; gy < gridRows; gy++) {
  for (let gx = 0; gx < GRID_COLS; gx++) {
    const idx = gy * GRID_COLS + gx;
    const wx = minX + (gx + 0.5) * cellWorld;
    const wy = minY + (gy + 0.5) * cellWorld;
    let inside = false;
    for (const poly of projPolygons) {
      if (pointInPolygon(wx, wy, poly)) {
        inside = true;
        break;
      }
    }
    if (!inside) continue;

    const d = distToPolygonBoundary(wx, wy, projPolygons);
    rawEdgeDist[idx] = d;
    if (d > maxEdgeDist) maxEdgeDist = d;

    if (d < EDGE_RING_CELLS * cellWorld) {
      types[idx] = TYPE.EDGE;
      continue;
    }
    if (gx % STREET_SPACING === 0 || gy % STREET_SPACING === 0) {
      types[idx] = TYPE.STREET;
      continue;
    }
    if (rand() < PLAZA_CHANCE) {
      types[idx] = TYPE.PLAZA;
      continue;
    }
    types[idx] = TYPE.BUILDING;
    const depth01 = Math.min(1, d / maxEdgeDist); // provisional; refined below
    heights[idx] = depth01; // stash, rescaled to integer height after maxEdgeDist is final
    colorSeed[idx] = rand();
  }
}

// second pass: now that maxEdgeDist is final, turn the stashed depth into an
// integer voxel height (taller toward the interior, tapering near the coast)
for (let i = 0; i < total; i++) {
  if (types[i] !== TYPE.BUILDING) continue;
  const depth01 = Math.min(1, rawEdgeDist[i] / maxEdgeDist);
  const jitter = (rand() - 0.5) * 1.4;
  heights[i] = Math.max(1, Math.min(MAX_HEIGHT, Math.round(1 + depth01 * (MAX_HEIGHT - 1) + jitter)));
}

// ---------- pick a spawn cell: the most interior street cell ----------

let spawnIdx = -1;
let bestDepth = -1;
for (let i = 0; i < total; i++) {
  if (types[i] === TYPE.STREET && rawEdgeDist[i] > bestDepth) {
    bestDepth = rawEdgeDist[i];
    spawnIdx = i;
  }
}
if (spawnIdx === -1) {
  // fallback: convert the deepest interior cell of any walkable-adjacent type to a street
  for (let i = 0; i < total; i++) {
    if (types[i] !== TYPE.OUTSIDE && types[i] !== TYPE.EDGE && rawEdgeDist[i] > bestDepth) {
      bestDepth = rawEdgeDist[i];
      spawnIdx = i;
    }
  }
  types[spawnIdx] = TYPE.STREET;
}
const spawn = { x: spawnIdx % GRID_COLS, y: Math.floor(spawnIdx / GRID_COLS) };

// ---------- carve a town square around the spawn ----------
// Villagers drop in here, so it must be open ground rather than hemmed in by
// the tallest buildings in the city. One cell just north of the spawn stays a
// building plot: the display puts its landmark stone tower there.
const SQUARE_RADIUS = 3;
const landmarkIdx = (spawn.y + 1) * GRID_COLS + spawn.x;
for (let dy = -SQUARE_RADIUS; dy <= SQUARE_RADIUS; dy++) {
  for (let dx = -SQUARE_RADIUS; dx <= SQUARE_RADIUS; dx++) {
    const gx = spawn.x + dx;
    const gy = spawn.y + dy;
    if (gx < 0 || gy < 0 || gx >= GRID_COLS || gy >= gridRows) continue;
    const idx = gy * GRID_COLS + gx;
    if (types[idx] === TYPE.OUTSIDE || types[idx] === TYPE.EDGE) continue;
    if (idx === landmarkIdx) {
      types[idx] = TYPE.BUILDING;
      heights[idx] = 1;
      continue;
    }
    types[idx] = TYPE.STREET;
    heights[idx] = 0;
    colorSeed[idx] = 0;
  }
}

// ---------- write output ----------

const outDir = path.join(__dirname, "..", "public", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "village.json"),
  JSON.stringify({
    gridCols: GRID_COLS,
    gridRows,
    spawn,
    types,
    heights,
    colorSeed,
  })
);

const counts = { street: 0, edge: 0, building: 0, plaza: 0 };
for (const t of types) {
  if (t === TYPE.STREET) counts.street++;
  else if (t === TYPE.EDGE) counts.edge++;
  else if (t === TYPE.BUILDING) counts.building++;
  else if (t === TYPE.PLAZA) counts.plaza++;
}
console.log(
  `Wrote ${GRID_COLS}x${gridRows} village grid — ${counts.building} buildings, ${counts.street} street cells, ${counts.edge} outline cells, ${counts.plaza} plazas. Spawn at (${spawn.x}, ${spawn.y}).`
);
