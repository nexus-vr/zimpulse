"use client";

import { useState } from "react";
import { useLiveState } from "@/lib/useLiveState";

const OPERATOR_PIN = process.env.NEXT_PUBLIC_OPERATOR_PIN ?? "2026";

export default function OperatorPage() {
  const { count, mode, connected } = useLiveState();
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (path: string, body?: object) => {
    setBusy(path);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  if (!unlocked) {
    return (
      <div className="flex h-svh w-svw items-center justify-center bg-[#FFD400]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pin === OPERATOR_PIN) setUnlocked(true);
          }}
          className="flex w-72 flex-col gap-4 rounded-2xl border border-black/10 bg-black/[0.05] p-6 backdrop-blur-md"
        >
          <div className="font-serif text-xl text-[#171203]">Operator access</div>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="rounded-lg border border-black/10 bg-[#171203]/90 px-3 py-2 text-[#f7f3e9] outline-none focus:border-[#a5600a]"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#e8b23c] px-3 py-2 font-medium text-[#0b0e0c] transition hover:brightness-110"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-svw flex-col gap-8 bg-[#FFD400] p-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.4em] text-[#5c4d1a]">
            Operator console
          </div>
          <div className="mt-1 font-serif text-2xl text-[#171203]">Pulse of Zimbabwe</div>
        </div>
        <div className={`text-xs uppercase tracking-widest ${connected ? "text-[#12a971]" : "text-[#d95b45]"}`}>
          {connected ? "Live" : "Reconnecting"}
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 bg-black/[0.05] p-6">
        <div className="text-xs uppercase tracking-[0.28em] text-[#5c4d1a]">Contributions</div>
        <div className="mt-2 font-serif text-6xl tabular-nums text-[#171203]">{count}</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-[#a5600a]">
          Display mode: {mode}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ActionButton
          label="Simulate test pulse"
          hint="Adds one heartbeat, for testing the display without a guest device."
          busy={busy === "/api/pulse"}
          onClick={() => call("/api/pulse")}
        />
        <ActionButton
          label={mode === "closing" ? "Return to idle animation" : "Show closing screen"}
          hint="Closing screen locks the formation into the heart with the final count."
          busy={busy === "/api/mode"}
          onClick={() => call("/api/mode", { mode: mode === "closing" ? "idle" : "closing" })}
        />
        <ActionButton
          label="Reset counter"
          hint="Clears the count and pulses to zero. Confirm before doors open."
          busy={busy === "/api/reset"}
          danger
          onClick={() => {
            if (confirm("Reset the heartbeat counter to zero?")) call("/api/reset");
          }}
        />
      </div>

      <div className="mt-auto text-xs text-[#5c4d1a]">
        Display URL: <code>/display</code> &middot; Guest URL: <code>/join</code>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  hint,
  onClick,
  busy,
  danger,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-2xl border p-5 text-left transition disabled:opacity-50 ${
        danger
          ? "border-[#d95b45]/50 bg-[#d95b45]/15 hover:bg-[#d95b45]/25"
          : "border-black/10 bg-black/[0.05] hover:bg-black/[0.09]"
      }`}
    >
      <div className="font-medium text-[#171203]">{label}</div>
      <div className="mt-1 text-xs text-[#5c4d1a]">{hint}</div>
    </button>
  );
}
