import getDb from "@/lib/db";

// Telegram Bot entegrasyonu. Bot token'ı Ayarlar'dan (settings tablosu) gelir.
// Mesajlaşma long-polling ile ayrı bir işçi (telegram-bot.mjs) tarafından yapılır;
// bu dosya uygulama tarafının (Ayarlar, test, rapor gönderimi) ihtiyaç duyduğu
// yardımcıları içerir.

const API_BASE = "https://api.telegram.org/bot";
const REQUEST_TIMEOUT_MS = 15_000;

export type TelegramChat = {
  chatId: string;
  name: string;
  enabled: boolean;
  firstSeen: string;
  lastSeen: string;
};

// Otomatik rapor zamanlaması. time "HH:MM" 24 saat; weekday boşsa her gün,
// 1-7 (Pzt-Paz) ise sadece o gün gönderilir.
// type: daily = önceki günün satış özeti, weekly = haftalık, news = haber bülteni.
export type ReportSchedule = {
  id: string;
  label: string;
  type: "daily" | "weekly" | "news";
  time: string; // "09:30"
  weekday: number | null; // 1-7 (Pzt=1) ya da null=her gün
  enabled: boolean;
};

export const DEFAULT_SCHEDULES: ReportSchedule[] = [
  {
    id: "gunluk_satis",
    label: "Günlük Satış Raporu (önceki gün)",
    type: "daily",
    time: "09:30",
    weekday: null,
    enabled: true,
  },
  {
    id: "haberler",
    label: "Günlük Petrol & Akaryakıt Bülteni",
    type: "news",
    time: "10:00",
    weekday: null,
    enabled: true,
  },
  {
    id: "haftalik",
    label: "Haftalık Performans",
    type: "weekly",
    time: "09:00",
    weekday: 1,
    enabled: false,
  },
];

// Vardiya raporları olay tabanlıdır (zamana değil, yeni dosyaya bağlı). Bu yüzden
// ayrı bir aç/kapa anahtarıyla yönetilir (varsayılan açık).
export function isShiftReportEnabled(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("telegram_vardiya_enabled") as { value: string } | undefined;
  return row?.value !== "0"; // tanımlı değilse açık kabul et
}

export function setShiftReportEnabled(enabled: boolean): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run("telegram_vardiya_enabled", enabled ? "1" : "0");
}

export function getTelegramToken(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("telegram_bot_token") as { value: string } | undefined;
  return (row?.value || process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

export function isTelegramConfigured(): boolean {
  return getTelegramToken().length > 0;
}

// Zamanlama yapısı değiştikçe artırılır. Kayıtlı sürüm bundan eskiyse, eski
// zamanlamalar (ör. "Sabah Brifingi", "Kapanış") yeni varsayılanlarla değiştirilir.
const SCHEDULES_VERSION = "2";

export function getSchedules(): ReportSchedule[] {
  const db = getDb();
  const verRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("telegram_schedules_version") as { value: string } | undefined;

  // Sürüm eski/yoksa: yeni varsayılanlara geçir (tek seferlik).
  if ((verRow?.value || "") !== SCHEDULES_VERSION) {
    saveSchedules(DEFAULT_SCHEDULES);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "telegram_schedules_version",
      SCHEDULES_VERSION
    );
    return DEFAULT_SCHEDULES;
  }

  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("telegram_schedules") as { value: string } | undefined;
  if (!row?.value) return DEFAULT_SCHEDULES;
  try {
    const parsed = JSON.parse(row.value) as ReportSchedule[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // bozuksa varsayılana dön
  }
  return DEFAULT_SCHEDULES;
}

export function saveSchedules(schedules: ReportSchedule[]): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  ).run("telegram_schedules", JSON.stringify(schedules));
}

export function listChats(): TelegramChat[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT chat_id, name, enabled, first_seen, last_seen FROM telegram_chats ORDER BY first_seen ASC"
    )
    .all() as {
    chat_id: string;
    name: string;
    enabled: number;
    first_seen: string;
    last_seen: string;
  }[];
  return rows.map((r) => ({
    chatId: r.chat_id,
    name: r.name || "",
    enabled: r.enabled === 1,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}

// Bota yazan bir kişiyi abone listesine ekler/günceller (worker kullanır).
export function rememberChat(chatId: string | number, name: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO telegram_chats (chat_id, name, last_seen)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`
  ).run(String(chatId), name);
}

async function tgFetch(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
    if (!data.ok) {
      throw new Error(data.description || `Telegram ${method} başarısız.`);
    }
    return data.result;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Telegram isteği zaman aşımına uğradı.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Bot bilgisi (kullanıcı adı vb.) — token doğrulamak için.
export async function getMe(
  token = getTelegramToken()
): Promise<{ id: number; username: string; firstName: string }> {
  if (!token) throw new Error("Telegram bot token tanımlı değil.");
  const r = (await tgFetch(token, "getMe", {})) as {
    id: number;
    username: string;
    first_name: string;
  };
  return { id: r.id, username: r.username, firstName: r.first_name };
}

// Tek bir chat'e mesaj gönderir.
export async function sendMessage(
  chatId: string | number,
  text: string,
  token = getTelegramToken()
): Promise<void> {
  if (!token) throw new Error("Telegram bot token tanımlı değil.");
  await tgFetch(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// enabled olan tüm abonelere mesaj yollar; sonuç sayısını döndürür.
export async function broadcast(
  text: string,
  token = getTelegramToken()
): Promise<{ sent: number; failed: number }> {
  const chats = listChats().filter((c) => c.enabled);
  let sent = 0;
  let failed = 0;
  for (const c of chats) {
    try {
      await sendMessage(c.chatId, text, token);
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
