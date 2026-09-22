import { NextResponse } from "next/server";
import { pulseStore, type DisplayMode } from "@/lib/pulseStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode: DisplayMode = body.mode === "closing" ? "closing" : "idle";
  pulseStore.setMode(mode);
  return NextResponse.json({ ok: true, mode: pulseStore.mode });
}
