import { NextRequest, NextResponse } from "next/server";
import {
  createConnection,
  deleteConnection,
  HISTORY_MAX_DAYS,
  listConnections,
  previewFleets,
  selectableFleets,
  sendConnection,
  setConnectionActive,
  testKey,
  testStoredKey,
  updateConnection,
} from "@/lib/rotanet";

// Yakıt Ofisi → RotaNet bağlantıları. Anahtarın tamamı hiçbir zaman geri döndürülmez.
//  GET              → { baglantilar, gecmisGun }
//  GET ?filolar=1   → { filolar }  (bağlantıya seçilebilecek Yakıt Ofisi filoları)
//  POST { action }:
//    sina     { anahtar } | { id }      → anahtarı boş istekle sınar, şirket adını döndürür
//    onizle   { filoIds }               → seçilen filoların son 30 gündeki alım sayısı ve plakaları
//    ekle     { anahtar, filoIds }
//    guncelle { id, anahtar?, filoIds? }
//    durum    { id, etkin }
//    sil      { id }
//    gonder   { id, deneme? }           → son 3 gün
//    gecmis   { id, from, to, deneme? } → tarih aralığı (en çok 90 gün)

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("filolar")) return NextResponse.json({ filolar: await selectableFleets() });
    return NextResponse.json({ baglantilar: listConnections(), gecmisGun: HISTORY_MAX_DAYS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Veri alınamadı." }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = Number(body.id);
    let extra: Record<string, unknown> = {};
    switch (body.action) {
      case "sina":
        extra = body.id !== undefined ? await testStoredKey(id) : await testKey(body.anahtar);
        break;
      case "onizle":
        extra = { onizleme: await previewFleets(body.filoIds) };
        break;
      case "ekle":
        extra = { id: await createConnection(body) };
        break;
      case "guncelle":
        await updateConnection(id, body);
        break;
      case "durum":
        setConnectionActive(id, body.etkin === true);
        break;
      case "sil":
        deleteConnection(id);
        break;
      case "gonder":
        extra = { sonuc: await sendConnection(id, { tur: "elle", dryRun: body.deneme === true }) };
        break;
      case "gecmis":
        extra = { sonuc: await sendConnection(id, { tur: "gecmis", from: body.from, to: body.to, dryRun: body.deneme === true }) };
        break;
      default:
        return NextResponse.json({ error: "Bilinmeyen işlem." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...extra, baglantilar: listConnections() });
  } catch (e) {
    // Hata olsa da bağlantıların güncel durumu ("son hata", "anahtar geçersiz") ekrana yansısın.
    return NextResponse.json({ error: e instanceof Error ? e.message : "İşlem yapılamadı.", baglantilar: listConnections() }, { status: 400 });
  }
}
