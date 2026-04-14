import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  const db = getDb();
  const templates = db
    .prepare("SELECT * FROM templates ORDER BY created_at DESC")
    .all();
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const { name, body } = await req.json();
  if (!name || !body) {
    return NextResponse.json(
      { error: "İsim ve mesaj içeriği gerekli" },
      { status: 400 }
    );
  }
  const db = getDb();
  const result = db
    .prepare("INSERT INTO templates (name, body) VALUES (?, ?)")
    .run(name, body);
  return NextResponse.json({ id: result.lastInsertRowid, name, body });
}

export async function PUT(req: NextRequest) {
  const { id, name, body } = await req.json();
  if (!id || !name || !body) {
    return NextResponse.json({ error: "Eksik alan" }, { status: 400 });
  }
  const db = getDb();
  db.prepare("UPDATE templates SET name = ?, body = ? WHERE id = ?").run(
    name,
    body,
    id
  );
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const db = getDb();
  // Önce mesajlardaki referansı kaldır, sonra şablonu sil
  db.prepare("UPDATE messages SET template_id = NULL WHERE template_id = ?").run(id);
  db.prepare("DELETE FROM templates WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
