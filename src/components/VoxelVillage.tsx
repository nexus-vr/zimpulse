"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  CELL,
  DEFAULT_FULL_COLOR_COUNT,
  buildVillageGraph,
  cellToWorld,
  colorRadiusFor,
  loadVillage,
  type Village,
  type VillageGraph,
} from "@/lib/village";
import { MAX_VILLAGERS, VillagerSystem } from "@/lib/villagers";
import { FX_ATTRIBUTES, VillageFx, augmentVillageMaterial } from "@/lib/villageFx";
import { mulberry32 } from "@/lib/prng";

const BACKGROUND = "#FFD400";

// ---------------------------------------------------------------------------
// Palette. Warm sandstone/terracotta walls (a nod to Great Zimbabwe's stone),
// roofs and parks in the app's bottle-green family plus the flag gold.
// ---------------------------------------------------------------------------
const WALL_COLORS = [
  "#f1e3c6", "#dcab6f", "#cd7a42", "#bb593b", "#e3bb6d", "#a97d5c",
  "#f5ecd9", "#d2925c", "#0E8C5C", "#ebcaa2", "#c9a27a", "#e6d2b0",
  "#b8433a", "#7c9a6d", "#d9c7a3", "#c46a3a",
];
const ROOF_COLORS = ["#095D3E", "#e8b23c", "#8a3b22", "#2f6f4e", "#c2552f", "#0E8C5C", "#d99a2b", "#5b4436"];
const LEAF_COLORS = ["#0E8C5C", "#0b7a4e", "#14b87c", "#2f9e5a", "#095D3E", "#6fae3e"];
const GROUND = {
  street: "#e4cb9f",
  square: "#d9b98a", // paved town square around the spawn point
  edge: "#a97f4c",
  building: "#a08662",
  plaza: "#55b06e",
  farm: "#8c6a3d",
  market: "#dcc59b",
};
const DIRT = "#8f5b35";
const WATER = "#3aa6c9";
const THATCH = "#c9a45c";
const HEIGHT_SCALE = 0.5; // world units per storey; keeps towers from hiding the streets behind them
const STONE = "#9a8f82";
const TRUNK = "#5a3b26";

// ---------------------------------------------------------------------------
// Terrain: every voxel is an instance of a shared unit shape, tagged with the
// grid cell it belongs to so the whole cell (ground, building, windows, trees)
// travels together when the island reassembles as a heart. Built once, purely
// from the grid + a seeded PRNG (React Compiler friendly).
// ---------------------------------------------------------------------------
type Item = {
  cell: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: THREE.Color;
};

type Bucket = { items: Item[]; geometry: THREE.BufferGeometry; lit: boolean; cast: boolean; receive: boolean };

function makeInstanced(bucket: Bucket, graph: VillageGraph, fx: VillageFx, rand: () => number) {
  const { items } = bucket;
  const n = Math.max(items.length, 1);
  const geometry = bucket.geometry.clone();
  const heart = new Float32Array(n * 3);
  const scatter = new Float32Array(n * 3);
  const unlock = new Float32Array(n * 2);

  const material = bucket.lit
    ? new THREE.MeshBasicMaterial({ color: "#ffffff" })
    : new THREE.MeshLambertMaterial({ color: "#ffffff" });
  augmentVillageMaterial(material, fx, true);
  const depth = augmentVillageMaterial(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    fx,
    false
  );

  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    const cy = it.y + it.sy / 2;
    p.set(it.x, cy, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, it.color);

    const [wx, wz] = cellToWorld(graph.cols, graph.rows, it.cell);
    heart[i * 3] = graph.heartX[it.cell] + (it.x - wx);
    heart[i * 3 + 1] = cy;
    heart[i * 3 + 2] = graph.heartZ[it.cell] + (it.z - wz);
    scatter[i * 3] = (rand() - 0.5) * 3;
    scatter[i * 3 + 1] = 1.5 + rand() * 4;
    scatter[i * 3 + 2] = (rand() - 0.5) * 3;
    const rank = graph.unlockRank[it.cell];
    unlock[i * 2] = rank;
    unlock[i * 2 + 1] = Math.min(1, rank + (rand() - 0.5) * 0.06);
  });
  geometry.setAttribute(FX_ATTRIBUTES.heart, new THREE.InstancedBufferAttribute(heart, 3));
  geometry.setAttribute(FX_ATTRIBUTES.scatter, new THREE.InstancedBufferAttribute(scatter, 3));
  geometry.setAttribute(FX_ATTRIBUTES.unlock, new THREE.InstancedBufferAttribute(unlock, 2));

  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = bucket.cast;
  mesh.receiveShadow = bucket.receive;
  mesh.customDepthMaterial = depth;
  mesh.frustumCulled = false;
  return { mesh, dispose: () => { mesh.dispose(); geometry.dispose(); material.dispose(); depth.dispose(); } };
}

function buildTerrain(village: Village, graph: VillageGraph, fx: VillageFx) {
  const { gridCols: cols, gridRows: rows, types, heights, colorSeed } = village;
  const rand = mulberry32(8675309);
  const c = new THREE.Color();
  const vary = (hex: string, hue: number, light: number) => {
    c.set(hex);
    c.offsetHSL((rand() - 0.5) * hue, (rand() - 0.5) * 0.05, (rand() - 0.5) * light);
    return c;
  };

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const cone = new THREE.ConeGeometry(0.5, 1, 8);

  const bucket = (geometry: THREE.BufferGeometry, cast: boolean, receive: boolean, lit = false): Bucket => ({
    items: [],
    geometry,
    lit,
    cast,
    receive,
  });
  const dirt = bucket(unit, false, false);
  const tiles = bucket(unit, false, true);
  const walls = bucket(unit, true, true);
  const roofs = bucket(unit, true, true);
  const darkWindows = bucket(unit, false, false);
  const litWindows = bucket(unit, false, false, true);
  const trunks = bucket(unit, true, false);
  const leaves = bucket(unit, true, true);
  const stones = bucket(unit, true, true);
  const huts = bucket(cylinder, true, true);
  const thatch = bucket(cone, true, true);
  const water = bucket(unit, false, true);

  let cell = 0;
  const put = (b: Bucket, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color) =>
    b.items.push({ cell, x, y, z, sx, sy, sz, color: color.clone() });

  const tree = (x: number, z: number, scale: number) => {
    const trunkH = 0.45 * scale;
    put(trunks, x, 0, z, 0.16 * scale, trunkH, 0.16 * scale, vary(TRUNK, 0.01, 0.06));
    const leaf = LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)];
    const a = 0.72 * scale;
    put(leaves, x, trunkH, z, a, a, a, vary(leaf, 0.02, 0.06));
    const b = 0.42 * scale;
    put(leaves, x, trunkH + a - 0.02, z, b, b, b, vary(leaf, 0.02, 0.06));
  };

  const windowsOn = (wx: number, wz: number, fp: number, storeys: number, narrow: boolean) => {
    const ww = narrow ? 0.18 : 0.26;
    for (let f = 0; f < storeys; f++) {
      const wy = f * HEIGHT_SCALE + 0.13;
      const lit = rand() < 0.65;
      c.set(lit ? (rand() < 0.5 ? "#ffe6a6" : "#ffd27a") : "#1d3b34");
      put(lit ? litWindows : darkWindows, wx + fp / 2 + 0.01, wy, wz + (rand() - 0.5) * 0.25, 0.04, 0.28, ww, c);
      if (f === 0) {
        c.set("#3d2a1a");
        put(darkWindows, wx + (rand() - 0.5) * 0.2, 0, wz + fp / 2 + 0.01, 0.28, 0.5, 0.04, c);
      } else {
        const lit2 = rand() < 0.65;
        c.set(lit2 ? (rand() < 0.5 ? "#ffe6a6" : "#ffd27a") : "#1d3b34");
        put(lit2 ? litWindows : darkWindows, wx + (rand() - 0.5) * 0.25, wy, wz + fp / 2 + 0.01, ww, 0.28, 0.04, c);
      }
    }
  };

  // The landmark: a dry-stone tower on the plot the generator reserved beside
  // the spawn (a quiet nod to Great Zimbabwe's conical tower).
  const landmark = (village.spawn.y + 1) * cols + village.spawn.x;

  let maxDepth = 1;
  for (let i = 0; i < cols * rows; i++) if (graph.edgeDepth[i] > maxDepth) maxDepth = graph.edgeDepth[i];

  for (let i = 0; i < cols * rows; i++) {
    const t = types[i];
    if (t === CELL.OUTSIDE) continue;
    cell = i;
    const [wx, wz] = cellToWorld(cols, rows, i);
    const gx = i % cols;
    const gy = (i - gx) / cols;
    const inSquare = Math.max(Math.abs(gx - village.spawn.x), Math.abs(gy - village.spawn.y)) <= 3;

    // --- floating-island underside: rugged dirt columns, deeper inland ---
    const depth01 = Math.min(1, graph.edgeDepth[i] / (maxDepth * 0.6));
    const d = 1.4 + depth01 * 3.2 + rand() * 0.9;
    c.set(DIRT);
    c.offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.08 - depth01 * 0.08);
    put(dirt, wx, -d, wz, 1, d - 0.5, 1, c);

    if (t === CELL.PLAZA) {
      const kind = rand();
      if (kind < 0.18) {
        // pond: a sunken water tile with a reed and a tree on the bank
        put(tiles, wx, -0.5, wz, 1, 0.5, 1, vary(GROUND.plaza, 0.01, 0.05));
        put(water, wx, -0.1, wz, 0.78, 0.08, 0.78, vary(WATER, 0.02, 0.06));
        c.set("#3d8a3a");
        put(trunks, wx + 0.22, 0, wz - 0.2, 0.05, 0.3, 0.05, c);
        tree(wx - 0.32, wz + 0.3, 0.6);
      } else if (kind < 0.38) {
        // smallholding: rows of crops in alternating greens and gold
        put(tiles, wx, -0.5, wz, 1, 0.5, 1, vary(GROUND.farm, 0.01, 0.04));
        for (let k = 0; k < 3; k++) {
          const crop = k % 2 === 0 ? "#4f9a3a" : rand() < 0.5 ? "#e8b23c" : "#7fbf4a";
          put(leaves, wx, 0, wz - 0.3 + k * 0.3, 0.86, 0.12 + rand() * 0.08, 0.16, vary(crop, 0.03, 0.08));
        }
      } else if (kind < 0.5) {
        // little market: a paved lot with a striped awning stall
        put(tiles, wx, -0.5, wz, 1, 0.5, 1, vary(GROUND.market, 0.01, 0.04));
        c.set("#5a3b26");
        put(trunks, wx - 0.3, 0, wz - 0.25, 0.06, 0.55, 0.06, c);
        put(trunks, wx + 0.3, 0, wz - 0.25, 0.06, 0.55, 0.06, c);
        put(roofs, wx, 0.55, wz - 0.25, 0.86, 0.06, 0.5, vary(rand() < 0.5 ? "#d94f3d" : "#e8b23c", 0.01, 0.04));
        put(walls, wx, 0, wz + 0.15, 0.7, 0.3, 0.3, vary("#c9a27a", 0.01, 0.05));
        if (rand() < 0.6) tree(wx + 0.34, wz + 0.32, 0.55);
      } else {
        // park: one to three blocky trees, sometimes a rock
        put(tiles, wx, -0.5, wz, 1, 0.5, 1, vary(GROUND.plaza, 0.01, 0.05));
        const trees = kind < 0.68 ? 3 : kind < 0.86 ? 2 : 1;
        for (let k = 0; k < trees; k++) {
          const ang = (k / trees) * Math.PI * 2 + rand();
          const rad = trees === 1 ? 0 : 0.26;
          tree(
            wx + Math.cos(ang) * rad + (rand() - 0.5) * 0.08,
            wz + Math.sin(ang) * rad + (rand() - 0.5) * 0.08,
            trees === 1 ? 0.9 + rand() * 0.3 : 0.55 + rand() * 0.25
          );
        }
        if (rand() < 0.3) put(stones, wx + (rand() - 0.5) * 0.5, 0, wz + (rand() - 0.5) * 0.5, 0.18, 0.12, 0.14, vary(STONE, 0.01, 0.08));
      }
      continue;
    }

    // --- surface tile for everything else ---
    const groundHex =
      t === CELL.STREET ? (inSquare ? GROUND.square : GROUND.street) : t === CELL.EDGE ? GROUND.edge : GROUND.building;
    put(tiles, wx, -0.5, wz, 1, 0.5, 1, vary(groundHex, 0.01, 0.035));

    if (t === CELL.STREET) {
      // the occasional street tree, tucked to one side so the road stays open
      if (!inSquare && rand() < 0.05) tree(wx + 0.4, wz + (rand() - 0.5) * 0.6, 0.45);
      continue;
    }
    if (t !== CELL.BUILDING) continue;

    if (i === landmark) {
      const tiers: [number, number][] = [
        [0.98, 1.1],
        [0.84, 1.0],
        [0.7, 1.0],
        [0.56, 0.9],
        [0.42, 0.8],
        [0.28, 0.5],
      ];
      let y = 0;
      for (const [w, h] of tiers) {
        put(stones, wx, y, wz, w, h, w, vary(STONE, 0.01, 0.07));
        y += h;
      }
      continue;
    }

    // --- buildings, in a few distinct kinds ---
    const storeys = heights[i];
    const seed = colorSeed[i];
    const wallHex = WALL_COLORS[Math.floor(seed * WALL_COLORS.length) % WALL_COLORS.length];
    const roofHex = ROOF_COLORS[Math.floor(((seed * 13.37) % 1) * ROOF_COLORS.length) % ROOF_COLORS.length];
    const kindRoll = (seed * 7.77) % 1;

    if (storeys <= 2 && kindRoll < 0.22) {
      // rondavel homestead: one or two round huts with thatched cones
      const count = kindRoll < 0.1 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const hx = wx + (count === 1 ? 0 : k === 0 ? -0.22 : 0.24);
        const hz = wz + (count === 1 ? 0 : k === 0 ? 0.18 : -0.2);
        const rad = count === 1 ? 0.72 : 0.46;
        const wallH = count === 1 ? 0.5 : 0.42;
        put(huts, hx, 0, hz, rad, wallH, rad, vary(rand() < 0.5 ? "#e3bb6d" : "#c9763f", 0.01, 0.05));
        put(thatch, hx, wallH, hz, rad + 0.16, 0.42 + rand() * 0.14, rad + 0.16, vary(THATCH, 0.015, 0.06));
      }
      if (rand() < 0.5) tree(wx + 0.36, wz + 0.34, 0.4);
      continue;
    }

    if (storeys <= 2) {
      // house: modest footprint, stepped pitched roof, sometimes a chimney
      const fp = 0.78;
      const h = storeys * HEIGHT_SCALE;
      const wall = vary(wallHex, 0.012, 0.06).clone();
      put(walls, wx, 0, wz, fp, h, fp, wall);
      const roof = vary(roofHex, 0.01, 0.05).clone();
      put(roofs, wx, h, wz, fp + 0.14, 0.14, fp + 0.14, roof);
      put(roofs, wx, h + 0.14, wz, fp - 0.12, 0.14, fp + 0.02, roof);
      put(roofs, wx, h + 0.28, wz, fp - 0.42, 0.14, fp - 0.1, roof);
      if (rand() < 0.4) {
        c.set("#6b4a3a");
        put(walls, wx + 0.22, h + 0.2, wz - 0.18, 0.12, 0.3, 0.12, c);
      }
      windowsOn(wx, wz, fp, storeys, false);
      continue;
    }

    if (storeys >= 5) {
      // tower: slim, one storey taller, capped with a spire
      const fp = 0.62;
      const h = (storeys + 1) * HEIGHT_SCALE;
      const wall = vary(wallHex, 0.012, 0.06).clone();
      put(walls, wx, 0, wz, fp, h, fp, wall);
      c.copy(wall).offsetHSL(0, 0, -0.08);
      put(walls, wx, h * 0.55, wz, fp + 0.04, 0.08, fp + 0.04, c); // a band
      put(roofs, wx, h, wz, fp + 0.1, 0.14, fp + 0.1, vary(roofHex, 0.01, 0.05));
      c.set("#e8b23c");
      put(roofs, wx, h + 0.14, wz, 0.08, 0.7, 0.08, c);
      windowsOn(wx, wz, fp, storeys + 1, true);
      continue;
    }

    if (kindRoll < 0.5) {
      // stepped block: a wide base with a narrower upper storey set back
      const fp = 0.86;
      const lower = Math.max(1, storeys - 1) * HEIGHT_SCALE;
      const upper = HEIGHT_SCALE * 1.2;
      const wall = vary(wallHex, 0.012, 0.06).clone();
      put(walls, wx, 0, wz, fp, lower, fp, wall);
      put(roofs, wx, lower, wz, fp + 0.08, 0.12, fp + 0.08, vary(roofHex, 0.01, 0.05));
      c.copy(wall).offsetHSL(0.01, 0, 0.05);
      const ox = (rand() - 0.5) * 0.2;
      const oz = (rand() - 0.5) * 0.2;
      put(walls, wx + ox, lower + 0.12, wz + oz, fp * 0.62, upper, fp * 0.62, c);
      put(roofs, wx + ox, lower + 0.12 + upper, wz + oz, fp * 0.62 + 0.08, 0.12, fp * 0.62 + 0.08, vary(roofHex, 0.01, 0.05));
      windowsOn(wx, wz, fp, storeys - 1, false);
      continue;
    }

    // apartment block: flat roof with a parapet and a stair-head
    const fp = 0.82;
    const h = storeys * HEIGHT_SCALE;
    const wall = vary(wallHex, 0.012, 0.06).clone();
    put(walls, wx, 0, wz, fp, h, fp, wall);
    put(roofs, wx, h, wz, fp + 0.1, 0.16, fp + 0.1, vary(roofHex, 0.01, 0.05));
    if ((seed * 5.1) % 1 > 0.45) {
      const pw = 0.4;
      const ph = 0.4 + rand() * 0.4;
      c.copy(wall).offsetHSL(0, 0, -0.06);
      put(walls, wx + (rand() - 0.5) * 0.3, h + 0.16, wz + (rand() - 0.5) * 0.3, pw, ph, pw, c);
    }
    windowsOn(wx, wz, fp, storeys, false);
  }

  const built = [dirt, tiles, walls, roofs, darkWindows, litWindows, trunks, leaves, stones, huts, thatch, water].map(
    (b) => makeInstanced(b, graph, fx, rand)
  );
  const meshes = built.map((b) => b.mesh);
  const dispose = () => {
    built.forEach((b) => b.dispose());
    unit.dispose();
    cylinder.dispose();
    cone.dispose();
  };
  return { meshes, dispose };
}

function Terrain({ village, graph, fx }: { village: Village; graph: VillageGraph; fx: VillageFx }) {
  const terrain = useMemo(() => buildTerrain(village, graph, fx), [village, graph, fx]);
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
const PX = 2.1 / 32; // world units per "pixel"; figures are toy-scale (~2 blocks tall)

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

function Villagers({ system, fx }: { system: VillagerSystem; fx: VillageFx }) {
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

  useFrame((state, delta) => {
    const now = state.clock.getElapsedTime();
    const meshes = meshRefs.current;

    // while the island is in pieces there's nothing to stand on
    if (fx.morph > 0.02) {
      for (const mesh of meshes) if (mesh) mesh.count = 0;
      return;
    }

    system.update(now, Math.min(delta, 0.1), fx.uniforms.uColorRadius.value);
    const villagers = system.villagers;

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
      <hemisphereLight args={["#fffaf0", "#b9a48e", 0.55]} />
      <directionalLight ref={sunRef} position={[-40, 85, 55]} intensity={0.9} color="#fff3dc" castShadow />
      <directionalLight position={[60, 30, 10]} intensity={0.22} color="#ffe9c0" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene: owns the effect state and the villager simulation, and keeps both in
// step with the shared heartbeat count.
// ---------------------------------------------------------------------------
type SceneProps = {
  village: Village;
  count: number;
  connected: boolean;
  closing: boolean;
  fullColorCount: number;
};

function VillageScene({ village, count, connected, closing, fullColorCount }: SceneProps) {
  const graph = useMemo(() => buildVillageGraph(village), [village]);
  const fx = useMemo(() => new VillageFx(), []);
  const system = useMemo(() => new VillagerSystem(graph, village), [graph, village]);
  const hydrated = useRef(false);
  const prevCount = useRef(0);

  // The first sync after connecting seats the existing guests and paints the
  // island to match, with no fanfare (a page refresh mid-event shouldn't
  // replay the whole evening). Every later heartbeat walks a new villager
  // in, pushes the paint front outward, and lifts the island into a heart.
  useEffect(() => {
    if (!connected && !hydrated.current) return;
    const first = !hydrated.current;
    hydrated.current = true;
    const radius = colorRadiusFor(count, fullColorCount, graph);

    if (first) {
      fx.snapColor(radius);
      system.reset();
      while (system.total < count && system.spawn(true, radius)) {
        // seat everyone already counted
      }
    } else if (count < prevCount.current) {
      // operator reset: everyone leaves and the island fades back to white
      system.reset();
      fx.setColorTarget(radius);
    } else if (count > prevCount.current) {
      fx.setColorTarget(radius);
      while (system.total < count && system.spawn(false, radius)) {
        // one villager per heartbeat
      }
      fx.beat(count - prevCount.current);
    }
    prevCount.current = count;
  }, [count, connected, fullColorCount, graph, fx, system]);

  useEffect(() => {
    fx.setForceHeart(closing);
  }, [closing, fx]);

  useFrame((state, delta) => {
    fx.update(state.clock.getElapsedTime(), Math.min(delta, 0.1));
  });

  return (
    <>
      <CameraRig village={village} />
      <Lights />
      <Terrain village={village} graph={graph} fx={fx} />
      <Villagers system={system} fx={fx} />
    </>
  );
}

export function VoxelVillage({
  count,
  connected,
  closing = false,
  fullColorCount = DEFAULT_FULL_COLOR_COUNT,
}: {
  count: number;
  connected: boolean;
  closing?: boolean;
  fullColorCount?: number;
}) {
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
      {village && (
        <VillageScene
          village={village}
          count={count}
          connected={connected}
          closing={closing}
          fullColorCount={fullColorCount}
        />
      )}
    </Canvas>
  );
}
