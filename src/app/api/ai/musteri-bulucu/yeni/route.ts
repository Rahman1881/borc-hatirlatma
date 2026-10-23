import { NextRequest, NextResponse } from "next/server";
import {
  getWatchItems,
  getWatchStatus,
  removeIlWatch,
  saveIlWatch,
  setWatchEnabled,
  startScan,
} from "@/lib/prospect-watch";

// Müşteri Bulucu → "Yeni İşletmeler" sekmesi.
// GET  -> takip edilen iller ve tarama durumları, bütün illerin yeni / yakında açılacak işletmeleri
// POST -> action: save (il, türler) | scan (il) | remove (il) | enabled (haftalık açık/kapalı)

export const dynamic = "force-dynamic";

function snapshot() {
  return { ...getWatchStatus(), items: getWatchItems() };
}

export async function GET() {
  try {
    return NextResponse.json(snapshot());
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
    const il = String(body?.il || "");

    if (action === "save") {
      saveIlWatch(il, Array.isArray(body?.profiles) ? body.profiles.map(String) : []);
    } else if (action === "scan") {
      const r = startScan(il, "manual");
      if (!r.started) return NextResponse.json({ error: r.reason }, { status: 409 });
    } else if (action === "remove") {
      removeIlWatch(il);
    } else if (action === "enabled") {
      setWatchEnabled(body?.enabled === true);
    } else {
      return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
    }

    return NextResponse.json(snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "İşlem başarısız." },
      { status: 500 }
    );
  }
}
