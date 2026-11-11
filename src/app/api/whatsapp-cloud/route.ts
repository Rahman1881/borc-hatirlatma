import { NextRequest, NextResponse } from "next/server";
import {
  completeSignup,
  connectWithToken,
  diagnose,
  finishSetup,
  getStatus,
  saveAppSecret,
} from "@/lib/wa-cloud";

// Ayarlar → "WhatsApp Resmi API" kartının ucu. Gizli bilgiler (App Secret, erişim
// anahtarı) hiçbir zaman cevapta dönmez.
//
// GET  -> durum
// POST -> action: saveSecret | connect | connectToken | finish | diagnose

export async function GET() {
  try {
    return NextResponse.json(getStatus());
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

    if (action === "saveSecret") {
      const secret = String(body?.appSecret ?? "").trim();
      // Meta App Secret 32 karakterlik onaltılık bir dizedir.
      if (!/^[0-9a-f]{32}$/i.test(secret)) {
        return NextResponse.json(
          { error: "App Secret 32 karakterlik bir kod olmalı (rakam ve a–f harfleri)." },
          { status: 400 }
        );
      }
      saveAppSecret(secret);
      return NextResponse.json(getStatus());
    }

    if (action === "connect") {
      const code = String(body?.code ?? "");
      const wabaId = String(body?.wabaId ?? "");
      const phoneNumberId = String(body?.phoneNumberId ?? "");
      if (!code) {
        return NextResponse.json(
          { error: "Meta'dan eksik bilgi geldi (kod yok)." },
          { status: 400 }
        );
      }
      const status = await completeSignup({
        code,
        wabaId: wabaId || undefined,
        phoneNumberId: phoneNumberId || undefined,
        businessId: body?.businessId ? String(body.businessId) : undefined,
        redirectUri: typeof body?.redirectUri === "string" && /^https?:\/\//.test(body.redirectUri) ? body.redirectUri : undefined,
      });
      return NextResponse.json(status);
    }

    if (action === "connectToken") {
      const token = String(body?.token ?? "").trim();
      const wabaId = String(body?.wabaId ?? "").trim();
      if (token.length < 50 || /\s/.test(token)) {
        return NextResponse.json({ error: "Erişim anahtarı eksik ya da hatalı görünüyor." }, { status: 400 });
      }
      if (!/^\d{5,20}$/.test(wabaId)) {
        return NextResponse.json({ error: "WhatsApp hesap kodu yalnız rakamlardan oluşmalı." }, { status: 400 });
      }
      return NextResponse.json(await connectWithToken({ token, wabaId }));
    }

    if (action === "diagnose") {
      return NextResponse.json(await diagnose());
    }

    // Bağlantı kuruldu ama webhook aboneliği / geçmiş aktarımı yarım kaldıysa.
    if (action === "finish") {
      await finishSetup();
      return NextResponse.json(getStatus());
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "İşlem başarısız." },
      { status: 500 }
    );
  }
}
