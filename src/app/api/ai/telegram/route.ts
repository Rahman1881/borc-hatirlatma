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
  sendMessage,
  isShiftReportEnabled,
  setShiftReportEnabled,
  type ReportSchedule,
} from "@/lib/telegram";
import { buildReport, buildShiftReport } from "@/lib/station-report";
import { getCalendar } from "@/lib/vrd-sales";
import { buildNewsReport } from "@/lib/news";
import { buildPriceReport } from "@/lib/price-report";

export const maxDuration = 60;

// Bir rapor türü için metni sunucu tarafında üretir (manuel gönderim için).
async function buildReportText(report: string): Promise<{ ok: boolean; text: string }> {
  if (report === "news") return buildNewsReport();
  if (report === "prices") return buildPriceReport();
  if (report === "weekly") return buildReport("weekly");
  if (report === "daily") return buildReport("daily");
  if (report === "vardiya") {
    const calendar = getCalendar();
    const day = calendar[0];
    const file = day?.vardiyalar?.[day.vardiyalar.length - 1]?.file;
    if (!file) return { ok: false, text: "Henüz vardiya satış verisi yok." };
    return buildShiftReport(file);
  }
  return { ok: false, text: "Geçersiz rapor türü." };
}

type LeadLite = {
  name?: string;
  phone?: string;
  address?: string;
  mapsUrl?: string;
  lat?: number | null;
  lng?: number | null;
};

function leadMapsUrl(l: LeadLite): string {
  if (l.mapsUrl) return l.mapsUrl;
  if (l.lat != null && l.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
  }
  return "";
}

// Müşteri Bulucu sonuçlarını /yakin biçiminde (numara + telefon + konum + harita)
// metne döker; Telegram 4096 karakter sınırına göre birden çok mesaja böler.
function formatLeadsChunks(leads: LeadLite[], region: string): string[] {
  const header = `📋 <b>Potansiyel Müşteri Listesi</b>${
    region ? ` — ${region}` : ""
  }\n${leads.length} işletme\n`;

  const blocks = leads.map((l, i) => {
    const phone = l.phone ? `📞 ${l.phone}` : "📞 telefon yok";
    const parts = [`${i + 1}. ${l.name || "İsimsiz işletme"}`, `   ${phone}`];
    if (l.address) parts.push(`   📍 ${l.address}`);
    const map = leadMapsUrl(l);
    if (map) parts.push(`   🗺 ${map}`);
    return parts.join("\n");
  });

  const chunks: string[] = [];
  let cur = header;
  for (const b of blocks) {
    if (cur.length + b.length + 2 > 3800) {
      if (cur.trim()) chunks.push(cur.trimEnd());
      cur = "";
    }
    cur += `\n${b}\n`;
  }
  if (cur.trim()) chunks.push(cur.trimEnd());
  return chunks;
}

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
    vardiyaEnabled: isShiftReportEnabled(),
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

    if (action === "vardiya") {
      setShiftReportEnabled(Boolean(body.enabled));
      return NextResponse.json({
        success: true,
        vardiyaEnabled: isShiftReportEnabled(),
      });
    }

    if (action === "send") {
      if (!isTelegramConfigured()) {
        return NextResponse.json(
          { error: "Önce bot token girin." },
          { status: 400 }
        );
      }
      const result = await buildReportText(String(body.report || ""));
      if (!result.ok) {
        return NextResponse.json({ error: result.text }, { status: 400 });
      }
      const { sent, failed } = await broadcast(result.text);
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

    if (action === "send-leads") {
      if (!isTelegramConfigured()) {
        return NextResponse.json(
          { error: "Önce bot token girin." },
          { status: 400 }
        );
      }
      const chatId = String(body.chatId || "");
      if (!chatId) {
        return NextResponse.json({ error: "Alıcı seçin." }, { status: 400 });
      }
      // Yalnızca bilinen (bota yazmış) abonelere gönderilebilir.
      if (!listChats().some((c) => c.chatId === chatId)) {
        return NextResponse.json({ error: "Geçersiz alıcı." }, { status: 400 });
      }
      const leads = Array.isArray(body.leads) ? (body.leads as LeadLite[]) : [];
      if (leads.length === 0) {
        return NextResponse.json(
          { error: "Gönderilecek sonuç yok." },
          { status: 400 }
        );
      }
      const region = String(body.region || "");
      const chunks = formatLeadsChunks(leads, region);
      let sent = 0;
      for (const text of chunks) {
        try {
          await sendMessage(chatId, text);
          sent++;
        } catch {
          // bir parça gidemezse diğerlerini denemeye devam et
        }
      }
      if (sent === 0) {
        return NextResponse.json(
          { error: "Mesaj gönderilemedi." },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, chunks: chunks.length, sent });
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
