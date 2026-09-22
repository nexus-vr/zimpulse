// Generates matched-count point clouds for the "map of Zimbabwe" and "heart"
// formations used by the particle mosaic. Output is consumed at runtime by
// the client — no network access needed once this has been run.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PARTICLE_COUNT = 7200;
const TARGET_SPAN = 2.6; // world units for the larger dimension of each formation
const EDGE_BAND = 0.4; // fraction of the shape's "inradius" given to the dark outline

// ---------- helpers ----------

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
    if (pointInRing(x, y, rings[k])) return false; // inside a hole
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

// deterministic PRNG so re-runs are stable
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

function normalizationFor(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = TARGET_SPAN / span;
  return { cx, cy, scale };
}

function applyNormalization(points, { cx, cy, scale }) {
  return points.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
}

// raw per-point boundary-distance values -> normalized [0,1] "depth", where 0
// sits on the outline and 1 is reached a fraction (EDGE_BAND) of the way to
// the most-interior point, so the outline reads as a defined dark band.
function depthsFromRaw(raw) {
  const max = Math.max(...raw, 1e-9);
  return raw.map((d) => Math.min(1, d / max / EDGE_BAND));
}

// ---------- Zimbabwe map sampling ----------

function buildMapPoints(count) {
  const geo = JSON.parse(
    readFileSync(path.join(__dirname, "data/zwe.geojson"), "utf8")
  );
  const feature = geo.features[0];
  const geom = feature.geometry;
  const polygons =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates; // MultiPolygon safety

  // project lon/lat -> planar xy correcting longitude for latitude compression
  let sumLat = 0, n = 0;
  for (const poly of polygons) for (const ring of poly) for (const [, lat] of ring) { sumLat += lat; n++; }
  const latCenter = sumLat / n;
  const cos = Math.cos((latCenter * Math.PI) / 180);

  const projPolygons = polygons.map((poly) =>
    poly.map((ring) => ring.map(([lon, lat]) => [lon * cos, lat]))
  );

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of projPolygons)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

  const rand = mulberry32(1337);
  const collected = [];

  // jittered-grid sampling inside the polygon, oversampling then trimming,
  // so the interior reads as an even mosaic rather than a random speckle.
  let resolution = 140;
  while (collected.length < count * 1.15 && resolution < 900) {
    collected.length = 0;
    const stepX = (maxX - minX) / resolution;
    const stepY = (maxY - minY) / resolution;
    for (let gy = 0; gy <= resolution; gy++) {
      for (let gx = 0; gx <= resolution; gx++) {
        const jitterX = (rand() - 0.5) * stepX * 0.85;
        const jitterY = (rand() - 0.5) * stepY * 0.85;
        const x = minX + gx * stepX + jitterX;
        const y = minY + gy * stepY + jitterY;
        for (const poly of projPolygons) {
          if (pointInPolygon(x, y, poly)) {
            collected.push([x, y]);
            break;
          }
        }
      }
    }
    resolution = Math.ceil(resolution * 1.25);
  }

  // shuffle then trim/pad to exact count
  for (let i = collected.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [collected[i], collected[j]] = [collected[j], collected[i]];
  }
  let pts = collected.slice(0, count);
  while (pts.length < count) {
    pts.push(pts[Math.floor(rand() * pts.length)]);
  }

  const norm = normalizationFor(pts);
  const rawDepth = pts.map(([x, y]) => distToPolygonBoundary(x, y, projPolygons) * norm.scale);
  return { points: applyNormalization(pts, norm), depth: depthsFromRaw(rawDepth) };
}

// ---------- heart sampling ----------

function buildHeartPoints(count) {
  const rand = mulberry32(2027);
  const pts = [];

  // implicit heart region: (x^2+y^2-1)^3 - x^2*y^3 <= 0. With y pointing up,
  // this already sits point-down (the classic heart glyph orientation).
  const heartF = (x, y) => Math.pow(x * x + y * y - 1, 3) - x * x * Math.pow(y, 3);

  let attempts = 0;
  while (pts.length < count && attempts < count * 200) {
    attempts++;
    const x = (rand() * 2 - 1) * 1.4;
    const y = (rand() * 2 - 1) * 1.3;
    if (heartF(x, y) <= 0) pts.push([x, y]);
  }
  while (pts.length < count) pts.push(pts[Math.floor(rand() * pts.length)]);

  const norm = normalizationFor(pts);
  // |f| isn't a true Euclidean distance, but it's 0 on the boundary and grows
  // smoothly and monotonically toward the interior — good enough as a depth proxy.
  const rawDepth = pts.map(([x, y]) => Math.abs(heartF(x, y)));
  return { points: applyNormalization(pts, norm), depth: depthsFromRaw(rawDepth) };
}

// ---------- write output ----------

function withZ(points, seed) {
  const rand = mulberry32(seed);
  return points.map(([x, y]) => [x, y, (rand() - 0.5) * 0.12]);
}

const mapResult = buildMapPoints(PARTICLE_COUNT);
const heartResult = buildHeartPoints(PARTICLE_COUNT);
const mapPoints = withZ(mapResult.points, 7);
const heartPoints = withZ(heartResult.points, 9);

const outDir = path.join(__dirname, "..", "public", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "formations.json"),
  JSON.stringify({
    count: PARTICLE_COUNT,
    map: mapPoints,
    heart: heartPoints,
    mapDepth: mapResult.depth,
    heartDepth: heartResult.depth,
  })
);

console.log(`Wrote ${PARTICLE_COUNT} matched points (with edge depth) for map + heart formations.`);
