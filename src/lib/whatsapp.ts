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

let client: Client | null = null;
let state: WAState = {
  status: "disconnected",
  qrDataUrl: null,
  info: null,
};

function getSessionPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

export function getWAState(): WAState {
  return { ...state };
}

export function initWhatsApp(): void {
  if (client) return;

  state = { status: "loading", qrDataUrl: null, info: null };

  client = new Client({
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

  // 90 saniye içinde ready/qr gelmezse oturumu sil ve sıfırla
  const loadingTimeout = setTimeout(async () => {
    if (state.status === "loading") {
      const sessionPath = getSessionPath();
      const c = client;
      client = null;
      state = { status: "disconnected", qrDataUrl: null, info: null };
      try { await Promise.race([c?.destroy(), new Promise(r => setTimeout(r, 5000))]); } catch { /* ignore */ }
      try { if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, 90000);

  client.on("qr", async (qr: string) => {
    clearTimeout(loadingTimeout);
    const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
    state = { status: "qr", qrDataUrl: dataUrl, info: null };
  });

  client.on("loading_screen", () => {
    state = { ...state, status: "loading" };
  });

  client.on("ready", () => {
    clearTimeout(loadingTimeout);
    const info = client?.info;
    state = {
      status: "ready",
      qrDataUrl: null,
      info: info
        ? { pushname: info.pushname, wid: info.wid._serialized }
        : null,
    };
  });

  client.on("authenticated", () => {
    state = { ...state, status: "loading" };
  });

  client.on("auth_failure", () => {
    clearTimeout(loadingTimeout);
    state = { status: "disconnected", qrDataUrl: null, info: null };
    client = null;
    // Bozuk oturumu sil
    try { fs.rmSync(getSessionPath(), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  client.on("disconnected", () => {
    clearTimeout(loadingTimeout);
    state = { status: "disconnected", qrDataUrl: null, info: null };
    client = null;
  });

  client.initialize();
}

export async function disconnectWhatsApp(): Promise<void> {
  const sessionPath = getSessionPath();

  // Önce state'i hemen güncelle
  state = { status: "disconnected", qrDataUrl: null, info: null };

  if (client) {
    const c = client;
    client = null;

    try {
      // destroy() asılı kalabilir, 10 saniye timeout koy
      await Promise.race([
        c.destroy(),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch {
      // destroy hatası önemsiz
    }
  }

  // Oturum dosyalarını sil - tekrar bağlanınca yeni QR çıksın
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  } catch {
    // dosya silme hatası önemsiz
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sendWhatsAppMessage(
  phone: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || state.status !== "ready") {
    return { success: false, error: "WhatsApp bağlı değil. Lütfen önce bağlanın." };
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
