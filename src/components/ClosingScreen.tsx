"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCountUp } from "@/lib/useCountUp";

export function ClosingScreen({ show, count }: { show: boolean; count: number }) {
  const display = useCountUp(count, 1400);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#171203]/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1 }}
            className="text-center"
          >
            <div className="text-xs uppercase tracking-[0.4em] text-[#c9c2ab]">
              CAZ Launch &middot; Pulse of Zimbabwe
            </div>
            <div className="mt-6 font-serif text-7xl tabular-nums text-[#f7f3e9] sm:text-8xl">
              {display.toLocaleString()}
            </div>
            <div className="mt-2 text-sm uppercase tracking-[0.28em] text-[#e8b23c]">
              heartbeats shared
            </div>
            <div className="mt-10 bg-gradient-to-r from-[#12a971] via-[#e8b23c] to-[#d95b45] bg-clip-text font-serif text-5xl text-transparent sm:text-6xl">
              One Heart. One Nation.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
