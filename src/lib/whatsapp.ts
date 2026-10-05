import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
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
  // Süren bir başlatma varsa onun sözü; eşzamanlı "Bağlan" isteklerini teke indirir.
  initializing: Promise<void> | null;
  // Beklenmedik kopmadan sonra kayıtlı oturumla otomatik yeniden bağlanma.
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  // Tarayıcı hatasından sonra oturumun toparlanıp toparlanmadığını kontrol eden sayaç.
  healthTimer: ReturnType<typeof setTimeout> | null;
};

const globalForWA = globalThis as unknown as {
  __waStore?: WAStore;
  __waRejectionGuard?: boolean;
};
const store: WAStore =
  globalForWA.__waStore ??
  (globalForWA.__waStore = {
    client: null,
    state: { status: "disconnected", qrDataUrl: null, info: null },
    loadingTimer: null,
    loadingStartedAt: 0,
    initializing: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    healthTimer: null,
  });

function getSessionPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

// Node süreci çökerek yeniden başladığında (sunucu-baslat.bat döngüsü) Puppeteer'ın
// açtığı Chrome öksüz kalabiliyor ve oturum klasörünü kilitli tutuyor. Yeni süreç
// aynı userDataDir ile açmaya çalışınca Chrome
//   "The browser is already running for ... Use a different `userDataDir`"
// diyip reddediyor ve bağlantı bir daha asla kurulamıyor. Bu yüzden taze başlamadan
// önce SADECE bizim oturum klasörümüzü kullanan Chrome süreçlerini kapatıyoruz —
// komut satırında bu yol geçmeyen (kullanıcının kendi) Chrome'una dokunulmaz.
function killOrphanBrowsers(): Promise<void> {
  const sessionPath = getSessionPath();

  return new Promise((resolve) => {
    const done = () => resolve();
    // Öldürme başarısız olsa bile bağlanmayı denemeye devam ederiz; bu yüzden
    // hata yollarının hepsi resolve() ile biter.
    const timer = setTimeout(done, 10000);
    const finish = () => {
      clearTimeout(timer);
      done();
    };

    if (process.platform === "win32") {
      // Komut içinde YALNIZCA tek tırnak kullanıyoruz: Node, Windows'ta argümanları
      // kaçırırken iç içe çift tırnakları bozabiliyor. PowerShell tek tırnak kaçışı: ' -> ''
      const needle = sessionPath.replace(/'/g, "''");
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process | ` +
            `Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${needle}*' } | ` +
            `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        finish
      );
    } else {
      execFile("pkill", ["-f", sessionPath], finish);
    }
  });
}

// Chrome, profil klasöründe "Singleton*" kilit dosyaları bırakır. Süreç düzgün
// kapanmadıysa bunlar kalır ve yeni Chrome açılışını engeller. Öksüz süreçleri
// kapattıktan sonra artan kilitleri de temizliyoruz.
function clearBrowserLocks(): void {
  const dir = path.join(getSessionPath(), "session");
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      /* kilit yoksa/silinemezse önemsiz */
    }
  }
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

// Sayfanın açık olması yetmez: WhatsApp Web kendini yenilediğinde sayfa açık kalır
// ama kütüphanenin enjekte ettiği `window.Store` bir süre (bazen kalıcı olarak) yok
// olur. Bu durumda panel "Bağlı" der ama hiçbir mesaj gitmez. Gerçek ölçüt WhatsApp'ın
// kendi bağlantı durumunun CONNECTED olması. Yenileme sürerken geçici olarak null
// dönebildiği için `waitMs` boyunca birkaç kez yeniden bakarız.
async function isSessionHealthy(client: Client, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (store.client !== client || !isSessionAlive()) return false;
    try {
      const state = await Promise.race([
        client.getState(),
        new Promise<null>((r) => setTimeout(() => r(null), 10000)),
      ]);
      if (String(state) === "CONNECTED") return true;
    } catch {
      /* yenileme sırasında evaluate hata verebilir; tekrar deneriz */
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// LocalAuth, oturumu `.wwebjs_auth/session` altında tutar. Bu klasör varsa QR
// okutmadan yeniden bağlanmak mümkündür.
function hasSavedSession(): boolean {
  return fs.existsSync(path.join(getSessionPath(), "session"));
}

const RECONNECT_DELAYS_MS = [15000, 30000, 60000, 120000, 300000];

function cancelReconnect(): void {
  if (store.reconnectTimer) {
    clearTimeout(store.reconnectTimer);
    store.reconnectTimer = null;
  }
}

// Oturum beklenmedik şekilde koptuğunda kayıtlı oturumla kendiliğinden yeniden
// bağlanır; kimsenin Ayarlar'a gidip "Bağlan"a basması gerekmez. Kayıtlı oturum
// yoksa (telefondan çıkış yapılmış, oturum bozuk) QR gerektiği için bir şey yapmayız.
// Deneme sayısı sınırlı: sürekli başarısız oluyorsa Chrome'u durmadan açıp kapatmayız.
function scheduleReconnect(): void {
  if (store.reconnectTimer || !hasSavedSession()) return;
  const delay = RECONNECT_DELAYS_MS[store.reconnectAttempts];
  if (delay === undefined) {
    console.error("[whatsapp] otomatik yeniden bağlanma denemeleri tükendi");
    return;
  }
  store.reconnectAttempts++;
  console.error(`[whatsapp] bağlantı koptu, ${delay / 1000} sn sonra yeniden bağlanılacak`);
  store.reconnectTimer = setTimeout(() => {
    store.reconnectTimer = null;
    initWhatsApp().catch(() => {});
  }, delay);
}

// Sunucu açılırken çağrılır (src/instrumentation.ts). Kayıtlı oturum varsa
// WhatsApp'ı kendiliğinden bağlar; sunucu yeniden başladı diye panelin
// "Bağlı Değil"de kalmasına gerek yok.
export function autoStartWhatsApp(): void {
  if (!hasSavedSession()) return;
  initWhatsApp().catch(() => {});
}

// Mevcut client'ı (varsa) güvenle kapatır ve store'u temizler. destroy() askıda
// kalabildiği için timeout ile yarıştırılır. deleteSession=true ise diskteki
// (bozuk olabilecek) oturum dosyaları da silinir ki sonraki bağlanma taze QR üretsin.
async function teardownClient(deleteSession = false): Promise<void> {
  if (store.loadingTimer) {
    clearTimeout(store.loadingTimer);
    store.loadingTimer = null;
  }
  if (store.healthTimer) {
    clearTimeout(store.healthTimer);
    store.healthTimer = null;
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

// Eşzamanlı çağrıları tek bir başlatmaya indirger. Aksi halde kullanıcı "Bağlan"a
// iki kez basınca teardown'ın await'i sırasında ikinci istek içeri sızıyor, iki
// Chrome birden açılıyor ve sahipsiz kalan oturum klasörünü kilitliyor.
export function initWhatsApp(): Promise<void> {
  if (store.initializing) return store.initializing;
  const run = startWhatsApp().finally(() => {
    if (store.initializing === run) store.initializing = null;
  });
  store.initializing = run;
  return run;
}

async function startWhatsApp(): Promise<void> {
  installRejectionGuard();
  // Elle "Bağlan"a basıldıysa ya da otomatik deneme zamanı geldiyse bekleyen
  // ikinci bir denemeye gerek yok.
  cancelReconnect();

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

  // Önceki süreçten kalmış, oturum klasörünü kilitleyen Chrome'ları temizle.
  await killOrphanBrowsers();
  clearBrowserLocks();

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
    store.reconnectAttempts = 0;
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
    // Kimlik doğrulandı: oturum SAĞLAM. 90 sn sayacı oturumu silerdi; oysa yavaş
    // makinede sohbetlerin yüklenmesi bundan uzun sürebiliyor ve geçerli oturumu
    // silmek boş yere QR okutturuyordu. Yerine daha uzun, oturumu silmeyen bir sayaç.
    if (store.loadingTimer) clearTimeout(store.loadingTimer);
    store.loadingTimer = setTimeout(() => {
      store.loadingTimer = null;
      if (isCurrent() && store.state.status === "loading") void markSessionDead();
    }, 180000);
  });

  client.on("auth_failure", async () => {
    if (!isCurrent()) return;
    await teardownClient(true); // bozuk oturumu sil
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
  });

  client.on("disconnected", async (reason) => {
    if (!isCurrent()) return;
    await teardownClient();
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
    // Telefondan çıkış yapıldıysa (LOGOUT) yeniden QR gerekir; kendiliğinden
    // bağlanmayı denemeyiz. Diğer kopmalarda kayıtlı oturumla geri döneriz.
    if (String(reason) !== "LOGOUT") scheduleReconnect();
  });

  // initialize() kendisi reddedebilir (Chrome açılamaması, kilitli profil vb.);
  // yakalanmazsa durum sonsuza dek "loading"de asılı kalır ve konsolu
  // unhandledRejection ile doldururdu. Oturumu SİLMİYORUZ: hata çoğunlukla
  // kilitten kaynaklanır ve oturumu silmek kullanıcıya boş yere QR okutturur.
  // Gerçekten bozuk oturumu auth_failure ve 90 sn zaman aşımı zaten temizliyor.
  client.initialize().catch(async () => {
    if (!isCurrent()) return;
    await teardownClient();
    store.state = { status: "disconnected", qrDataUrl: null, info: null };
    scheduleReconnect();
  });
}

export async function disconnectWhatsApp(): Promise<void> {
  // Kullanıcı bilerek kesti: otomatik yeniden bağlanma devreye girmesin.
  cancelReconnect();
  store.reconnectAttempts = 0;
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
  "WhatsApp bağlantısı koptu. Otomatik yeniden bağlanılıyor; birkaç dakika içinde düzelmezse Ayarlar'dan bağlanın.";

// Oturumun öldüğünü anladığımızda durumu düşürüyoruz ki panel "Bağlı" göstermeye
// devam etmesin ve kullanıcı yeniden bağlanabilsin. Client'ı sadece null'lamak
// yetmez: arkadaki Chrome süreci yaşamaya devam edip oturum klasörünü kilitler ve
// sonraki bağlanma "browser is already running" ile patlar. Bu yüzden teardown şart.
// Oturum dosyaları silinmez — kimlik bilgileri sağlam, sadece tarayıcı öldü; bu
// yüzden kayıtlı oturumla kendiliğinden yeniden bağlanmayı da planlarız.
async function markSessionDead(): Promise<void> {
  await teardownClient();
  store.state = { status: "disconnected", qrDataUrl: null, info: null };
  scheduleReconnect();
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
  "detached frame",
  "frame was detached",
  "frame got detached",
];

function isDeadSessionError(message: string): boolean {
  const lower = message.toLowerCase();
  return DEAD_SESSION_PATTERNS.some((pattern) => lower.includes(pattern));
}

// whatsapp-web.js, WhatsApp Web sayfası kendini yenilediğinde ('framenavigated')
// kendini yeniden enjekte ediyor ama bunu try/catch'siz yapıyor. Yenileme sırasında
// çerçeve kopunca "Attempted to use detached Frame" / "Target closed" hataları
// sahipsiz kalıyor. Next.js bunları konsola basar ama süreci ÖLDÜRMEZ — yani bu
// satırlar tek başına zararsız. Asıl tehlike, yenilemeden sonra kütüphanenin
// toparlanamaması: panel "Bağlı" der ama mesaj gitmez. Bu yüzden bu hatayı bir
// sinyal olarak kullanıp oturumun gerçekten toparlandığını kontrol ediyoruz.
function installRejectionGuard(): void {
  if (globalForWA.__waRejectionGuard) return;
  globalForWA.__waRejectionGuard = true;

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (!isDeadSessionError(message) || store.state.status !== "ready") return;

    if (!isSessionAlive()) void markSessionDead();
    else scheduleHealthCheck();
  });
}

// Yenileme dalgası bitsin diye 30 sn bekler, sonra oturumun CONNECTED olup
// olmadığına bakar. Toparlanamadıysa ölü sayar ve kayıtlı oturumla yeniden bağlanır.
// Aynı dalgadaki onlarca hata için tek kontrol yapılır.
function scheduleHealthCheck(): void {
  if (store.healthTimer) return;
  store.healthTimer = setTimeout(async () => {
    store.healthTimer = null;
    const client = store.client;
    if (!client || store.state.status !== "ready") return;
    if (await isSessionHealthy(client, 20000)) return;
    if (store.client === client) {
      console.error("[whatsapp] sayfa yenilendikten sonra oturum toparlanamadı");
      await markSessionDead();
    }
  }, 30000);
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

  // Göndermeden önce oturumun gerçekten çalıştığını doğrula (sayfanın açık olması
  // yetmez; WhatsApp Web yenileniyorsa toparlanması için biraz bekleriz).
  if (!(await isSessionHealthy(client, 20000))) {
    if (store.client === client) await markSessionDead();
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
      await markSessionDead();
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
