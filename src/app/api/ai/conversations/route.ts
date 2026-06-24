import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

// AI Asistan sohbet geçmişi. Sohbetler artık sunucudaki SQLite'ta tutulur
// (eski localStorage yerine) — 7/24 açık bilgisayarda kalıcı ve cihazdan bağımsız.
//
// GET  /api/ai/conversations           -> son 20 sohbetin listesi
// GET  /api/ai/conversations?id=N      -> tek sohbet + mesajları
// POST /api/ai/conversations           -> { action: "create" | "append" | "delete" | "rename" }

type ConvRow = { id: number; title: string; updated_at: string };
type MsgRow = { role: string; text: string };

// İlk kullanıcı mesajından kısa bir başlık üretir.
function makeTitle(text: string): string {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (!t) return "Yeni Sohbet";
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const idParam = req.nextUrl.searchParams.get("id");

    if (idParam) {
      const id = parseInt(idParam, 10);
      const conv = db
        .prepare("SELECT id, title, updated_at FROM ai_conversations WHERE id = ?")
        .get(id) as ConvRow | undefined;
      if (!conv) {
        return NextResponse.json({ error: "Sohbet bulunamadı." }, { status: 404 });
      }
      const messages = db
        .prepare(
          "SELECT role, text FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC"
        )
        .all(id) as MsgRow[];
      return NextResponse.json({ conversation: conv, messages });
    }

    const conversations = db
      .prepare(
        "SELECT id, title, updated_at FROM ai_conversations ORDER BY updated_at DESC, id DESC LIMIT 20"
      )
      .all() as ConvRow[];
    return NextResponse.json({ conversations });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sohbetler okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const db = getDb();

    if (action === "create") {
      const info = db
        .prepare("INSERT INTO ai_conversations (title) VALUES (?)")
        .run("Yeni Sohbet");
      return NextResponse.json({ id: Number(info.lastInsertRowid) });
    }

    if (action === "append") {
      const id = parseInt(String(body?.id), 10);
      const role = body?.role === "ai" ? "ai" : "user";
      const text = String(body?.text ?? "");
      if (!id || !text) {
        return NextResponse.json({ error: "Eksik veri." }, { status: 400 });
      }
      const conv = db
        .prepare("SELECT id, title FROM ai_conversations WHERE id = ?")
        .get(id) as { id: number; title: string } | undefined;
      if (!conv) {
        return NextResponse.json({ error: "Sohbet bulunamadı." }, { status: 404 });
      }

      db.prepare(
        "INSERT INTO ai_messages (conversation_id, role, text) VALUES (?, ?, ?)"
      ).run(id, role, text);

      // İlk kullanıcı mesajı başlığı oluşturur; her mesaj updated_at'i tazeler.
      let title = conv.title;
      if (role === "user" && (conv.title === "Yeni Sohbet" || !conv.title)) {
        title = makeTitle(text);
        db.prepare("UPDATE ai_conversations SET title = ? WHERE id = ?").run(
          title,
          id
        );
      }
      db.prepare(
        "UPDATE ai_conversations SET updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id);

      return NextResponse.json({ ok: true, title });
    }

    if (action === "rename") {
      const id = parseInt(String(body?.id), 10);
      const title = makeTitle(String(body?.title ?? ""));
      if (!id) return NextResponse.json({ error: "Eksik veri." }, { status: 400 });
      db.prepare("UPDATE ai_conversations SET title = ? WHERE id = ?").run(title, id);
      return NextResponse.json({ ok: true, title });
    }

    if (action === "delete") {
      const id = parseInt(String(body?.id), 10);
      if (!id) return NextResponse.json({ error: "Eksik veri." }, { status: 400 });
      db.prepare("DELETE FROM ai_conversations WHERE id = ?").run(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
