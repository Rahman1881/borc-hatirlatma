import { NextRequest, NextResponse } from "next/server";
import { handleTelegramEntry } from "@/lib/fuel-forecast";

// Telegram → Zam/İndirim Tahmini: "z6 1025,3 a3g 985,3" girişini kaydeder ya da
// "/piyasa" ile durumu döner. Bot (telegram-bot.mjs) yalnız erişimi açık kişilerin
// mesajını gönderir; kimlik chatId ile geldiği için uç yalnız aynı makinedeki bota
// açıktır — portal (Cloudflare) üzerinden gelen istek cf-connecting-ip taşır, reddedilir.

export async function POST(req: NextRequest) {
  if (req.headers.get("cf-connecting-ip")) {
    return NextResponse.json({ ok: false, error: "Yetkisiz." }, { status: 403 });
  }
  try {
    const body = (await req.json()) as { chatId?: string | number; text?: string };
    const text = await handleTelegramEntry(String(body.chatId ?? ""), String(body.text ?? ""));
    return NextResponse.json({ ok: true, text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Piyasa girişi işlenemedi.";
    return NextResponse.json({ ok: false, text: message }, { status: 500 });
  }
}
