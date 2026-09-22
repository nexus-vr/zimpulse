"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  CELL,
  buildVillageGraph,
  cellToWorld,
  loadVillage,
  type Village,
  type VillageGraph,
} from "@/lib/village";
import { MAX_VILLAGERS, VillagerSystem } from "@/lib/villagers";
import { mulberry32 } from "@/lib/prng";

const BACKGROUND = "#FFD400";

// ---------------------------------------------------------------------------
// Palette. Warm sandstone/terracotta walls (a nod to Great Zimbabwe's stone),
// roofs and parks in the app's bottle-green family plus the flag gold.
// ---------------------------------------------------------------------------
const WALL_COLORS = [
  "#f1e3c6", "#dcab6f", "#cd7a42", "#bb593b", "#e3bb6d", "#a97d5c",
  "#f5ecd9", "#d2925c", "#0E8C5C", "#ebcaa2", "#c9a27a", "#e6d2b0",
];
const ROOF_COLORS = ["#095D3E", "#e8b23c", "#8a3b22", "#2f6f4e", "#c2552f", "#0E8C5C", "#d99a2b"];
const LEAF_COLORS = ["#0E8C5C", "#0b7a4e", "#14b87c", "#2f9e5a", "#095D3E"];
const GROUND = {
  street: "#e4cb9f",
  square: "#d9b98a", // paved town square around the spawn point
  edge: "#a97f4c",
  building: "#a08662",
  plaza: "#55b06e",
};
const DIRT = "#8f5b35";
const HEIGHT_SCALE = 0.5; // world units per storey; keeps towers from hiding the streets behind them
const STONE = "#9a8f82";
const TRUNK = "#5a3b26";

// ---------------------------------------------------------------------------
// Terrain: every voxel is an instance of one unit cube. Built once, purely
// from the grid + a seeded PRNG (React Compiler friendly), then handed to r3f
// as <primitive> objects.
// ---------------------------------------------------------------------------
type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color: THREE.Color };

function item(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color): Item {
  return { x, y, z, sx, sy, sz, color: color.clone() };
}

function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: Item[],
  shadows: { cast: boolean; receive: boolean }
) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(items.length, 1));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    p.set(it.x, it.y + it.sy / 2, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, it.color);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows.cast;
  mesh.receiveShadow = shadows.receive;
  mesh.frustumCulled = false;
  return mesh;
}

function buildTerrain(village: Village, graph: VillageGraph) {
  const { gridCols: cols, gridRows: rows, types, heights, colorSeed } = village;
  const rand = mulberry32(8675309);
  const c = new THREE.Color();
  const vary = (hex: string, hue: number, light: number) => {
    c.set(hex);
    c.offsetHSL((rand() - 0.5) * hue, (rand() - 0.5) * 0.05, (rand() - 0.5) * light);
    return c;
  };

  const dirt: Item[] = [];
  const tiles: Item[] = [];
  const walls: Item[] = [];
  const roofs: Item[] = [];
  const darkWindows: Item[] = [];
  const litWindows: Item[] = [];
  const trunks: Item[] = [];
  const leaves: Item[] = [];
  const stones: Item[] = [];

  // A small dry-stone tower beside the spawn point marks where villagers
  // appear (a quiet nod to Great Zimbabwe's conical tower).
  let landmark = -1;
  {
    const sx = village.spawn.x;
    const sy = village.spawn.y;
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const i = ny * cols + nx;
        const d = Math.abs(dx) + Math.abs(dy);
        if (types[i] === CELL.BUILDING && d < best) {
          best = d;
          landmark = i;
        }
      }
    }
  }

  let maxDepth = 1;
  for (let i = 0; i < cols * rows; i++) if (graph.edgeDepth[i] > maxDepth) maxDepth = graph.edgeDepth[i];

  for (let i = 0; i < cols * rows; i++) {
    const t = types[i];
    if (t === CELL.OUTSIDE) continue;
    const [wx, wz] = cellToWorld(cols, rows, i);

    // --- floating-island underside: rugged dirt columns, deeper inland ---
    const depth01 = Math.min(1, graph.edgeDepth[i] / (maxDepth * 0.6));
    const d = 1.4 + depth01 * 3.2 + rand() * 0.9;
    c.set(DIRT);
    c.offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.08 - depth01 * 0.08);
    dirt.push(item(wx, -d, wz, 1, d - 0.5, 1, c));

    // --- surface tile ---
    const gx = i % cols;
    const gy = (i - gx) / cols;
    const inSquare = Math.max(Math.abs(gx - village.spawn.x), Math.abs(gy - village.spawn.y)) <= 3;
    const groundHex =
      t === CELL.STREET
        ? inSquare
          ? GROUND.square
          : GROUND.street
        : t === CELL.EDGE
          ? GROUND.edge
          : t === CELL.PLAZA
            ? GROUND.plaza
            : GROUND.building;
    tiles.push(item(wx, -0.5, wz, 1, 0.5, 1, vary(groundHex, 0.01, t === CELL.PLAZA ? 0.05 : 0.035)));

    if (t === CELL.PLAZA) {
      // a little park: one or two blocky trees
      const trees = rand() < 0.35 ? 2 : 1;
      for (let k = 0; k < trees; k++) {
        const ox = trees === 1 ? (rand() - 0.5) * 0.3 : (k === 0 ? -0.24 : 0.24) + (rand() - 0.5) * 0.1;
        const oz = trees === 1 ? (rand() - 0.5) * 0.3 : (k === 0 ? 0.2 : -0.2) + (rand() - 0.5) * 0.1;
        const scale = trees === 1 ? 0.85 + rand() * 0.35 : 0.6 + rand() * 0.25;
        const trunkH = 0.45 * scale;
        trunks.push(item(wx + ox, 0, wz + oz, 0.16 * scale, trunkH, 0.16 * scale, vary(TRUNK, 0.01, 0.06)));
        const leaf = LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)];
        const a = 0.72 * scale;
        leaves.push(item(wx + ox, trunkH, wz + oz, a, a, a, vary(leaf, 0.02, 0.06)));
        const b = 0.42 * scale;
        leaves.push(item(wx + ox, trunkH + a - 0.02, wz + oz, b, b, b, vary(leaf, 0.02, 0.06)));
      }
      continue;
    }

    if (t !== CELL.BUILDING) continue;

    if (i === landmark) {
      const tiers = [
        [0.98, 1.1],
        [0.84, 1.0],
        [0.7, 1.0],
        [0.56, 0.9],
        [0.42, 0.8],
        [0.28, 0.5],
      ];
      let y = 0;
      for (const [w, h] of tiers) {
        stones.push(item(wx, y, wz, w, h, w, vary(STONE, 0.01, 0.07)));
        y += h;
      }
      continue;
    }

    // --- building ---
    const storeys = heights[i];
    const h = storeys * HEIGHT_SCALE;
    const seed = colorSeed[i];
    const wallHex = WALL_COLORS[Math.floor(seed * WALL_COLORS.length) % WALL_COLORS.length];
    const roofHex = ROOF_COLORS[Math.floor(((seed * 13.37) % 1) * ROOF_COLORS.length) % ROOF_COLORS.length];
    const fp = 0.82; // footprint, leaving alleys between neighbours
    const wall = vary(wallHex, 0.012, 0.06).clone();
    walls.push(item(wx, 0, wz, fp, h, fp, wall));

    // roof slab with a slight overhang
    roofs.push(item(wx, h, wz, fp + 0.1, 0.16, fp + 0.1, vary(roofHex, 0.01, 0.05)));

    // rooftop detail on taller buildings: a stair-head / water tank block
    if (storeys >= 3 && (seed * 5.1) % 1 > 0.5) {
      const pw = 0.4;
      const ph = 0.4 + rand() * 0.4;
      const px = (rand() - 0.5) * 0.3;
      const pz = (rand() - 0.5) * 0.3;
      c.copy(wall).offsetHSL(0, 0, -0.06);
      walls.push(item(wx + px, h + 0.16, wz + pz, pw, ph, pw, c));
    }

    // windows on the two camera-facing faces (+x east, +z south), one per floor
    for (let f = 0; f < storeys; f++) {
      const wy = f * HEIGHT_SCALE + 0.13;
      const isDoor = f === 0;
      const litColor = rand() < 0.65;
      const winA = litColor ? litWindows : darkWindows;
      c.set(litColor ? (rand() < 0.5 ? "#ffe6a6" : "#ffd27a") : "#1d3b34");
      winA.push(item(wx + fp / 2 + 0.01, wy, wz + (rand() - 0.5) * 0.25, 0.04, 0.28, 0.26, c));

      if (isDoor) {
        c.set("#3d2a1a");
        darkWindows.push(item(wx + (rand() - 0.5) * 0.2, 0, wz + fp / 2 + 0.01, 0.28, 0.5, 0.04, c));
      } else {
        const lit2 = rand() < 0.65;
        c.set(lit2 ? (rand() < 0.5 ? "#ffe6a6" : "#ffd27a") : "#1d3b34");
        (lit2 ? litWindows : darkWindows).push(
          item(wx + (rand() - 0.5) * 0.25, wy, wz + fp / 2 + 0.01, 0.26, 0.28, 0.04, c)
        );
      }
    }
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const lambert = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const glow = new THREE.MeshBasicMaterial({ color: "#ffffff" });

  const meshes = [
    makeInstanced(unit, lambert, dirt, { cast: false, receive: false }),
    makeInstanced(unit, lambert, tiles, { cast: false, receive: true }),
    makeInstanced(unit, lambert, walls, { cast: true, receive: true }),
    makeInstanced(unit, lambert, roofs, { cast: true, receive: true }),
    makeInstanced(unit, lambert, darkWindows, { cast: false, receive: false }),
    makeInstanced(unit, glow, litWindows, { cast: false, receive: false }),
    makeInstanced(unit, lambert, trunks, { cast: true, receive: false }),
    makeInstanced(unit, lambert, leaves, { cast: true, receive: true }),
    makeInstanced(unit, lambert, stones, { cast: true, receive: true }),
  ];

  const dispose = () => {
    meshes.forEach((m) => m.dispose());
    unit.dispose();
    lambert.dispose();
    glow.dispose();
  };
  return { meshes, dispose };
}

function Terrain({ village, graph }: { village: Village; graph: VillageGraph }) {
  const terrain = useMemo(() => buildTerrain(village, graph), [village, graph]);
  useEffect(() => () => terrain.dispose(), [terrain]);
  return (
    <>
      {terrain.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Villagers: Minecraft-proportioned figures (8px head, 12px torso/limbs on a
// 32px body). Each body part is one InstancedMesh with MAX_VILLAGERS slots;
// every frame we compose root * pivot * swing for the active villagers only.
// ---------------------------------------------------------------------------
const PX = 2.1 / 32; // world units per "pixel"; figures are toy-scale (~2 blocks tall) so the border of people reads from across the room

type PartSpec = {
  size: [number, number, number];
  offset: [number, number, number]; // geometry offset from the pivot, in px
  pivot: [number, number, number]; // pivot in body space, in px
  swing: number; // multiplier on the walk-cycle swing angle
  color: "shirt" | "pants" | "skin" | "hair" | "eye";
};

const PART_SPECS: PartSpec[] = [
  { size: [4, 12, 4], offset: [0, -6, 0], pivot: [-2, 12, 0], swing: 1, color: "pants" },
  { size: [4, 12, 4], offset: [0, -6, 0], pivot: [2, 12, 0], swing: -1, color: "pants" },
  { size: [4, 12, 4], offset: [0, -5.5, 0], pivot: [-6, 23.5, 0], swing: -0.8, color: "shirt" },
  { size: [4, 12, 4], offset: [0, -5.5, 0], pivot: [6, 23.5, 0], swing: 0.8, color: "shirt" },
  { size: [8, 12, 4], offset: [0, 6, 0], pivot: [0, 12, 0], swing: 0, color: "shirt" },
  { size: [8, 8, 8], offset: [0, 4, 0], pivot: [0, 24, 0], swing: 0, color: "skin" },
  { size: [8.8, 2.6, 8.8], offset: [0, 1.3, 0], pivot: [0, 31.4, 0], swing: 0, color: "hair" },
  { size: [1.7, 1.7, 1], offset: [0, 0, 0], pivot: [-1.9, 29, 4.2], swing: 0, color: "eye" },
  { size: [1.7, 1.7, 1], offset: [0, 0, 0], pivot: [1.9, 29, 4.2], swing: 0, color: "eye" },
];

const EYE_COLOR = 0x1a1410;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function Villagers({ graph, count, connected }: { graph: VillageGraph; count: number; connected: boolean }) {
  const system = useMemo(() => new VillagerSystem(graph), [graph]);
  const hydrated = useRef(false);
  const coloured = useRef(0);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  const parts = useMemo(() => {
    const material = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const geometries = PART_SPECS.map((p) => {
      const g = new THREE.BoxGeometry(p.size[0] * PX, p.size[1] * PX, p.size[2] * PX);
      g.translate(p.offset[0] * PX, p.offset[1] * PX, p.offset[2] * PX);
      return g;
    });
    return { material, geometries };
  }, []);
  useEffect(
    () => () => {
      parts.material.dispose();
      parts.geometries.forEach((g) => g.dispose());
    },
    [parts]
  );

  // Keep the village in step with the shared heartbeat count. The first sync
  // after connecting seats existing guests directly on the outline (so a page
  // refresh mid-event doesn't empty the border); every later increment walks
  // a new villager out from the spawn point. A reset (count drops) clears all.
  useEffect(() => {
    if (!connected && !hydrated.current) return;
    const instant = !hydrated.current;
    hydrated.current = true;
    if (count < system.total) system.reset();
    while (system.total < count && system.spawn(instant)) {
      // keep spawning until we've caught up or the ring is full
    }
  }, [count, connected, system]);

  useFrame((state, delta) => {
    const now = state.clock.getElapsedTime();
    system.update(now, Math.min(delta, 0.1));
    const villagers = system.villagers;
    const meshes = meshRefs.current;

    // colours only change when villagers are added/removed
    if (villagers.length < coloured.current) coloured.current = 0;
    if (coloured.current < villagers.length) {
      const col = new THREE.Color();
      for (let i = coloured.current; i < villagers.length; i++) {
        const v = villagers[i];
        PART_SPECS.forEach((spec, k) => {
          const mesh = meshes[k];
          if (!mesh) return;
          col.setHex(
            spec.color === "shirt"
              ? v.shirt
              : spec.color === "pants"
                ? v.pants
                : spec.color === "skin"
                  ? v.skin
                  : spec.color === "hair"
                    ? v.hair
                    : EYE_COLOR
          );
          mesh.setColorAt(i, col);
        });
      }
      coloured.current = villagers.length;
      meshes.forEach((mesh) => {
        if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }

    const root = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const out = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      const swing = Math.sin(v.phase) * 0.8 * v.walk;
      const bob = ((1 - Math.cos(v.phase * 2)) / 2) * 0.05 * v.walk;
      const idle = Math.sin(now * 1.4 + v.phase) * 0.04 * (1 - v.walk);
      pos.set(v.x, v.y + bob, v.z);
      quat.setFromAxisAngle(Y_AXIS, v.yaw);
      root.compose(pos, quat, ONE);

      for (let k = 0; k < PART_SPECS.length; k++) {
        const mesh = meshes[k];
        if (!mesh) continue;
        const spec = PART_SPECS[k];
        const angle = spec.swing * swing + (spec.color === "shirt" && spec.swing !== 0 ? idle * spec.swing : 0);
        local.makeRotationX(angle);
        local.setPosition(spec.pivot[0] * PX, spec.pivot[1] * PX, spec.pivot[2] * PX);
        out.multiplyMatrices(root, local);
        mesh.setMatrixAt(i, out);
      }
    }
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.count = villagers.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {PART_SPECS.map((_, k) => (
        <instancedMesh
          key={k}
          ref={(el) => {
            meshRefs.current[k] = el;
          }}
          args={[parts.geometries[k], parts.material, MAX_VILLAGERS]}
          count={0}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera: a true orthographic isometric view that auto-fits the island into
// the space right of the heartbeat panel, with a barely-there sway.
// ---------------------------------------------------------------------------
const BASE_AZIMUTH = 0.55; // radians east of due south
const BASE_ELEVATION = 0.98; // radians above the horizon (steep enough that streets read between blocks)
const PANEL_RESERVE_PX = 472; // HeartbeatPanel (w-96) + its left margin + breathing room
const TOP_RESERVE_PX = 150; // title / counter / badge row
const CAMERA_DISTANCE = 300;

function CameraRig({ village }: { village: Village }) {
  const camRef = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((s) => s.size);

  // The island's real footprint (not its bounding box, whose empty corners
  // would waste a third of the screen) projected onto the camera's right/up axes.
  const fit = useMemo(() => {
    const dir = new THREE.Vector3(
      Math.sin(BASE_AZIMUTH) * Math.cos(BASE_ELEVATION),
      Math.sin(BASE_ELEVATION),
      Math.cos(BASE_AZIMUTH) * Math.cos(BASE_ELEVATION)
    );
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, Y_AXIS).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    let lo = Infinity, hi = -Infinity, bottom = Infinity, top = -Infinity;
    const p = new THREE.Vector3();
    const { gridCols: cols, gridRows: rows, types, heights } = village;
    for (let i = 0; i < cols * rows; i++) {
      if (types[i] === CELL.OUTSIDE) continue;
      const [wx, wz] = cellToWorld(cols, rows, i);
      const yTop = heights[i] * HEIGHT_SCALE + 1.2;
      for (const x of [wx - 0.5, wx + 0.5])
        for (const y of [-6.5, yTop])
          for (const z of [wz - 0.5, wz + 0.5]) {
            p.set(x, y, z);
            const px = p.dot(right);
            const py = p.dot(up);
            if (px < lo) lo = px;
            if (px > hi) hi = px;
            if (py < bottom) bottom = py;
            if (py > top) top = py;
          }
    }
    return { cx: (lo + hi) / 2, cy: (bottom + top) / 2, w: hi - lo, h: top - bottom };
  }, [village]);

  useFrame(({ clock }) => {
    const cam = camRef.current;
    if (!cam) return;
    const t = clock.getElapsedTime();
    const az = BASE_AZIMUTH + Math.sin(t * 0.07) * 0.05;
    const el = BASE_ELEVATION + Math.sin(t * 0.05) * 0.012;
    cam.position.set(
      Math.sin(az) * Math.cos(el) * CAMERA_DISTANCE,
      Math.sin(el) * CAMERA_DISTANCE,
      Math.cos(az) * Math.cos(el) * CAMERA_DISTANCE
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);

    const W = size.width;
    const H = size.height;
    const panel = W >= 900 ? PANEL_RESERVE_PX : 0;
    const topBar = H >= 500 ? TOP_RESERVE_PX : 0;
    const availW = Math.max(200, W - panel - 48);
    const availH = Math.max(200, H - topBar - 48);
    const zoom = Math.min(availW / fit.w, availH / fit.h);
    const halfW = W / (2 * zoom);
    const halfH = H / (2 * zoom);
    const ccx = fit.cx - panel / (2 * zoom);
    const ccy = fit.cy + topBar / (2 * zoom);
    cam.left = ccx - halfW;
    cam.right = ccx + halfW;
    cam.top = ccy + halfH;
    cam.bottom = ccy - halfH;
    cam.zoom = 1;
    cam.updateProjectionMatrix();
  });

  return <OrthographicCamera ref={camRef} makeDefault manual near={1} far={800} position={[100, 100, 100]} />;
}

function Lights() {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const sun = sunRef.current;
    if (!sun) return;
    const cam = sun.shadow.camera;
    cam.left = -62;
    cam.right = 62;
    cam.top = 62;
    cam.bottom = -62;
    cam.near = 20;
    cam.far = 260;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
  }, []);
  return (
    <>
      <hemisphereLight args={["#fff6d8", "#a86a3c", 0.5]} />
      <directionalLight ref={sunRef} position={[-40, 85, 55]} intensity={0.9} color="#fff3dc" castShadow />
      <directionalLight position={[60, 30, 10]} intensity={0.22} color="#ffe9c0" />
    </>
  );
}

function VillageScene({ village, count, connected }: { village: Village; count: number; connected: boolean }) {
  const graph = useMemo(() => buildVillageGraph(village), [village]);
  return (
    <>
      <CameraRig village={village} />
      <Lights />
      <Terrain village={village} graph={graph} />
      <Villagers graph={graph} count={count} connected={connected} />
    </>
  );
}

export function VoxelVillage({ count, connected }: { count: number; connected: boolean }) {
  const [village, setVillage] = useState<Village | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadVillage().then((v) => {
      if (!cancelled) setVillage(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      flat
      gl={{ antialias: true, powerPreference: "high-performance" }}
      className="!absolute inset-0"
    >
      <color attach="background" args={[BACKGROUND]} />
      {village && <VillageScene village={village} count={count} connected={connected} />}
    </Canvas>
  );
}
