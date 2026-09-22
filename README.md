# Pulse of Zimbabwe

An interactive particle installation for the CAZ Launch (3 October 2026, Hyatt
Regency Meikles, Harare). Thousands of small mosaic-tile particles form the
map of Zimbabwe, drifting gently, and periodically bloom into a heart. Every
guest heartbeat sends a bright ripple across the display and a live counter
climbs throughout the event.

## Routes

| Route | Who uses it | What it does |
|---|---|---|
| `/display` | The LED wall / display screen | The particle installation, live counter, QR code, and closing screen. Open full-screen (`F11`/kiosk mode). |
| `/village` | Alternative display | The isometric voxel village (see below). Same counter, same tap/QR panel, same backend. |
| `/join` | Guest tablet(s) / QR scan | "Tap the heart to add your heartbeat." Fits the ~10–15s per-guest flow, auto-resets for the next guest. |
| `/operator` | Event staff | PIN-gated console: simulate a test pulse, trigger the closing screen, reset the counter. |
| `/` | Staff | Quick links to the views above. |

### The village (`/village`)

A Minecraft-style voxel city in the shape of Zimbabwe. It starts entirely
white. Each heartbeat drops a new villager into the town square, paints a
little more of the island outward from the square (people can only stroll
through painted streets), and lifts every block into a heart before the island
reassembles. By default the whole island is painted after 150 heartbeats;
`/village?full=30` changes that (useful for demos with few taps). The
generator (`scripts/generate-village.mjs`) writes `public/data/village.json`.

## Running it

```bash
npm install
npm run build && npm start -- -p 3100 -H 0.0.0.0   # production, LAN-visible
# or, for on-site tweaks:
npm run dev -- -H 0.0.0.0
```

`-H 0.0.0.0` binds to every network interface so tablets and the display can
reach it over the venue's local Wi-Fi/router — **no internet connection is
required**. Run it on a laptop or mini-PC connected to the same LAN/AP as the
display device and the guest tablets; point tablets at
`http://<that machine's LAN IP>:3100/join`.

The operator PIN defaults to `2026` — override it with
`NEXT_PUBLIC_OPERATOR_PIN` before building for the event.

## How it's built

- **Particle field** (`src/components/ParticleMosaic.tsx` + `mosaicShaders.ts`):
  a single `THREE.Points` cloud (~7,200 particles) driven by a custom GLSL
  shader. Each particle carries a map position and a heart position; a
  `uProgress` uniform cross-fades between them on a slow, ambient cycle
  (`src/lib/shaderConstants.ts`). This ambient animation runs independently of
  any guest interaction — it's the built-in fallback: if the network, tablets,
  or API go down, the display keeps breathing and looks intentional.
- **Zimbabwe silhouette**: generated once from a real country boundary
  (`scripts/generate-points.mjs` + `scripts/data/zwe.geojson`) into
  `public/data/formations.json`, so no map tiles or external image are needed
  at runtime.
- **Pulses**: `POST /api/pulse` increments a shared in-memory counter
  (`src/lib/pulseStore.ts`) and broadcasts over Server-Sent Events
  (`/api/stream`) to every open `/display`. The shader turns each pulse into a
  ring that expands outward from the centre of whichever shape is showing.
- **Closing screen**: the operator's "Show closing screen" locks the
  formation into the heart and overlays the final count with "One Heart. One
  Nation."

## Notes for the on-site team

- This is a single-process, local-network app — it's designed to run on one
  machine on-site, not to be deployed behind a multi-instance host (the
  pulse counter and live stream are in-memory to that process).
- Do a full run-through before doors open: open `/display` on the real
  screen, `/join` on the real tablet, and fire a few pulses from `/operator`
  to confirm the ripple is visible and the counter matches.
- `npm run start`/`npm run dev` keep the counter only for that process's
  lifetime — restarting the server resets it to zero, which doubles as the
  "manual reset."
# zimpulse
