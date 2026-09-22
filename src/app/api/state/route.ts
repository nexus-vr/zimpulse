import { NextResponse } from "next/server";
import { pulseStore } from "@/lib/pulseStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(pulseStore.snapshot());
}
