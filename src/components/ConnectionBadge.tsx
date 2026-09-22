export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.06] px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-[#5c4d1a] backdrop-blur-md">
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[#12a971]" : "bg-[#d95b45]"}`}
      />
      {connected ? "Live" : "Reconnecting"}
    </div>
  );
}
