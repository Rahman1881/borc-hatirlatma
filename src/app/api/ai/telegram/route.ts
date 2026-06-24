import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  getTelegramToken,
  isTelegramConfigured,
  getMe,
  listChats,
  getSchedules,
  saveSchedules,
  broadcast,
  type ReportSchedule,
} from "@/lib/telegram";

function mask(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

async function buildStatus() {
  const token = getTelegramToken();
  let botUsername = "";
  let botError = "";
  if (token) {
    try {
      const me = await getMe(token);
      botUsername = me.username;
    } catch (err) {
      botError = err instanceof Error ? err.message : "Bot doğrulanamadı.";
    }
  }
  return {
    configured: token.length > 0,
    masked: mask(token),
    botUsername,
    botError,
    chats: listChats(),
    schedules: getSchedules(),
  };
}

export async function GET() {
  return NextResponse.json(await buildStatus());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    const action = String(body.action || "");

    if (action === "save") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (token.length > 0) {
        // Token'ı doğrula; geçersizse kaydetme.
        await getMe(token);
        db.prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
        ).run("telegram_bot_token", token);
      } else {
        db.prepare("DELETE FROM settings WHERE key = ?").run("telegram_bot_token");
      }
      return NextResponse.json({ success: true, ...(await buildStatus()) });
    }

    if (action === "schedules") {
      const schedules = Array.isArray(body.schedules)
        ? (body.schedules as ReportSchedule[])
        : [];
      saveSchedules(schedules);
      return NextResponse.json({ success: true, schedules: getSchedules() });
    }

    if (action === "test") {
      if (!isTelegramConfigured()) {
        return NextResponse.json(
          { error: "Önce bot token girin." },
          { status: 400 }
        );
      }
      const { sent, failed } = await broadcast(
        "✅ Çark Petrol AI — Telegram bağlantısı çalışıyor. Bu bir test mesajıdır."
      );
      if (sent === 0) {
        return NextResponse.json({
          success: true,
          sent,
          failed,
          note: "Henüz bota yazan kimse yok. Patron bota /start yazınca abone olur.",
        });
      }
      return NextResponse.json({ success: true, sent, failed });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
