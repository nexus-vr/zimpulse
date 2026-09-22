"use client";

import { useEffect, useRef, useState } from "react";

export type DisplayMode = "idle" | "closing";

export type LiveState = {
  count: number;
  mode: DisplayMode;
  connected: boolean;
  lastPulseId: number | null;
};

/**
 * Subscribes to /api/stream (SSE) for near-instant updates, and falls back to
 * polling /api/state if the stream can't be established (e.g. a proxy that
 * blocks long-lived connections). This is what keeps the shared display in
 * sync with every tablet/QR interaction on the local network.
 */
export function useLiveState() {
  const [state, setState] = useState<LiveState>({
    count: 0,
    mode: "idle",
    connected: false,
    lastPulseId: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/state", { cache: "no-store" });
          const data = await res.json();
          setState((s) => ({ ...s, count: data.count, mode: data.mode, connected: true }));
        } catch {
          setState((s) => ({ ...s, connected: false }));
        }
      }, 2000);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource("/api/stream");
      } catch {
        startPolling();
        return;
      }

      es.addEventListener("snapshot", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, count: data.count, mode: data.mode, connected: true }));
        stopPolling();
      });

      es.addEventListener("pulse", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, count: data.count, lastPulseId: data.pulse.id, connected: true }));
      });

      es.addEventListener("reset", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, count: data.count, mode: "idle", connected: true }));
      });

      es.addEventListener("mode", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, mode: data.mode, connected: true }));
      });

      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es?.close();
        startPolling();
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      es?.close();
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return state;
}
