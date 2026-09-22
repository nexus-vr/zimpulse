"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";

const noopSubscribe = () => () => {};

function useJoinUrl() {
  return useSyncExternalStore(
    noopSubscribe,
    () => `${window.location.origin}/join`,
    () => null
  );
}

type Stage = "idle" | "sending" | "sent";

export function HeartbeatPanel() {
  const [stage, setStage] = useState<Stage>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = useJoinUrl();

  const handleTap = useCallback(async () => {
    if (stage !== "idle") return;
    setStage("sending");
    try {
      await fetch("/api/pulse", { method: "POST" });
    } catch {
      // the display's live stream will simply lag until it reconnects
    }
    setStage("sent");
    resetTimer.current = setTimeout(() => setStage("idle"), 1400);
  }, [stage]);

  return (
    <div className="flex w-80 flex-col gap-6 rounded-3xl border border-black/10 bg-black/[0.06] p-8 backdrop-blur-md shadow-[0_0_60px_rgba(23,18,3,0.14)] sm:w-96">
      <button
        onClick={handleTap}
        disabled={stage !== "idle"}
        className="flex flex-col items-center gap-4 rounded-2xl py-2 text-center transition active:scale-[0.97] disabled:opacity-80"
      >
        <HeartIcon pulsing={stage === "idle"} />
        <div>
          <div className="font-serif text-2xl text-[#171203]">
            {stage === "sent" ? "Thank you!" : "Add your heartbeat"}
          </div>
          <div className="mt-1 text-sm text-[#5c4d1a]">
            {stage === "sent" ? "One Heart. One Nation." : "Tap here on the screen"}
          </div>
        </div>
      </button>

      <div className="h-px bg-black/10" />

      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-[#f7f3e9] p-2">
          {url ? (
            <QRCodeSVG value={url} size={84} fgColor="#0b0e0c" bgColor="#f7f3e9" />
          ) : (
            <div className="h-[84px] w-[84px]" />
          )}
        </div>
        <div className="max-w-[10rem]">
          <div className="font-serif text-base text-[#171203]">Or scan to join</div>
          <div className="text-xs leading-snug text-[#5c4d1a]">
            Scan with your phone to add your heartbeat.
          </div>
        </div>
      </div>
    </div>
  );
}

function HeartIcon({ pulsing }: { pulsing: boolean }) {
  return (
    <svg
      width="64"
      height="59"
      viewBox="0 0 32 29"
      fill="none"
      className={pulsing ? "animate-pulse" : ""}
    >
      <defs>
        <linearGradient id="panelHeartGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="32" y2="29">
          <stop offset="0%" stopColor="#095D3E" />
          <stop offset="60%" stopColor="#0E8C5C" />
          <stop offset="100%" stopColor="#14D28C" />
        </linearGradient>
      </defs>
      <path
        d="M16 28.4 2.6 15.3C-1.6 11.2.3 3.6 6.4 2.1c3.2-.8 6.6.5 8.6 3.2l1 1.4 1-1.4c2-2.7 5.4-4 8.6-3.2 6.1 1.5 8 9.1 3.8 13.2L16 28.4z"
        fill="url(#panelHeartGrad)"
      />
    </svg>
  );
}
