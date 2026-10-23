import { NextRequest, NextResponse } from "next/server";
import { buildStatusText } from "@/lib/fuel-forecast";

// Telegram → Zam/İndirim Tahmini: /piyasa (ya da /zam) ile güncel durum. Veri otomatik
// çekildiği için girdi alınmaz. Uç yalnız aynı makinedeki bota açıktır — portal
// (Cloudflare) üzerinden gelen istek cf-connecting-ip taşır, reddedilir.

export async function POST(req: NextRequest) {
  if (req.headers.get("cf-connecting-ip")) {
    return NextResponse.json({ ok: false, error: "Yetkisiz." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, text: buildStatusText() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Durum hazırlanamadı.";
    return NextResponse.json({ ok: false, text: message }, { status: 500 });
  }
}
