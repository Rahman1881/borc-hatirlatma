// Çark Petrol — Telegram Bot İşçisi (worker)
// baslat.bat tarafından sunucuyla (next start) birlikte çalıştırılır.
//
// Görevi:
//  1) Telegram'a long-polling ile bağlanıp gelen mesajlara cevap verir.
//     Cevaplar uygulamanın Gemini sohbet ucundan (/api/ai/chat) üretilir.
//  2) Ayarlar'da tanımlı saatlerde otomatik rapor (gerçek VRD verisi) gönderir.
//
// Token, aboneler ve zamanlama data.db (settings + telegram_chats) içinde tutulur.
// Bu işçi DB'yi doğrudan okur/yazar; rapor ve AI mantığı sunucu tarafında kalır.

import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data.db");
const API_BASE = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
const TG_API = "https://api.telegram.org/bot";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : "";
}
function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    String(value)
  );
}
function getToken() {
  return (getSetting("telegram_bot_token") || "").trim();
}
function rememberChat(chatId, name) {
  db.prepare(
    `INSERT INTO telegram_chats (chat_id, name, last_seen)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`
  ).run(String(chatId), name || "");
}
function enabledChatIds() {
  return db
    .prepare("SELECT chat_id FROM telegram_chats WHERE enabled = 1")
    .all()
    .map((r) => r.chat_id);
}
function getSchedules() {
  const raw = getSetting("telegram_schedules");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function tg(method, payload, timeoutMs = 60000) {
  const token = getToken();
  if (!token) throw new Error("token yok");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${TG_API}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// AI cevaplarındaki Markdown'ı temizler (Telegram HTML modunda ** olduğu gibi
// görünüyordu). Kalın işaretlerini kaldırır, yıldız/tire madde işaretlerini • yapar.
function cleanMarkdown(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, "$1") // **kalın** -> kalın
    .replace(/__(.+?)__/g, "$1") // __kalın__ -> kalın
    .replace(/(^|\n)\s*[*-]\s+/g, "$1• ") // satır başı * / - madde -> •
    .replace(/(^|\n)#{1,6}\s*/g, "$1"); // # başlık işaretleri
}

// parseMode "HTML" ise <b> gibi etiketler işlenir (raporlar); aksi halde düz metin
// gönderilir (AI cevapları — kaçak işaret riski olmaz).
async function sendMessage(chatId, text, parseMode) {
  // Telegram tek mesajda 4096 karakter sınırı koyar; uzun metni böleriz.
  const chunks = [];
  let t = String(text);
  while (t.length > 3900) {
    chunks.push(t.slice(0, 3900));
    t = t.slice(3900);
  }
  chunks.push(t);
  for (const c of chunks) {
    const payload = {
      chat_id: chatId,
      text: c,
      disable_web_page_preview: true,
    };
    if (parseMode) payload.parse_mode = parseMode;
    await tg("sendMessage", payload);
  }
}

async function apiGet(url) {
  const res = await fetch(`${API_BASE}${url}`);
  return res.json();
}
async function apiPost(url, body) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function askAI(question) {
  try {
    const d = await apiPost("/api/ai/chat", {
      messages: [{ role: "user", text: question }],
    });
    if (d.reply) return d.reply;
    return d.error || "Şu an cevap üretemedim.";
  } catch {
    return "Sunucuya ulaşılamadı. İstasyon bilgisayarının açık olduğundan emin olun.";
  }
}

async function fetchReport(type) {
  try {
    const d = await apiGet(`/api/ai/telegram/report?type=${type}`);
    return d.text || "Rapor üretilemedi.";
  } catch {
    return "Rapor üretilemedi (sunucuya ulaşılamadı).";
  }
}

// Günlük haber bültenini (Google Haberler RSS + AI özet) getirir.
async function fetchNews() {
  try {
    const d = await apiGet(`/api/ai/telegram/news`);
    return d.text || "Haber bülteni üretilemedi.";
  } catch {
    return "Haber bülteni üretilemedi (sunucuya ulaşılamadı).";
  }
}

// Rakip akaryakıt fiyat karşılaştırmasını (benzin + motorin, pahalıdan ucuza) getirir.
async function fetchPrices() {
  try {
    const d = await apiGet(`/api/ai/telegram/prices`);
    return d.text || "Rakip fiyat raporu üretilemedi.";
  } catch {
    return "Rakip fiyat raporu üretilemedi (sunucuya ulaşılamadı).";
  }
}

// Yeni düşen vardiyaların raporlarını getirir (eski -> yeni sıralı). Her biri
// gönderildiğinde sunucu tarafında "raporlandı" işaretlenir (tekrar gelmez).
async function fetchPendingShifts() {
  try {
    const d = await apiGet(`/api/ai/telegram/pending-shifts`);
    return Array.isArray(d.shifts) ? d.shifts : [];
  } catch {
    return [];
  }
}

// Konuma en yakın potansiyel müşterileri (veya "devam" ile sonraki partiyi) getirir.
async function fetchNearby(payload) {
  try {
    const d = await apiPost("/api/ai/telegram/nearby", payload);
    return d.text || "Yakın müşteri bulunamadı.";
  } catch {
    return "Yakın müşteri araması yapılamadı (sunucuya ulaşılamadı).";
  }
}

// Telegram'da konum paylaşma butonu gösterir (telefondan tek dokunuş).
async function requestLocation(chatId) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "Konumunu paylaş, sana en yakın 10 potansiyel müşteriyi (numara + harita) bulayım.",
    reply_markup: {
      keyboard: [[{ text: "📍 Konumumu Gönder", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

const WELCOME = `👋 <b>Çark Petrol AI</b>'ya hoş geldiniz!

Bana istasyonla ilgili soru sorabilirsiniz. Örnek:
• "Bugün ciro ne kadar?"
• "En çok hangi yakıt satıldı?"
• "Hangi filo en çok aldı?"

Komutlar:
/rapor — Günlük satış raporu
/hafta — Haftalık rapor
/yakin — Konumuna en yakın potansiyel müşteriler`;

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  const name =
    [msg.chat?.first_name, msg.chat?.last_name].filter(Boolean).join(" ") ||
    msg.chat?.username ||
    msg.chat?.title ||
    "";
  rememberChat(chatId, name);

  // Konum paylaşıldıysa: en yakın potansiyel müşterileri bul ve gönder.
  if (msg.location) {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    const text = await fetchNearby({
      chatId,
      lat: msg.location.latitude,
      lng: msg.location.longitude,
    });
    await sendMessage(chatId, text);
    return;
  }

  const text = (msg.text || "").trim();
  if (!text) return;

  const lower = text.toLocaleLowerCase("tr");
  if (lower === "/start" || lower === "/yardim" || lower === "/help") {
    await sendMessage(chatId, WELCOME, "HTML");
    return;
  }
  if (lower === "/rapor" || lower === "/gunluk" || lower === "/günlük") {
    await sendMessage(chatId, "📊 Günlük rapor hazırlanıyor…");
    await sendMessage(chatId, await fetchReport("daily"), "HTML");
    return;
  }
  if (lower === "/hafta" || lower === "/haftalik" || lower === "/haftalık") {
    await sendMessage(chatId, "📊 Haftalık rapor hazırlanıyor…");
    await sendMessage(chatId, await fetchReport("weekly"), "HTML");
    return;
  }
  if (lower === "/yakin" || lower === "/yakın" || lower === "yakin" || lower === "yakın") {
    await requestLocation(chatId);
    return;
  }
  if (lower === "devam" || lower === "daha" || lower === "/devam") {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    await sendMessage(chatId, await fetchNearby({ chatId, more: true }));
    return;
  }

  // Normal soru → AI (düz metin; markdown temizlenir)
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const reply = await askAI(text);
  await sendMessage(chatId, cleanMarkdown(reply));
}

// --- Long polling döngüsü ---
let polling = false;
async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    if (!getToken()) return; // token henüz girilmemiş
    let offset = parseInt(getSetting("telegram_update_offset") || "0", 10) || 0;
    const data = await tg("getUpdates", { offset, timeout: 50 }, 60000);
    if (!data || !data.ok || !Array.isArray(data.result)) return;
    for (const upd of data.result) {
      offset = upd.update_id + 1;
      setSetting("telegram_update_offset", offset);
      const msg = upd.message || upd.edited_message;
      if (msg) {
        try {
          await handleMessage(msg);
        } catch (e) {
          console.error("[telegram] mesaj işlenemedi:", e?.message || e);
        }
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.error("[telegram] poll hatası:", e?.message || e);
    }
  } finally {
    polling = false;
  }
}

// --- Otomatik rapor zamanlayıcı ---
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function jsWeekday() {
  // 1=Pzt ... 7=Paz
  const d = new Date().getDay(); // 0=Paz
  return d === 0 ? 7 : d;
}

async function schedulerTick() {
  if (!getToken()) return;
  const chats = enabledChatIds();
  if (chats.length === 0) return; // gönderilecek kimse yok
  const hhmm = nowHHMM();
  const today = todayStr();

  for (const s of getSchedules()) {
    if (!s.enabled) continue;
    if (s.time !== hhmm) continue;
    if (s.type === "weekly" && s.weekday && s.weekday !== jsWeekday()) continue;
    const lastKey = `telegram_lastsent_${s.id}`;
    if (getSetting(lastKey) === today) continue; // bugün zaten gönderildi
    // "Gönderildi" damgasını rapor üretilmeden önce bas: rapor üretimi 30 sn'den
    // uzun sürerse sonraki tick aynı raporu ikinci kez göndermesin.
    setSetting(lastKey, today);

    // type: news = haber bülteni, prices = rakip fiyat, weekly = haftalık,
    // daily = önceki gün satış.
    let text;
    if (s.type === "news") text = await fetchNews();
    else if (s.type === "prices") text = await fetchPrices();
    else text = await fetchReport(s.type === "weekly" ? "weekly" : "daily");

    for (const chatId of chats) {
      try {
        await sendMessage(chatId, text, "HTML");
      } catch (e) {
        console.error("[telegram] rapor gönderilemedi:", e?.message || e);
      }
    }
    console.log(`[telegram] '${s.label}' raporu ${chats.length} kişiye gönderildi.`);
  }
}

// Vardiya yoklayıcı: VRD klasörüne yeni vardiya dosyası düştüyse o vardiyanın
// raporunu tüm abonelere gönderir. Olay tabanlı (saate bağlı değil).
async function shiftTick() {
  if (!getToken()) return;
  const chats = enabledChatIds();
  if (chats.length === 0) return;
  const shifts = await fetchPendingShifts();
  if (shifts.length === 0) return;
  for (const sh of shifts) {
    if (!sh?.text) continue;
    for (const chatId of chats) {
      try {
        await sendMessage(chatId, sh.text, "HTML");
      } catch (e) {
        console.error("[telegram] vardiya raporu gönderilemedi:", e?.message || e);
      }
    }
  }
  console.log(`[telegram] ${shifts.length} vardiya raporu ${chats.length} kişiye gönderildi.`);
}

async function main() {
  console.log("[telegram] Bot işçisi başladı. API:", API_BASE);
  // Webhook varsa long-polling çakışır; temizle.
  try {
    await tg("deleteWebhook", { drop_pending_updates: false });
  } catch {
    // token yoksa sorun değil
  }

  // Polling: sürekli; her tur ~50sn long-poll bekler.
  (async function loop() {
    for (;;) {
      await pollLoop();
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  // Zamanlayıcı: her 30 saniyede bir kontrol. Bir tur bitmeden yenisi başlamaz;
  // aksi halde yavaş rapor üretiminde aynı rapor iki kez gönderiliyordu.
  let schedulerBusy = false;
  setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    schedulerTick()
      .catch((e) => console.error("[telegram] zamanlayıcı hatası:", e?.message || e))
      .finally(() => {
        schedulerBusy = false;
      });
  }, 30000);

  // Vardiya yoklayıcı: her 30 saniyede bir yeni vardiya dosyası var mı bakar.
  let shiftBusy = false;
  setInterval(() => {
    if (shiftBusy) return;
    shiftBusy = true;
    shiftTick()
      .catch((e) => console.error("[telegram] vardiya yoklayıcı hatası:", e?.message || e))
      .finally(() => {
        shiftBusy = false;
      });
  }, 30000);
}

main().catch((e) => {
  console.error("[telegram] başlatma hatası:", e?.message || e);
  process.exit(1);
});
