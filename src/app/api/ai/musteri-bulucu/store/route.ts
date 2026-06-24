import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

// Müşteri Bulucu kalıcı verisi (kayıtlı müşteriler + geçmiş taramalar).
// Önceden localStorage'daydı; 7/24 açık sunucuya geçince SQLite'a taşındı.
// Geçici tarama sonuçları (RESULTS_KEY) hâlâ tarayıcıda tutulur — kalıcı değildir.
//
// GET  /api/ai/musteri-bulucu/store  -> { saved, history }
// POST /api/ai/musteri-bulucu/store  -> action: save | removeSaved | updateSaved
//                                                addHistory | removeHistory

const HISTORY_LIMIT = 30;

type Row = { data: string };

export async function GET() {
  try {
    const db = getDb();
    const savedRows = db
      .prepare("SELECT data FROM musteri_saved ORDER BY saved_at DESC")
      .all() as Row[];
    const historyRows = db
      .prepare("SELECT data FROM musteri_history ORDER BY scanned_at DESC")
      .all() as Row[];

    const saved = savedRows.map((r) => JSON.parse(r.data));
    const history = historyRows.map((r) => JSON.parse(r.data));
    return NextResponse.json({ saved, history });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Veri okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const db = getDb();

    if (action === "save") {
      const c = body?.customer;
      if (!c || typeof c.id !== "string") {
        return NextResponse.json({ error: "Geçersiz müşteri." }, { status: 400 });
      }
      const savedAt = typeof c.savedAt === "number" ? c.savedAt : Date.now();
      db.prepare(
        "INSERT OR REPLACE INTO musteri_saved (id, saved_at, data) VALUES (?, ?, ?)"
      ).run(c.id, savedAt, JSON.stringify(c));
      return NextResponse.json({ ok: true });
    }

    if (action === "removeSaved") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Eksik id." }, { status: 400 });
      db.prepare("DELETE FROM musteri_saved WHERE id = ?").run(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "updateSaved") {
      const id = String(body?.id ?? "");
      const patch = body?.patch;
      if (!id || !patch || typeof patch !== "object") {
        return NextResponse.json({ error: "Eksik veri." }, { status: 400 });
      }
      const row = db
        .prepare("SELECT data FROM musteri_saved WHERE id = ?")
        .get(id) as Row | undefined;
      if (!row) {
        return NextResponse.json({ error: "Müşteri bulunamadı." }, { status: 404 });
      }
      const merged = { ...JSON.parse(row.data), ...patch, id };
      db.prepare("UPDATE musteri_saved SET data = ? WHERE id = ?").run(
        JSON.stringify(merged),
        id
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "addHistory") {
      const e = body?.entry;
      if (!e || typeof e.id !== "string") {
        return NextResponse.json({ error: "Geçersiz kayıt." }, { status: 400 });
      }
      const scannedAt = typeof e.scannedAt === "number" ? e.scannedAt : Date.now();
      db.prepare(
        "INSERT OR REPLACE INTO musteri_history (id, scanned_at, data) VALUES (?, ?, ?)"
      ).run(e.id, scannedAt, JSON.stringify(e));
      // En yeni HISTORY_LIMIT kaydı tut, fazlasını sil.
      db.prepare(
        `DELETE FROM musteri_history WHERE id NOT IN (
           SELECT id FROM musteri_history ORDER BY scanned_at DESC LIMIT ?
         )`
      ).run(HISTORY_LIMIT);
      return NextResponse.json({ ok: true });
    }

    if (action === "removeHistory") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Eksik id." }, { status: 400 });
      db.prepare("DELETE FROM musteri_history WHERE id = ?").run(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
