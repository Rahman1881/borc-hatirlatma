import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";

const LOGO_PATH = path.join(process.cwd(), "data", "logo-sirket.png");

export type WAStatus = "disconnected" | "qr" | "loading" | "ready";

interface WAState {
  status: WAStatus;
  qrDataUrl: string | null;
  info: { pushname: string; wid: string } | null;
}

// client ve state, Next.js rota bundle'ları ve hot-reload arasında paylaşılmalı.
// Modül seviyesi `let` her rota kopyasında ayrı olurdu; bu yüzden tek bir global
// singleton'da tutuyoruz ki bağlanan rota (/api/whatsapp) ile mesaj gönderen rota
// (/api/messages) AYNI istemciyi görsün. Aksi halde durum "bağlı" görünürken
// gönderim rotası client'ı null bulup "WhatsApp bağlı değil" hatası verir.
type WAStore = {
  client: Client | null;
  state: WAState;
  // "loading" zaman aşımı sayacı; yeniden başlatınca eskisini iptal edebilmek için
  // global store'da tutulur (modül seviyesi `let` hot-reload'da çoğalırdı).
  loadingTimer: ReturnType<typeof setTimeout> | null;
  // Mevcut "loading" ne zaman başladı; taze bir denemeyi askıda kalmıştan ayırır.
  loadingStartedAt: number;
};

const globalForWA = globalThis as unknown as { __waStore?: WAStore };
const store: WAStore =
  globalForWA.__waStore ??
  (globalForWA.__waStore = {
    client: null,
    state: { status: "disconnected", qrDataUrl: null, info: null },
    loadingTimer: null,
    loadingStartedAt: 0,
  });

function getSessionPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

export function getWAState(): WAState {
  return { ...store.state };
}

// whatsapp-web.js, arkadaki Chrome sayfası ölse bile durumu "ready" bırakabiliyor.
// Gerçek canlılık ölçütü Puppeteer sayfasının hâlâ açık olması.
function isSessionAlive(): boolean {
  const client = store.client;
  if (!client || store.state.status !== "ready") return false;
  const page = client.pupPage;
  if (!page) return false;
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

// Mevcut client'ı (varsa) güvenle kapatır ve store'u temizler. destroy() askıda
// kalabildiği için timeout ile yarıştırılır. deleteSession=true ise diskteki
// (bozuk olabilecek) oturum dosyaları da silinir ki sonraki bağlanma taze QR üretsin.
async function teardownClient(deleteSession = false): Promise<void> {
  if (store.loadingTimer) {
    clearTimeout(store.loadingTimer);
    store.loadingTimer = null;
  }
  const c = store.client;
  store.client = null;
  if (c) {
    try {
      await Promise.race([c.destroy(), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
      /* destroy hatası önemsiz */
    }
  }
  if (deleteSession) {
    try {
      const sessionPath = getSessionPath();
      if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch {
      /* dosya silme hatası önemsiz */
    }
  }
}

export async function initWhatsApp(): Promise<void> {
  // Zaten sağlıklı bir durum varsa dokunma:
  if (store.client) {
    // Aktif QR bekleniyor — kullanıcı okutmak üzere.
    if (store.state.status === "qr") return;
    // Bağlı ve arkadaki sayfa hâlâ canlı.
    if (store.state.status === "ready" && isSessionAlive()) return;
    // Yeni başlamış bir "loading" (15 sn içinde) — çalışmasına izin ver.
    if (store.state.status === "loading" && Date.now() - store.loadingStartedAt < 15000) return;
    // Aksi halde: zombi / askıda kalmış client. Temizleyip taze başlıyoruz.
    await teardownClient();
  }

  store.state = { status: "loading", qrDataUrl: null, info: null };
  store.loadingStartedAt = Date.now();

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: getSessionPath() }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    },
  });
  store.client = client;

  // Bu client hâlâ güncel mi? Eski bir client'ın geç gelen olayları taze client'ı
  // ezmesin diye her dinleyicide kontrol edilir.
  const isCurrent = () => store.client === client;

  // 90 saniye içinde ready/qr gelmezse oturumu sil ve sıfırla.
  store.loadingTimer = setTimeout(async () => {
    if (isCurrent() && store.state.status === "loading") {
      await teardownClient(true);
      store.state = { status: "disconnected", qrDataUrl: null, info: null };
    }
  }, 90000);

  client.on("qr", async (qr: string) => {
    if (!isCurrent()) return;
    if (store.loadingTimer) {
      clearTimeout(store.loadingTimer);
      store.loadingTimer = null;
    }
    const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
    if (!isCurrent()) return;
    store.state = { status: "qr", qrDataUrl: dataUrl, info: null };
  });

  client.on("loading_screen", () => {
    if (!isCurrent()) return;
    store.state = { ...store.state, status: "loading" };
  });

  client.on("ready", () => {
    if (!isCurrent()) return;
    if (store.loadingTimer) {
      clearTimeout(store.loadingTimer);
      store.loadingTimer = null;
    }
    const info = client.info;
    store.state = {
      status: "ready",
      qrDataUrl: null,
      info: info ? { pushname: info.pushname, wid: info.wid._serialized } : null,
    };
  });

  client.on("authenticated", () => {
    if (!isCurrent()) return;
    store.state = { ...store.state, status: "loading" };
  });

  client.on("auth_failure", async () => {
    if (!isCurrent()) return;
    await teardownClient(true); // bozuk oturumu sil
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
  });

  client.on("disconnected", async () => {
    if (!isCurrent()) return;
    await teardownClient();
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
  });

  // initialize() kendisi reddedebilir (bozuk oturum, Chrome açılmaması vb.);
  // yakalanmazsa durum sonsuza dek "loading"de asılı kalırdı.
  client.initialize().catch(async () => {
    if (!isCurrent()) return;
    await teardownClient(true);
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
  });
}

export async function disconnectWhatsApp(): Promise<void> {
  // Önce state'i hemen güncelle ki panel anında "Bağlı Değil" göstersin.
  store.state = { status: "disconnected", qrDataUrl: null, info: null };
  // Client'ı kapat + oturum dosyalarını sil (tekrar bağlanınca yeni QR çıksın).
  await teardownClient(true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const DISCONNECTED_MESSAGE =
  "WhatsApp bağlantısı koptu. Ayarlar'dan yeniden bağlanın.";

// Oturumun öldüğünü anladığımızda durumu düşürüyoruz ki panel "Bağlı" göstermeye
// devam etmesin ve kullanıcı yeniden bağlanabilsin.
function markSessionDead(): void {
  store.state = { status: "disconnected", qrDataUrl: null, info: null };
  store.client = null;
}

// Oturum tamamen koptuğunda dönen hatalar. Bunlar tek bir numaraya özgü
// değildir; listenin kalanını denemek aynı hatayı tekrarlamaktan ibaret olur.
const DEAD_SESSION_PATTERNS = [
  "reading 'evaluate'",
  "session closed",
  "target closed",
  "protocol error",
  "execution context was destroyed",
  "browser has disconnected",
  "page has been closed",
];

function isDeadSessionError(message: string): boolean {
  const lower = message.toLowerCase();
  return DEAD_SESSION_PATTERNS.some((pattern) => lower.includes(pattern));
}

export async function sendWhatsAppMessage(
  phone: string,
  body: string
): Promise<{ success: boolean; error?: string; disconnected?: boolean }> {
  const client = store.client;
  if (!client || store.state.status !== "ready") {
    return {
      success: false,
      error: "WhatsApp bağlı değil. Lütfen önce bağlanın.",
      disconnected: true,
    };
  }

  // Göndermeden önce oturumun gerçekten yaşadığını doğrula.
  if (!isSessionAlive()) {
    markSessionDead();
    return { success: false, error: DISCONNECTED_MESSAGE, disconnected: true };
  }

  try {
    let chatId = phone.replace(/\D/g, "");
    if (!chatId.endsWith("@c.us")) {
      chatId = `${chatId}@c.us`;
    }

    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      return { success: false, error: "Bu numara WhatsApp kullanmıyor" };
    }

    // Logo varsa resim + caption olarak gönder, yoksa sadece metin
    if (fs.existsSync(LOGO_PATH)) {
      const media = MessageMedia.fromFilePath(LOGO_PATH);
      await client.sendMessage(chatId, media, { caption: body });
    } else {
      await client.sendMessage(chatId, body);
    }

    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Bilinmeyen hata";
    // Oturum çöktüyse ham Puppeteer hatasını göstermek yerine ne olduğunu söyle.
    if (isDeadSessionError(error) || !isSessionAlive()) {
      markSessionDead();
      return { success: false, error: DISCONNECTED_MESSAGE, disconnected: true };
    }
    return { success: false, error };
  }
}

export async function sendBulkMessages(
  messages: { phone: string; body: string; customerId: number; customerName: string }[],
  onProgress?: (result: {
    customerId: number;
    customerName: string;
    status: string;
    error?: string;
    index: number;
    total: number;
  }) => void
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const result = await sendWhatsAppMessage(msg.phone, msg.body);

    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    onProgress?.({
      customerId: msg.customerId,
      customerName: msg.customerName,
      status: result.success ? "sent" : "failed",
      error: result.error,
      index: i + 1,
      total: messages.length,
    });

    // Bağlantı koptuysa kalanları denemek aynı hatayı yüzlerce kez tekrarlamaktan
    // ibaret. Kalanları "gönderilmedi" diye kaydedip çıkıyoruz; böylece geçmiş
    // kaydı kimin gerçekten denendiğini, kimin hiç denenmediğini doğru gösterir.
    if (result.disconnected) {
      for (let j = i + 1; j < messages.length; j++) {
        const skipped = messages[j];
        failed++;
        onProgress?.({
          customerId: skipped.customerId,
          customerName: skipped.customerName,
          status: "failed",
          error: "Bağlantı koptuğu için gönderilmedi",
          index: j + 1,
          total: messages.length,
        });
      }
      break;
    }

    // Random delay between 8-15 seconds to avoid ban
    if (i < messages.length - 1) {
      await sleep(randomDelay(8000, 15000));
    }
  }

  return { sent, failed };
}

export function fillTemplate(
  template: string,
  data: {
    name: string;
    totalDebt: number;
    overdueDebt: number;
    toplamAlacak?: number;
    tarihliBakiye?: number;
    sonDurum?: number;
    toplamRisk?: number;
    rawData?: Record<string, string | number | null>;
  }
): string {
  // First apply legacy hardcoded variables
  let result = template
    .replace(/{isim}/g, data.name)
    .replace(/{tutar}/g, formatMoney(data.totalDebt))
    .replace(/{vadeli_borc}/g, formatMoney(data.overdueDebt))
    .replace(/{toplam_alacak}/g, formatMoney(data.toplamAlacak ?? 0))
    .replace(/{tarihli_bakiye}/g, formatMoney(data.tarihliBakiye ?? 0))
    .replace(/{son_durum}/g, formatMoney(data.sonDurum ?? 0))
    .replace(/{toplam_risk}/g, formatMoney(data.toplamRisk ?? 0));

  // Then apply dynamic variables from raw Excel data
  if (data.rawData) {
    result = result.replace(/\{(.+?)\}/g, (match, key) => {
      const val = data.rawData![key];
      if (val === null || val === undefined) return match;
      if (typeof val === "number") return formatMoney(val);
      return String(val);
    });
  }

  return result;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
