import { NextRequest, NextResponse } from "next/server";
import { buildStatusText, recordOfficialMessage } from "@/lib/fuel-forecast";

// Telegram → Zam/İndirim Tahmini: /piyasa (ya da /zam) ile güncel durum. Bota iletilen
// dağıtıcı mesajı ({ mesaj }) resmi değer olarak kaydedilir. Uç yalnız aynı makinedeki bota
// açıktır — portal (Cloudflare) üzerinden gelen istek cf-connecting-ip taşır, reddedilir.

export async function POST(req: NextRequest) {
  if (req.headers.get("cf-connecting-ip")) {
    return NextResponse.json({ ok: false, error: "Yetkisiz." }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { mesaj?: unknown };
    if (typeof body.mesaj === "string" && body.mesaj.trim()) {
      const { saved, reply } = recordOfficialMessage(body.mesaj);
      return NextResponse.json({ ok: saved > 0, text: reply });
    }
    return NextResponse.json({ ok: true, text: buildStatusText() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Durum hazırlanamadı.";
    return NextResponse.json({ ok: false, text: message }, { status: 500 });
  }
}
