import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/station-report";

// Worker (telegram-bot.mjs) bu uçtan biçimlenmiş rapor metnini alır ve abonelere
// gönderir. Rapor mantığı (gerçek VRD verisi + AI yorumu) sunucu tarafında kalır.
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type") === "weekly" ? "weekly" : "daily";
    const result = await buildReport(type);
    return NextResponse.json({ ok: result.ok, text: result.text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Rapor üretilemedi.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
