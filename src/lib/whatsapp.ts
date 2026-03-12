import { Client, LocalAuth } from "whatsapp-web.js";
import path from "path";
import QRCode from "qrcode";

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

  client.on("qr", async (qr: string) => {
    const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
    state = { status: "qr", qrDataUrl: dataUrl, info: null };
  });

  client.on("loading_screen", () => {
    state = { ...state, status: "loading" };
  });

  client.on("ready", () => {
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
    state = { status: "disconnected", qrDataUrl: null, info: null };
  });

  client.on("disconnected", () => {
    state = { status: "disconnected", qrDataUrl: null, info: null };
    client = null;
  });

  client.initialize();
}

export function disconnectWhatsApp(): void {
  if (client) {
    client.destroy();
    client = null;
    state = { status: "disconnected", qrDataUrl: null, info: null };
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
    // Format: 905xxxxxxxxx -> 905xxxxxxxxx@c.us
    let chatId = phone.replace(/\D/g, "");
    if (!chatId.endsWith("@c.us")) {
      chatId = `${chatId}@c.us`;
    }

    // Check if number is on WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      return { success: false, error: "Bu numara WhatsApp kullanmıyor" };
    }

    await client.sendMessage(chatId, body);
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
  data: { name: string; totalDebt: number; overdueDebt: number }
): string {
  return template
    .replace(/{isim}/g, data.name)
    .replace(/{tutar}/g, formatMoney(data.totalDebt))
    .replace(/{vadeli_borc}/g, formatMoney(data.overdueDebt));
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
