import { EventEmitter } from "node:events";

export type PulseEvent = { id: number; t: number };
export type DisplayMode = "idle" | "closing";

type StoreEvent =
  | { type: "pulse"; count: number; pulse: PulseEvent }
  | { type: "reset"; count: number }
  | { type: "mode"; mode: DisplayMode };

class PulseStore {
  count = 0;
  mode: DisplayMode = "idle";
  private nextId = 1;
  emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(64);
  }

  snapshot() {
    return { count: this.count, mode: this.mode };
  }

  addPulse(): PulseEvent {
    const pulse: PulseEvent = { id: this.nextId++, t: Date.now() };
    this.count += 1;
    this.broadcast({ type: "pulse", count: this.count, pulse });
    return pulse;
  }

  reset() {
    this.count = 0;
    this.mode = "idle";
    this.broadcast({ type: "reset", count: this.count });
  }

  setMode(mode: DisplayMode) {
    this.mode = mode;
    this.broadcast({ type: "mode", mode });
  }

  private broadcast(event: StoreEvent) {
    this.emitter.emit("event", event);
  }
}

// survive Next.js dev-mode module reloads with a globalThis singleton
const globalForStore = globalThis as unknown as { __pulseStore?: PulseStore };

export const pulseStore = globalForStore.__pulseStore ?? new PulseStore();
globalForStore.__pulseStore = pulseStore;
