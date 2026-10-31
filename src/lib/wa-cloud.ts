import crypto from "crypto";
import getDb from "@/lib/db";

// WhatsApp Business Platform (resmi Cloud API) — "coexistence" kurulumu.
//
// Numara telefondaki WhatsApp Business uygulamasında kalır; aynı numara Meta'nın Cloud
// API'sine de bağlanır. Bağlantı, portaldaki Embedded Signup penceresiyle (bizim Meta
// uygulamamız: "Çark Petrol Mesaj Paneli") kurulur. Meta; gelen mesajları, telefondan
// yazılanları (echo), geçmiş sohbetleri ve rehberi webhook ile bu sunucuya gönderir.
//
// Gizli bilgiler (App Secret, erişim anahtarı) settings tablosunda tutulur ve hiçbir
// API cevabında dışarı verilmez.

export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Meta panelinde oluşturulan uygulama ve Embedded Signup yapılandırması (gizli değil).
const DEFAULTS = {
  appId: "902654062800985",
  configId: "2143319112936525",
};

const KEYS = {
  appId: "wa_cloud_app_id",
  configId: "wa_cloud_config_id",
  appSecret: "wa_cloud_app_secret",
  verifyToken: "wa_cloud_verify_token",
  accessToken: "wa_cloud_access_token",
  wabaId: "wa_cloud_waba_id",
  phoneNumberId: "wa_cloud_phone_number_id",
  businessId: "wa_cloud_business_id",
  connectedAt: "wa_cloud_connected_at",
  syncRequestedAt: "wa_cloud_sync_requested_at",
  syncResult: "wa_cloud_sync_result",
} as const;

function getSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export function getAppConfig(): { appId: string; configId: string } {
  return {
    appId: getSetting(KEYS.appId) || DEFAULTS.appId,
    configId: getSetting(KEYS.configId) || DEFAULTS.configId,
  };
}

// Webhook doğrulama anahtarı: Meta panelindeki "Verify token" alanına girilir. Gizli bir
// parola değil ama tahmin edilemez olmalı; ilk istendiğinde rastgele üretilir.
export function getVerifyToken(): string {
  let t = getSetting(KEYS.verifyToken);
  if (!t) {
    t = crypto.randomBytes(18).toString("hex");
    setSetting(KEYS.verifyToken, t);
  }
  return t;
}

export function saveAppSecret(secret: string): void {
  setSetting(KEYS.appSecret, secret.trim());
}

export function hasAppSecret(): boolean {
  return getSetting(KEYS.appSecret).length > 0;
}

export type CloudStatus = {
  appId: string;
  configId: string;
  hasAppSecret: boolean;
  verifyToken: string;
  connected: boolean;
  wabaId: string;
  phoneNumberId: string;
  connectedAt: string;
  syncRequestedAt: string;
  syncResult: string;
  messageCount: number;
  lastWebhookAt: string;
};

export function getStatus(): CloudStatus {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS n FROM wa_cloud_messages").get() as { n: number };
  const last = db
    .prepare("SELECT received_at FROM wa_cloud_webhook_log ORDER BY id DESC LIMIT 1")
    .get() as { received_at: string } | undefined;
  return {
    ...getAppConfig(),
    hasAppSecret: hasAppSecret(),
    verifyToken: getVerifyToken(),
    connected: getSetting(KEYS.accessToken).length > 0 && getSetting(KEYS.wabaId).length > 0,
    wabaId: getSetting(KEYS.wabaId),
    phoneNumberId: getSetting(KEYS.phoneNumberId),
    connectedAt: getSetting(KEYS.connectedAt),
    syncRequestedAt: getSetting(KEYS.syncRequestedAt),
    syncResult: getSetting(KEYS.syncResult),
    messageCount: count.n,
    lastWebhookAt: last?.received_at ?? "",
  };
}

// --- Graph API ---

type GraphError = { error?: { message?: string; code?: number } };

async function graph<T>(
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as T & GraphError;
    if (!res.ok || data.error) {
      const err = new Error(data.error?.message || `Meta isteği başarısız (${res.status}).`);
      (err as Error & { code?: number }).code = data.error?.code;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Embedded Signup sonunda tarayıcıya gelen tek kullanımlık kodu (≈30 sn geçerli) işletme
// erişim anahtarına çevirir, uygulamayı WABA'nın webhook'larına abone eder ve 24 saat
// içinde yapılması zorunlu rehber + geçmiş aktarımını başlatır.
export async function completeSignup(input: {
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  redirectUri?: string;
}): Promise<CloudStatus> {
  const secret = getSetting(KEYS.appSecret);
  if (!secret) throw new Error("Önce App Secret'ı kaydedin.");
  const { appId } = getAppConfig();

  // Kod, Facebook sayfasına verilen redirect_uri ile birebir aynı adresle anahtara çevrilir.
  const tok = await graph<{ access_token: string }>("GET", "oauth/access_token", {
    query: {
      client_id: appId,
      client_secret: secret,
      code: input.code,
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    },
  });

  // Yönlendirmeyle bağlanınca Meta hesap kimliğini göndermez; kullanıcının verdiği yetkinin kapsamından okunur.
  let wabaId = input.wabaId ?? "";
  if (!wabaId) {
    const dbg = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(
      "GET",
      "debug_token",
      { query: { input_token: tok.access_token, access_token: `${appId}|${secret}` } }
    );
    const scopes = dbg.data?.granular_scopes ?? [];
    const ids = (s: string) => scopes.find((g) => g.scope === s)?.target_ids ?? [];
    wabaId = ids("whatsapp_business_management")[0] ?? ids("whatsapp_business_messaging")[0] ?? "";
    if (!wabaId) throw new Error("Facebook sayfasında WhatsApp hesabı seçilmemiş görünüyor. Tekrar deneyin.");
  }

  // Uygulama numarası bağlama (coexistence) bitişinde Meta yalnız WABA kimliğini
  // gönderebiliyor; numara kimliği yoksa hesaptan okunur.
  let phoneNumberId = input.phoneNumberId ?? "";
  if (!phoneNumberId) {
    const nums = await graph<{ data?: { id: string }[] }>("GET", `${wabaId}/phone_numbers`, {
      token: tok.access_token,
    });
    phoneNumberId = nums.data?.[0]?.id ?? "";
    if (!phoneNumberId) throw new Error("Bağlanan WhatsApp hesabında numara bulunamadı.");
  }

  setSetting(KEYS.accessToken, tok.access_token);
  setSetting(KEYS.wabaId, wabaId);
  setSetting(KEYS.phoneNumberId, phoneNumberId);
  if (input.businessId) setSetting(KEYS.businessId, input.businessId);
  setSetting(KEYS.connectedAt, new Date().toISOString());

  await finishSetup();
  return getStatus();
}

// Bağlantının ikinci yarısı: uygulamayı WABA'nın webhook'larına abone eder (yoksa Meta
// mesajları göndermez) ve geçmiş aktarımını başlatır. Erişim anahtarı kaydedildikten sonra
// ayrı çalıştırılabilir; bu adım hata verirse Embedded Signup'ı baştan yapmak gerekmez.
export async function finishSetup(): Promise<string> {
  const token = getSetting(KEYS.accessToken);
  const wabaId = getSetting(KEYS.wabaId);
  if (!token || !wabaId) throw new Error("WhatsApp henüz bağlanmadı.");
  await graph("POST", `${wabaId}/subscribed_apps`, { token });
  return requestHistorySync();
}

// Rehber (smb_app_state_sync) ve mesaj geçmişi (history) aktarımını başlatır. Meta bunu
// bağlantıdan sonraki 24 saat içinde istiyor; yapılmazsa numara bağlantıdan düşürülür.
// Kod 135000 = "zaten istendi" → başarı sayılır.
export async function requestHistorySync(): Promise<string> {
  const token = getSetting(KEYS.accessToken);
  const phoneId = getSetting(KEYS.phoneNumberId);
  if (!token || !phoneId) throw new Error("WhatsApp henüz bağlanmadı.");

  const results: string[] = [];
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    try {
      await graph("POST", `${phoneId}/smb_app_data`, {
        token,
        body: { messaging_product: "whatsapp", sync_type: syncType },
      });
      results.push(`${syncType}: istendi`);
    } catch (err) {
      const e = err as Error & { code?: number };
      results.push(e.code === 135000 ? `${syncType}: zaten istenmişti` : `${syncType}: HATA ${e.message}`);
    }
  }
  const summary = results.join(" · ");
  setSetting(KEYS.syncRequestedAt, new Date().toISOString());
  setSetting(KEYS.syncResult, summary);
  return summary;
}

// --- Webhook ---

// Meta, gövdeyi App Secret ile HMAC-SHA256 imzalar (X-Hub-Signature-256: sha256=...).
// İmzası tutmayan istek Meta'dan gelmemiştir ve işlenmez.
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = getSetting(KEYS.appSecret);
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

const WEBHOOK_LOG_LIMIT = 500;

type Msg = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  [k: string]: unknown;
};

// Mesajın okunabilir metni: düz metinde gövde, medyada açıklama, diğerlerinde tür adı.
function bodyOf(m: Msg): string {
  if (m.text?.body) return m.text.body;
  const media = m.type ? (m[m.type] as { caption?: string } | undefined) : undefined;
  if (media?.caption) return media.caption;
  return m.type ? `[${m.type}]` : "";
}

// Gelen webhook'u ham haliyle kaydeder (yeni alanları sonradan inceleyebilmek için) ve
// tanıdığı mesajları wa_cloud_messages'a yazar. Aynı mesaj (wamid) geçmiş aktarımında
// tekrar gelebildiği için kayıtlar idempotent.
export function handleWebhook(payload: unknown): { stored: number } {
  const db = getDb();
  const insertLog = db.prepare("INSERT INTO wa_cloud_webhook_log (field, payload) VALUES (?, ?)");
  const insertMsg = db.prepare(
    `INSERT INTO wa_cloud_messages (wamid, direction, contact, ts, type, body, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wamid) DO NOTHING`
  );
  const updateStatus = db.prepare("UPDATE wa_cloud_messages SET status = ? WHERE wamid = ?");
  const upsertContact = db.prepare(
    `INSERT INTO wa_cloud_contacts (phone, name, updated_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(excluded.name, name), updated_at = excluded.updated_at`
  );
  const deleteContact = db.prepare("DELETE FROM wa_cloud_contacts WHERE phone = ?");

  let stored = 0;
  const save = (m: Msg, direction: "in" | "out", contact: string, source: string) => {
    if (!m.id || !contact) return;
    // Tepkiler ve medya yer tutucuları kaydedilmez (medya sonra aynı id ile tekrar gelir).
    if (m.type === "reaction" || m.type === "media_placeholder") return;
    const ts = Number(m.timestamp) || Math.floor(Date.now() / 1000);
    const r = insertMsg.run(m.id, direction, contact, ts, m.type ?? "", bodyOf(m), source);
    stored += r.changes;
  };

  const p = payload as {
    entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[];
  };

  db.transaction(() => {
    for (const entry of p.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const field = change.field ?? "";
        const v = change.value ?? {};
        insertLog.run(field, JSON.stringify(change));

        if (field === "messages") {
          for (const c of (v.contacts as { wa_id?: string; profile?: { name?: string } }[]) ?? []) {
            if (c.wa_id) upsertContact.run(c.wa_id, c.profile?.name ?? null);
          }
          for (const m of (v.messages as Msg[]) ?? []) save(m, "in", m.from ?? "", "webhook");
          for (const s of (v.statuses as { id?: string; status?: string }[]) ?? []) {
            if (s.id && s.status) updateStatus.run(s.status, s.id);
          }
        } else if (field === "smb_message_echoes") {
          // Personelin telefondaki uygulamadan yazdığı mesajlar.
          for (const m of (v.message_echoes as Msg[]) ?? []) save(m, "out", m.to ?? "", "echo");
        } else if (field === "history") {
          for (const h of (v.history as { threads?: { id?: string; messages?: Msg[] }[] }[]) ?? []) {
            for (const t of h.threads ?? []) {
              // Geçmişte "to" yok; sohbet id'si müşterinin numarası. Gönderen o değilse giden.
              for (const m of t.messages ?? []) {
                const contact = t.id ?? "";
                save(m, m.from && m.from !== contact ? "out" : "in", contact, "history");
              }
            }
          }
        } else if (field === "smb_app_state_sync") {
          for (const s of (v.state_sync as {
            type?: string;
            action?: string;
            contact?: { phone_number?: string; full_name?: string; first_name?: string };
          }[]) ?? []) {
            const phone = s.contact?.phone_number?.replace(/\D/g, "");
            if (s.type !== "contact" || !phone) continue;
            if (s.action === "remove") deleteContact.run(phone);
            else upsertContact.run(phone, s.contact?.full_name || s.contact?.first_name || null);
          }
        }
      }
    }
    // Ham kayıtlar sınırsız büyümesin.
    db.prepare(
      `DELETE FROM wa_cloud_webhook_log WHERE id NOT IN (
         SELECT id FROM wa_cloud_webhook_log ORDER BY id DESC LIMIT ?
       )`
    ).run(WEBHOOK_LOG_LIMIT);
  })();

  return { stored };
}
