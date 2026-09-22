// Shared, React-free effect state for the voxel village: the heart morph
// timeline and the expanding colour front. One instance lives in the scene;
// its uniforms are shared by every terrain material so a single value drives
// the whole island.
import * as THREE from "three";

export const MORPH_DELAY = 0.9; // seconds after a heartbeat before blocks lift (lets the villager land first)
export const MORPH_RISE = 1.8; // seconds to disassemble into the heart
export const MORPH_HOLD = 2.6; // seconds the heart holds
export const MORPH_FALL = 1.8; // seconds to reassemble as the island
const COLOR_RATE = 2.4; // damping rate of the paint front (higher = snappier)
const FORCE_RATE = 1.4; // damping rate when the closing screen pins the heart

function ease(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class VillageFx {
  readonly uniforms = {
    uMorph: { value: 0 },
    uColorRadius: { value: -0.05 },
    uWhite: { value: new THREE.Color("#ffffff") },
  };
  /** Heartbeats received since the last frame; consumed by update(). */
  pending = 0;
  /** Pins the heart (used by the closing screen). */
  forceHeart = false;
  colorTarget = -0.05;
  /** 0 = island, 1 = heart. */
  morph = 0;

  private phaseStart = -1;
  private holdUntil = -1;
  private forced = 0;

  snapColor(radius: number) {
    this.colorTarget = radius;
    this.uniforms.uColorRadius.value = radius;
  }

  /** Animate the paint front toward a new radius. */
  setColorTarget(radius: number) {
    this.colorTarget = radius;
  }

  /** Register heartbeats; the morph starts on the next frame. */
  beat(n = 1) {
    this.pending += n;
  }

  setForceHeart(on: boolean) {
    this.forceHeart = on;
  }

  private trigger(now: number) {
    if (this.phaseStart < 0) {
      this.phaseStart = now + MORPH_DELAY;
      this.holdUntil = this.phaseStart + MORPH_RISE + MORPH_HOLD;
    } else if (now < this.holdUntil) {
      // already lifting or holding: keep the heart up a little longer
      this.holdUntil = Math.max(this.holdUntil, now + MORPH_HOLD * 0.7);
    }
    // while falling back we let the cycle finish; the next beat starts a fresh one
  }

  update(now: number, dt: number) {
    if (this.pending > 0) {
      this.trigger(now);
      this.pending = 0;
    }

    let m = 0;
    if (this.phaseStart >= 0) {
      if (now < this.phaseStart) m = 0;
      else if (now < this.phaseStart + MORPH_RISE) m = ease((now - this.phaseStart) / MORPH_RISE);
      else if (now < this.holdUntil) m = 1;
      else if (now < this.holdUntil + MORPH_FALL) m = 1 - ease((now - this.holdUntil) / MORPH_FALL);
      else {
        m = 0;
        this.phaseStart = -1;
      }
    }
    this.forced = THREE.MathUtils.damp(this.forced, this.forceHeart ? 1 : 0, FORCE_RATE, dt);
    this.morph = Math.max(m, this.forced);
    this.uniforms.uMorph.value = this.morph;

    const r = this.uniforms.uColorRadius.value;
    this.uniforms.uColorRadius.value = THREE.MathUtils.damp(r, this.colorTarget, COLOR_RATE, dt);
  }
}

/**
 * Per-instance attributes every terrain mesh carries (see makeInstanced in
 * VoxelVillage.tsx): where the block goes in the heart, a random scatter for
 * the arc it takes to get there, and (unlock rank, morph delay).
 */
export const FX_ATTRIBUTES = {
  heart: "aHeartPos",
  scatter: "aScatter",
  unlock: "aUnlock",
} as const;

const VERTEX_HEADER = /* glsl */ `
attribute vec3 aHeartPos;
attribute vec3 aScatter;
attribute vec2 aUnlock;
uniform float uMorph;
varying float vUnlock;
`;

const VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
vUnlock = aUnlock.x;
#ifdef USE_INSTANCING
{
  // inner blocks leave first, so the disassembly ripples outward from the square
  float m = smoothstep(aUnlock.y * 0.55, aUnlock.y * 0.55 + 0.45, uMorph);
  if (m > 0.0) {
    vec3 iScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec3 iPos = instanceMatrix[3].xyz;
    float arc = sin(m * 3.14159265);
    vec3 target = mix(iPos, aHeartPos, m) + aScatter * arc;
    // instance matrices here are translate*scale only, so a world offset is a
    // local offset divided by the scale
    transformed += (target - iPos) / iScale;
  }
}
#endif
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uColorRadius;
uniform vec3 uWhite;
varying float vUnlock;
`;

const FRAGMENT_BODY = /* glsl */ `
#include <color_fragment>
{
  float painted = 1.0 - smoothstep(uColorRadius - 0.015, uColorRadius + 0.015, vUnlock);
  diffuseColor.rgb = mix(uWhite, diffuseColor.rgb, painted);
}
`;

/**
 * Wire a material into the village effects. `paint` adds the white-until-
 * unlocked treatment (skip it for depth materials, which have no colour).
 */
export function augmentVillageMaterial(material: THREE.Material, fx: VillageFx, paint: boolean) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMorph = fx.uniforms.uMorph;
    shader.uniforms.uColorRadius = fx.uniforms.uColorRadius;
    shader.uniforms.uWhite = fx.uniforms.uWhite;
    shader.vertexShader = VERTEX_HEADER + shader.vertexShader.replace("#include <begin_vertex>", VERTEX_BODY);
    if (paint) {
      shader.fragmentShader =
        FRAGMENT_HEADER + shader.fragmentShader.replace("#include <color_fragment>", FRAGMENT_BODY);
    }
  };
  material.customProgramCacheKey = () => (paint ? "village-fx-paint" : "village-fx");
  return material;
}
