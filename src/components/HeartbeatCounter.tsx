"use client";

import { useCountUp } from "@/lib/useCountUp";

export function HeartbeatCounter({ count }: { count: number }) {
  const display = useCountUp(count);

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-black/10 bg-black/[0.06] px-6 py-4 backdrop-blur-md shadow-[0_0_40px_rgba(23,18,3,0.12)]">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#a5600a] opacity-60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[#a5600a]" />
      </span>
      <div className="leading-tight">
        <div className="font-serif text-4xl tabular-nums tracking-tight text-[#171203] sm:text-5xl">
          {display.toLocaleString()}
        </div>
        <div className="text-xs uppercase tracking-[0.28em] text-[#5c4d1a]">
          Heartbeats shared tonight
        </div>
      </div>
    </div>
  );
}
