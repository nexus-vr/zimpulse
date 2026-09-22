// Shared between the GPU shader and the JS ring buffer that feeds it, so a
// pulse's lifetime is identical on both sides.
export const MAX_PULSES = 14;
export const PULSE_SPEED = 1.35; // world units / second the ripple expands
export const PULSE_WIDTH = 0.16; // ripple band thickness, world units
export const PULSE_DURATION = 3.2; // seconds a ripple stays alive

// The map is the resting state. A new heartbeat drops a tile into the
// center, then the whole mosaic blooms into a heart for a while before
// settling back to the map.
export const MAX_DROPS = 8; // concurrent falling tiles the pool can hold
export const DROP_HEIGHT = 2.6; // world units the tile falls from
export const DROP_DURATION = 0.55; // seconds to fall and land
export const DROP_FADE = 0.18; // seconds the landed tile lingers before hiding
export const HEART_HOLD_DURATION = 5; // seconds the heart holds after a landing
export const MORPH_RATE = 1.1; // damping rate driving the map<->heart blend
