import { NextRequest, NextResponse } from "next/server";
import { getVerifyToken, handleWebhook, verifySignature } from "@/lib/wa-cloud";

// Meta'nın WhatsApp webhook'u. Bu adres portalın şifre korumasının DIŞINDA kalmalı
// (Cloudflare'de yalnız bu yol için istisna); güvenliği Meta'nın imzası sağlar.
//
// GET  -> Meta panelinde "Doğrula ve kaydet" denince gelen doğrulama isteği.
// POST -> mesaj, echo, geçmiş, rehber ve durum bildirimleri.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === getVerifyToken()) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // İmza ham gövde üzerinden hesaplanır; JSON'a çevirmeden önce okunmalı.
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  try {
    handleWebhook(JSON.parse(raw));
  } catch (err) {
    // Meta 200 almazsa aynı bildirimi saatlerce tekrar gönderir; işleyemediğimiz bir
    // bildirim yüzünden kuyruğu tıkamamak için hatayı loglayıp 200 dönüyoruz.
    console.error("[wa-cloud] webhook işlenemedi:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}
