import { Color } from "three";

// Particle color is driven by each point's distance from the shape's outline
// (see aDepth in ParticleMosaic/mosaicShaders): dark near the edge, brightest
// at the core, so the silhouette reads with a defined outline. All three
// stops share one hue (a deep bottle green), each a lighter tint than the last.
export const EDGE_COLOR = new Color("#095D3E"); // darkest tint, on the outline
export const MID_COLOR = new Color("#0E8C5C"); // mid tint, midway in
export const CORE_COLOR = new Color("#14D28C"); // lightest tint, interior

export const PULSE_HIGHLIGHT = new Color("#D4FFDE");
