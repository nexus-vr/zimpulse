import Link from "next/link";

const links = [
  {
    href: "/display",
    title: "Display",
    desc: "The shared installation view — open full-screen on the LED wall or display screen.",
  },
  {
    href: "/village",
    title: "Village display",
    desc: "The second installation view — an isometric voxel Zimbabwe where every heartbeat adds a villager to the border.",
  },
  {
    href: "/join",
    title: "Guest tablet",
    desc: "“Add My Heartbeat” — open on the tablet, or this is what the QR code on the display links to.",
  },
  {
    href: "/operator",
    title: "Operator console",
    desc: "Reset the counter, trigger the closing screen, or send a test pulse.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-10 bg-[#FFD400] p-8">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.4em] text-[#5c4d1a]">
          CAZ Launch &middot; 3 October 2026
        </div>
        <div className="mt-2 font-serif text-4xl italic text-[#171203]">
          Pulse of Zimbabwe
        </div>
      </div>
      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-2xl border border-black/10 bg-black/[0.04] p-5 transition hover:bg-black/[0.08]"
          >
            <div className="font-serif text-lg text-[#a5600a]">{l.title}</div>
            <div className="mt-1 text-sm text-[#5c4d1a]">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
