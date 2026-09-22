"use client";

import dynamic from "next/dynamic";
import { useLiveState } from "@/lib/useLiveState";
import { HeartbeatCounter } from "@/components/HeartbeatCounter";
import { HeartbeatPanel } from "@/components/HeartbeatPanel";
import { ClosingScreen } from "@/components/ClosingScreen";
import { ConnectionBadge } from "@/components/ConnectionBadge";

const VoxelVillage = dynamic(
  () => import("@/components/VoxelVillage").then((m) => m.VoxelVillage),
  { ssr: false }
);

export default function VillagePage() {
  const { count, mode, connected } = useLiveState();

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#FFD400]">
      <VoxelVillage count={count} connected={connected} />

      <div className="pointer-events-none absolute inset-0 p-8 sm:p-12">
        <div className="grid grid-cols-3 items-start">
          <div>
            <div className="text-xs uppercase tracking-[0.4em] text-[#5c4d1a] drop-shadow-[0_1px_2px_rgba(255,212,0,0.6)]">
              CAZ Launch
            </div>
            <div className="mt-1 font-serif text-2xl italic text-[#171203] drop-shadow-[0_1px_3px_rgba(255,212,0,0.6)] sm:text-3xl">
              Pulse of Zimbabwe
            </div>
          </div>
          <div className="flex justify-center pointer-events-auto">
            <HeartbeatCounter count={count} />
          </div>
          <div className="flex justify-end pointer-events-auto">
            <ConnectionBadge connected={connected} />
          </div>
        </div>

        <div className="pointer-events-auto absolute left-8 top-1/2 -translate-y-1/2 sm:left-12">
          <HeartbeatPanel />
        </div>
      </div>

      <ClosingScreen show={mode === "closing"} count={count} />
    </div>
  );
}
