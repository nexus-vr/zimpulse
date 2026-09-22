"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { loadFormations, type Formations } from "@/lib/formations";
import { EDGE_COLOR, MID_COLOR, CORE_COLOR, PULSE_HIGHLIGHT } from "@/lib/palette";
import { mulberry32 } from "@/lib/prng";
import { vertexShader, fragmentShader } from "./mosaicShaders";
import {
  MAX_PULSES,
  MAX_DROPS,
  DROP_HEIGHT,
  DROP_DURATION,
  DROP_FADE,
  HEART_HOLD_DURATION,
  MORPH_RATE,
} from "@/lib/shaderConstants";

type MosaicPointsProps = {
  formations: Formations;
  mode: "idle" | "closing";
  lastPulseId: number | null;
};

type DropState = { start: number; landed: boolean; active: boolean };

function MosaicPoints({ formations, mode, lastPulseId }: MosaicPointsProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const pulseSlot = useRef(0);
  const pulseTimesRef = useRef<number[]>(new Array(MAX_PULSES).fill(-9999));
  const progressRef = useRef(0);
  // The map is the resting shape; a landed drop opens a window during which
  // the target shape is the heart. Outside that window it's always the map.
  const heartUntilRef = useRef(-Infinity);
  const dropSlot = useRef(0);
  const dropsRef = useRef<DropState[]>(
    Array.from({ length: MAX_DROPS }, () => ({ start: -Infinity, landed: false, active: false }))
  );
  const dropMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const dpr = useThree((s) => s.viewport.dpr);
  const viewportHeight = useThree((s) => s.size.height);
  const cameraFov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov);
  const tanHalfFov = Math.tan((cameraFov / 2) * (Math.PI / 180));

  // Seeded PRNG keeps this a pure function of `formations` (required by React
  // Compiler), while still giving each particle randomised-looking attributes.
  const geometry = useMemo(() => {
    const { count, map, heart, mapDepth, heartDepth } = formations;
    const mapPos = new Float32Array(count * 3);
    const heartPos = new Float32Array(count * 3);
    const random = new Float32Array(count * 4);
    const depth = new Float32Array(count * 2);
    const rand = mulberry32(20261003);

    for (let i = 0; i < count; i++) {
      mapPos[i * 3] = map[i][0];
      mapPos[i * 3 + 1] = map[i][1];
      mapPos[i * 3 + 2] = map[i][2];
      heartPos[i * 3] = heart[i][0];
      heartPos[i * 3 + 1] = heart[i][1];
      heartPos[i * 3 + 2] = heart[i][2];

      random[i * 4] = rand();
      random[i * 4 + 1] = rand();
      random[i * 4 + 2] = 0.55 + rand() * 0.85;
      random[i * 4 + 3] = rand();

      depth[i * 2] = mapDepth[i];
      depth[i * 2 + 1] = heartDepth[i];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mapPos, 3));
    geo.setAttribute("aMapPos", new THREE.BufferAttribute(mapPos, 3));
    geo.setAttribute("aHeartPos", new THREE.BufferAttribute(heartPos, 3));
    geo.setAttribute("aRandom", new THREE.BufferAttribute(random, 4));
    geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
    return geo;
  }, [formations]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uBaseSize: { value: 0.024 },
      uPixelRatio: { value: dpr },
      uViewportHeight: { value: viewportHeight },
      uTanHalfFov: { value: tanHalfFov },
      uPulseTimes: { value: new Array(MAX_PULSES).fill(-9999) },
      uHighlight: { value: PULSE_HIGHLIGHT.clone() },
      uEdgeColor: { value: EDGE_COLOR.clone() },
      uMidColor: { value: MID_COLOR.clone() },
      uCoreColor: { value: CORE_COLOR.clone() },
    }),
    [dpr, viewportHeight, tanHalfFov]
  );

  // A new heartbeat: drop a bright tile into the center. Its landing (in
  // useFrame below) is what actually triggers the ripple and the heart bloom.
  useEffect(() => {
    if (lastPulseId === null) return;
    const slot = dropSlot.current % MAX_DROPS;
    dropsRef.current[slot] = { start: elapsedRef.current, landed: false, active: true };
    dropSlot.current += 1;
  }, [lastPulseId]);

  useFrame((state, delta) => {
    elapsedRef.current = state.clock.getElapsedTime();
    const now = elapsedRef.current;

    for (let i = 0; i < MAX_DROPS; i++) {
      const drop = dropsRef.current[i];
      const mesh = dropMeshRefs.current[i];
      if (!mesh) continue;
      if (!drop.active) {
        mesh.visible = false;
        continue;
      }
      const age = now - drop.start;
      if (age < DROP_DURATION) {
        const t = age / DROP_DURATION;
        const eased = t * t;
        mesh.visible = true;
        mesh.position.set(0, DROP_HEIGHT * (1 - eased), 0.3);
        mesh.scale.setScalar(0.05 * (0.7 + 0.3 * t));
      } else if (age < DROP_DURATION + DROP_FADE) {
        if (!drop.landed) {
          drop.landed = true;
          const slot = pulseSlot.current % MAX_PULSES;
          pulseTimesRef.current[slot] = now;
          pulseSlot.current += 1;
          heartUntilRef.current = now + HEART_HOLD_DURATION;
        }
        const ft = (age - DROP_DURATION) / DROP_FADE;
        mesh.visible = true;
        mesh.position.set(0, 0, 0.15);
        mesh.scale.setScalar(0.08 * (1 - ft) + 0.015);
      } else {
        drop.active = false;
        mesh.visible = false;
      }
    }

    if (!materialRef.current) return;
    const mat = materialRef.current;
    mat.uniforms.uTime.value = now;
    mat.uniforms.uPixelRatio.value = dpr;
    mat.uniforms.uViewportHeight.value = viewportHeight;
    mat.uniforms.uTanHalfFov.value = tanHalfFov;

    const target = mode === "closing" ? 1 : now < heartUntilRef.current ? 1 : 0;
    progressRef.current = THREE.MathUtils.damp(progressRef.current, target, MORPH_RATE, delta);
    mat.uniforms.uProgress.value = progressRef.current;

    // mutate in place; three re-checks array uniform contents each upload
    for (let i = 0; i < MAX_PULSES; i++) {
      mat.uniforms.uPulseTimes.value[i] = pulseTimesRef.current[i];
    }

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(now * 0.08) * 0.14;
      groupRef.current.rotation.x = Math.sin(now * 0.05) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite
        />
      </points>
      {Array.from({ length: MAX_DROPS }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            dropMeshRefs.current[i] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={PULSE_HIGHLIGHT} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function ParticleMosaic({
  mode,
  lastPulseId,
  debugControls = false,
}: {
  mode: "idle" | "closing";
  lastPulseId: number | null;
  debugControls?: boolean;
}) {
  const [formations, setFormations] = useState<Formations | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFormations().then((f) => {
      if (!cancelled) setFormations(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 4.3], fov: 42 }}
      className="!absolute inset-0"
    >
      <color attach="background" args={["#FFD400"]} />
      <fog attach="fog" args={["#FFD400", 4.5, 8.5]} />
      {formations && (
        <MosaicPoints formations={formations} mode={mode} lastPulseId={lastPulseId} />
      )}
      <EffectComposer multisampling={0}>
        <Bloom
          intensity={0.85}
          luminanceThreshold={0.92}
          luminanceSmoothing={0.15}
          mipmapBlur
        />
      </EffectComposer>
      {debugControls && <DebugOrbit />}
    </Canvas>
  );
}

function DebugOrbit() {
  const [Controls, setControls] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
  useEffect(() => {
    import("@react-three/drei").then((m) => setControls(() => m.OrbitControls));
  }, []);
  if (!Controls) return null;
  return <Controls enableDamping dampingFactor={0.08} />;
}
