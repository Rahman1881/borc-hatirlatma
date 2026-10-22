import { NextRequest, NextResponse } from "next/server";
import {
  getWatchItems,
  getWatchStatus,
  saveWatchConfig,
  startScan,
} from "@/lib/prospect-watch";

// Müşteri Bulucu → "Yeni İşletmeler" sekmesi.
// GET  -> takip ayarı, tarama durumu, yeni ve yakında açılacak işletmeler
// POST -> action: save (il, türler, haftalık açık/kapalı) | scan (şimdi tara)

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getWatchStatus();
    return NextResponse.json({ ...status, items: getWatchItems(status.config.il) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Durum okunamadı." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "save") {
      saveWatchConfig({
        il: String(body?.il || ""),
        profiles: Array.isArray(body?.profiles) ? body.profiles.map(String) : [],
        enabled: body?.enabled === true,
      });
    } else if (action === "scan") {
      const r = startScan("manual");
      if (!r.started) return NextResponse.json({ error: r.reason }, { status: 409 });
    } else {
      return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
    }

    const status = getWatchStatus();
    return NextResponse.json({ ...status, items: getWatchItems(status.config.il) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "İşlem başarısız." },
      { status: 500 }
    );
  }
}
