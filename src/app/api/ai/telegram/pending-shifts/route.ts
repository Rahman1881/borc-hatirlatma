import { NextResponse } from "next/server";
import { buildPendingShiftReports, skipPendingShifts } from "@/lib/station-report";
import { isShiftReportEnabled } from "@/lib/telegram";
import { syncVrdInBackground } from "@/lib/vrd-ingest";

export const maxDuration = 60;

// Worker (telegram-bot.mjs) bu ucu periyodik yoklar. VRD klasörüne yeni vardiya
// dosyası düşmüşse o vardiyanın rapor metnini döndürür ve "raporlandı" işaretler.
// İlk çalıştırmada mevcut dosyalar baseline olarak işaretlenir; boş döner.
// Vardiya raporu kapalıysa yeni dosyalar sessizce işaretlenir (backlog birikmez).
export async function GET() {
  try {
    // Yeni vardiya düştüyse analitik verisini de arka planda tazeleriz (plaka
    // sorgusu ve Müşteri Analitiği son vardiyaya kadar güncel kalsın).
    if (!isShiftReportEnabled()) {
      if (skipPendingShifts() > 0) syncVrdInBackground();
      return NextResponse.json({ ok: true, shifts: [] });
    }
    const shifts = await buildPendingShiftReports();
    if (shifts.length > 0) syncVrdInBackground();
    return NextResponse.json({ ok: true, shifts });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Vardiya raporu üretilemedi.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
