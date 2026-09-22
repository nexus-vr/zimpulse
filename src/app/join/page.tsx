"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Stage = "idle" | "submitting" | "thanks";

export default function JoinPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [myNumber, setMyNumber] = useState<number | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTap = useCallback(async () => {
    if (stage !== "idle") return;
    setStage("submitting");
    try {
      const res = await fetch("/api/pulse", { method: "POST" });
      const data = await res.json();
      setMyNumber(data.count ?? null);
    } catch {
      setMyNumber(null);
    }
    setStage("thanks");
    resetTimer.current = setTimeout(() => {
      setStage("idle");
      setMyNumber(null);
    }, 4200);
  }, [stage]);

  return (
    <div className="relative flex h-svh w-svw flex-col items-center justify-between overflow-hidden bg-[#FFD400] px-6 py-10 text-center select-none">
      <div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-[#5c4d1a]">
          CAZ Launch &middot; Pulse of Zimbabwe
        </div>
        <div className="mt-1 font-serif text-xl italic text-[#171203]">
          Hyatt Regency Meikles, Harare
        </div>
      </div>

      <button
        onClick={handleTap}
        disabled={stage !== "idle"}
        aria-label="Add my heartbeat"
        className="group relative flex h-64 w-64 items-center justify-center rounded-full outline-none sm:h-72 sm:w-72"
      >
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(23,18,3,0.16),transparent_70%)] blur-xl" />
        <motion.div
          animate={
            stage === "idle"
              ? { scale: [1, 1.06, 1] }
              : stage === "submitting"
              ? { scale: 0.9 }
              : { scale: [1, 1.18, 1] }
          }
          transition={
            stage === "idle"
              ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.6, ease: "easeOut" }
          }
          className="relative"
        >
          <HeartGlyph />
        </motion.div>
      </button>

      <div className="h-24 w-full max-w-sm">
        <AnimatePresence mode="wait">
          {stage === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="font-serif text-2xl text-[#171203]"
            >
              Tap the heart to add your heartbeat
            </motion.div>
          )}
          {stage === "submitting" && (
            <motion.div
              key="submitting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-serif text-2xl text-[#5c4d1a]"
            >
              Sending your pulse&hellip;
            </motion.div>
          )}
          {stage === "thanks" && (
            <motion.div
              key="thanks"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="font-serif text-3xl text-[#a5600a]">
                Thank you{myNumber ? ` — heartbeat #${myNumber}` : ""}
              </div>
              <div className="mt-1 text-sm text-[#5c4d1a]">
                One Heart. One Nation.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function HeartGlyph() {
  return (
    <svg width="150" height="150" viewBox="0 0 32 29" fill="none">
      <defs>
        <linearGradient id="heartGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="32" y2="29">
          <stop offset="0%" stopColor="#12a971" />
          <stop offset="50%" stopColor="#e8b23c" />
          <stop offset="100%" stopColor="#d95b45" />
        </linearGradient>
      </defs>
      <path
        d="M16 28.4 2.6 15.3C-1.6 11.2.3 3.6 6.4 2.1c3.2-.8 6.6.5 8.6 3.2l1 1.4 1-1.4c2-2.7 5.4-4 8.6-3.2 6.1 1.5 8 9.1 3.8 13.2L16 28.4z"
        fill="url(#heartGrad)"
      />
    </svg>
  );
}
