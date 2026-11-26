import { NextResponse, type NextRequest } from "next/server";
import { DEMO } from "@/lib/demo/mode";
import { syncAll } from "@/lib/sync";

export const maxDuration = 300;

// Vercel Cron calls this daily with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: NextRequest) {
  if (DEMO) return NextResponse.json({ results: [] });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await syncAll();
  return NextResponse.json({ results });
}
