import { NextResponse } from "next/server";
import { buildPendingShiftReports, skipPendingShifts } from "@/lib/station-report";
import { isShiftReportEnabled } from "@/lib/telegram";

export const maxDuration = 60;

// Worker (telegram-bot.mjs) bu ucu periyodik yoklar. VRD klasörüne yeni vardiya
// dosyası düşmüşse o vardiyanın rapor metnini döndürür ve "raporlandı" işaretler.
// İlk çalıştırmada mevcut dosyalar baseline olarak işaretlenir; boş döner.
// Vardiya raporu kapalıysa yeni dosyalar sessizce işaretlenir (backlog birikmez).
export async function GET() {
  try {
    if (!isShiftReportEnabled()) {
      skipPendingShifts();
      return NextResponse.json({ ok: true, shifts: [] });
    }
    const shifts = await buildPendingShiftReports();
    return NextResponse.json({ ok: true, shifts });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Vardiya raporu üretilemedi.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
