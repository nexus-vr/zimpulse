import { MAX_PULSES, PULSE_SPEED, PULSE_WIDTH, PULSE_DURATION } from "@/lib/shaderConstants";

export const vertexShader = /* glsl */ `
  #define MAX_PULSES ${MAX_PULSES}
  #define PULSE_SPEED ${PULSE_SPEED.toFixed(3)}
  #define PULSE_WIDTH ${PULSE_WIDTH.toFixed(3)}
  #define PULSE_DURATION ${PULSE_DURATION.toFixed(3)}

  attribute vec3 aMapPos;
  attribute vec3 aHeartPos;
  attribute vec4 aRandom; // x: rotation/color jitter seed, y: float phase, z: size scale, w: speed seed
  attribute vec2 aDepth; // x: map edge-depth, y: heart edge-depth (0 = outline, 1 = core)

  uniform float uTime;
  uniform float uProgress;
  uniform float uBaseSize;
  uniform float uPixelRatio;
  uniform float uViewportHeight;
  uniform float uTanHalfFov;
  uniform float uPulseTimes[MAX_PULSES];
  uniform vec3 uHighlight;
  uniform vec3 uEdgeColor;
  uniform vec3 uMidColor;
  uniform vec3 uCoreColor;

  varying vec3 vColor;
  varying float vGlow;
  varying float vRot;

  void main() {
    vec3 base = mix(aMapPos, aHeartPos, uProgress);

    float phase = aRandom.y * 6.2831853;
    float speed = 0.35 + aRandom.w * 0.55;
    vec3 drift = vec3(
      sin(uTime * speed + phase),
      cos(uTime * speed * 1.3 + phase * 1.7),
      sin(uTime * speed * 0.8 + phase * 2.3)
    ) * 0.045;

    float dist = length(base.xy);
    float glow = 0.0;
    for (int i = 0; i < MAX_PULSES; i++) {
      float age = uTime - uPulseTimes[i];
      if (age > 0.0 && age < PULSE_DURATION) {
        float waveR = age * PULSE_SPEED;
        float d = abs(dist - waveR);
        float band = smoothstep(PULSE_WIDTH, 0.0, d);
        float fade = 1.0 - age / PULSE_DURATION;
        glow += band * fade;
      }
    }
    glow = clamp(glow, 0.0, 1.0);

    // depth: 0 on the outline, 1 at the core, jittered a little per-particle
    // so the outline band still reads as mosaic tiles rather than a flat ring.
    float depth = mix(aDepth.x, aDepth.y, uProgress);
    depth = clamp(depth + (aRandom.x - 0.5) * 0.18, 0.0, 1.0);
    vec3 baseColor = depth < 0.5
      ? mix(uEdgeColor, uMidColor, depth * 2.0)
      : mix(uMidColor, uCoreColor, (depth - 0.5) * 2.0);

    vColor = mix(baseColor, uHighlight, glow * 0.85);
    vGlow = glow;
    vRot = aRandom.x * 6.2831853 + uTime * 0.06 * (aRandom.x - 0.5);

    vec3 pos = base + drift;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float size = uBaseSize * aRandom.z * (1.0 + glow * 2.2);
    // perspective-correct sizing: size is a world-space diameter, converted
    // to device pixels via the viewport height and vertical FOV.
    gl_PointSize = size * uPixelRatio * uViewportHeight / (2.0 * -mvPosition.z * uTanHalfFov);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const fragmentShader = /* glsl */ `
  precision mediump float;

  varying vec3 vColor;
  varying float vGlow;
  varying float vRot;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float cs = cos(vRot);
    float sn = sin(vRot);
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);

    float d = sdRoundBox(rc, vec2(0.62), 0.22);
    float alpha = 1.0 - smoothstep(-0.05, 0.06, d);
    if (alpha < 0.02) discard;

    float shade = 1.0 - smoothstep(0.15, 0.85, length(rc)) * 0.28;
    vec3 col = vColor * shade + vGlow * 0.55 * vec3(1.0, 0.94, 0.78);

    gl_FragColor = vec4(col, alpha);
  }
`;
