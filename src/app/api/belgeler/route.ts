import { NextRequest, NextResponse } from "next/server";
import {
  deleteBelge,
  deleteDosya,
  deleteVarlik,
  dueReminders,
  getHatirlatmaAyar,
  listBelgeler,
  listVarliklar,
  saveBelge,
  saveHatirlatmaAyar,
  saveVarlik,
  sendReminders,
  todayIso,
} from "@/lib/belgeler";
import { isTelegramConfigured, listChats } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function snapshot() {
  return {
    bugun: todayIso(),
    varliklar: listVarliklar(),
    belgeler: listBelgeler(),
    ayar: getHatirlatmaAyar(),
    telegram: isTelegramConfigured(),
    abone: listChats().filter((c) => c.allowed && c.enabled).length,
    // Bugün gönderilecek (henüz bildirilmemiş) hatırlatmalar; ayarlar sayfasında önizleme.
    bekleyen: dueReminders().map((d) => ({ id: d.belge.id, sahip: d.sahip, tur: d.belge.tur, kalan: d.kalan })),
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    let id: number | undefined;
    switch (body.action) {
      case "belge":
        id = saveBelge(body);
        break;
      case "belgeSil":
        deleteBelge(Number(body.id));
        break;
      case "varlik":
        id = saveVarlik(body);
        break;
      case "varlikSil":
        deleteVarlik(Number(body.id));
        break;
      case "dosyaSil":
        deleteDosya(Number(body.id));
        break;
      case "ayar":
        saveHatirlatmaAyar(body);
        break;
      case "gonder":
        // Ayarlar sayfasındaki "Şimdi gönder": bekleyen hatırlatmaları hemen yollar.
        if ((await sendReminders()) === 0) throw new Error("Hatırlatma gönderilemedi. Telegram ayarlarını ve aboneleri kontrol edin.");
        break;
      default:
        return NextResponse.json({ error: "Bilinmeyen işlem." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id, ...snapshot() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "İşlem yapılamadı." }, { status: 400 });
  }
}
