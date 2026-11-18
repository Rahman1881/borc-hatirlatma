import getDb from "@/lib/db";
import { askGemini, isGeminiConfigured } from "@/lib/gemini";
import { isTelegramConfigured, listChats, sendMessage } from "@/lib/telegram";

// Resmî Gazete takibi. Günün sayısı (ve gün içinde çıkan mükerrer sayılar) doğrudan
// resmigazete.gov.tr'deki fihrist sayfasından okunur; başlıklar ve bağlantılar siteden aynen
// alınır (yapay zekâ başlık üretmez).
//  • Günlük bülten: o günün başlıkları Gemini'ye verilir; istasyonu ilgilendirenler ile Türkiye
//    geneli için önemli olanları seçip birer cümleyle açıklar. Gemini yoksa ya da yanıt
//    vermezse yalnız anahtar kelimeyle bulunan kritik başlıklar yazılır.
//  • Anında uyarı: saatte bir bakılır; ÖTV, EPDK, akaryakıt gibi kritik bir başlık yeni
//    çıktıysa (çoğu zaman gece yayımlanan mükerrer sayıda) bülten beklenmeden Telegram'a gider.
//
// Fihrist adresi: /eskiler/YYYY/AA/YYYYAAGG.htm; mükerrerler YYYYAAGGM1.htm, M2… (olmayan 404).

const BASE = "https://www.resmigazete.gov.tr/eskiler";
const MAX_MUKERRER = 6;
const CHECK_EVERY_MS = 60 * 60_000; // anında uyarı için bakma aralığı

export type RgItem = {
  url: string;
  tarih: string; // YYYY-MM-DD
  sayi: string;
  mukerrer: number; // 0: olağan sayı
  bolum: string; // ör. "TEBLİĞ"
  baslik: string;
  kritik: boolean;
};

function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
}
const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${TR_MONTHS[m - 1]}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Sayfalar windows-1254 kodludur (meta etiketinde yazar).
async function fetchPage(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Resmî Gazete: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const charset = buf.subarray(0, 3000).toString("latin1").match(/charset=["']?([\w-]+)/i)?.[1] ?? "windows-1254";
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("windows-1254").decode(buf);
  }
}

// İstasyon işletmesini doğrudan etkileyebilecek başlıklar (anında uyarı ve yedek seçim).
const KRITIK =
  /akaryakıt|petrol|otogaz|motorin|benzin|biyodizel|özel tüketim vergisi|enerji piyasası düzenleme|katma değer vergisi|asgari ücret(?! tarifesi)|bayilik|ödeme kaydedici|(^|[^a-zçğıöşü])(ötv|kdv|lpg|epdk)([^a-zçğıöşü]|$)/;
// Sık çıkan ama istasyonu ilgilendirmeyen kararlar (ör. Türkiye Petrolleri kamulaştırma/ruhsat).
const ILGISIZ = /kamulaştır|taşınmaz|arama ruhsat|işletme ruhsat|ruhsat sahası|boru hattı/;
export function isKritik(baslik: string): boolean {
  const t = baslik.toLocaleLowerCase("tr");
  return KRITIK.test(t) && !ILGISIZ.test(t);
}

// Fihrist sayfasını ayrıştırır: kalın başlıklar bölüm adıdır, altlarındaki bağlantılar düzenlemeler.
export function parseIssue(html: string, tarih: string, mukerrer: number): { sayi: string; items: RgItem[] } {
  const dir = `${BASE}/${tarih.slice(0, 4)}/${tarih.slice(5, 7)}/`;
  const sayi = plain(html).match(/(\d{5})\s*Sayılı/)?.[1] ?? "";
  const items: RgItem[] = [];
  let bolum = "";
  let ilan = false;
  const re = /<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>|<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    if (m[3] == null) {
      const head = plain(m[2]);
      if (!head || /\d{4}|Sayılı|^MEVZUAT$/i.test(head)) continue;
      if (/İLÂN|İLAN/.test(head.toLocaleUpperCase("tr"))) ilan = true;
      else if (!/BÖLÜMÜ$/.test(head.toLocaleUpperCase("tr"))) bolum = head; // alt başlık (YÖNETMELİK, TEBLİĞ…)
      continue;
    }
    if (ilan) continue;
    const href = m[3].trim();
    const baslik = plain(m[4]).replace(/^[–—-]+\s*/, "");
    // Düzenlemeler aynı klasördeki "YYYYAAGG[Mk]-n.htm|pdf" dosyalarıdır.
    if (!baslik || !/^\d{8}(M\d+)?-\d+\.(htm|pdf)$/i.test(href)) continue;
    items.push({ url: dir + href, tarih, sayi, mukerrer, bolum, baslik, kritik: isKritik(baslik) });
  }
  return { sayi, items };
}

// Bir günün olağan sayısı ve o ana kadar çıkmış mükerrer sayıları.
export async function fetchDay(tarih: string): Promise<RgItem[]> {
  const stamp = tarih.replaceAll("-", "");
  const dir = `${BASE}/${tarih.slice(0, 4)}/${tarih.slice(5, 7)}/`;
  const out: RgItem[] = [];
  for (let k = 0; k <= MAX_MUKERRER; k++) {
    const html = await fetchPage(`${dir}${stamp}${k ? `M${k}` : ""}.htm`);
    if (html == null) {
      if (k === 0) return []; // o gün sayı yok (ya da henüz yayımlanmadı)
      break;
    }
    out.push(...parseIssue(html, tarih, k).items);
  }
  return out;
}

type Row = RgItem & { kritik: number | boolean; bulten: number; alerted: number };

// Günü çekip kaydeder; daha önce görülmemiş düzenlemeleri döndürür.
export async function syncDay(tarih: string): Promise<RgItem[]> {
  const items = await fetchDay(tarih);
  const db = getDb();
  const known = new Set((db.prepare("SELECT url FROM rg_items WHERE tarih = ?").all(tarih) as { url: string }[]).map((r) => r.url));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rg_items (url, tarih, sayi, mukerrer, bolum, baslik, kritik, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const fresh = items.filter((i) => !known.has(i.url));
  for (const i of fresh) insert.run(i.url, i.tarih, i.sayi, i.mukerrer, i.bolum, i.baslik, i.kritik ? 1 : 0, Date.now());
  return fresh;
}

// Metin olarak yayımlanan (htm) bir düzenlemenin içeriğinin başı; PDF'ler okunmaz.
async function itemText(url: string, max = 3500): Promise<string> {
  if (!/\.htm$/i.test(url)) return "";
  try {
    const html = await fetchPage(url);
    return html ? plain(html.replace(/<(script|style|xml)[\s\S]*?<\/\1>/gi, " ")).slice(0, max) : "";
  } catch {
    return "";
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

type Pick = { item: RgItem; grup: "biz" | "genel"; aciklama: string };

// Gemini, verilen başlık listesinden seçer; numara listede yoksa atılır (başlık uyduramaz).
async function pickWithGemini(items: RgItem[]): Promise<Pick[] | null> {
  if (!isGeminiConfigured() || items.length === 0) return null;
  const detay: string[] = [];
  for (const [i, it] of items.entries()) {
    if (!it.kritik || detay.length >= 2) continue;
    const text = await itemText(it.url);
    if (text) detay.push(`[${i + 1}] numaralı düzenlemenin metninden:\n${text}`);
  }
  const system = `Sen bir akaryakıt istasyonu (Petrol Ofisi bayisi; pompa, market, oto yıkama, tankerle yakıt
sevkiyatı; ~15 çalışan) patronu için Resmî Gazete'yi tarıyorsun. Sana bugünkü sayının düzenleme
başlıkları numaralı olarak verilecek. YALNIZ bu listeden seç; listede olmayan bir şey yazma.

İki grup seç:
- "biz": istasyon işletmesini doğrudan etkileyebilecekler (akaryakıt/LPG, EPDK, ÖTV-KDV ve
  diğer vergiler, asgari ücret-SGK-iş mevzuatı, yazar kasa/e-fatura, bayilik, çevre/iş güvenliği
  yükümlülükleri, taşımacılık).
- "genel": Türkiye genelinde herkesi ilgilendiren önemli kararlar (vergi, faiz, ücret, ithalat,
  bankacılık/kredi, seçim, olağanüstü durum, büyük ekonomik düzenlemeler).
Üniversite yönetmelikleri, atamalar, tek bir yeri ilgilendiren kararlar ve ilanları SEÇME.
Önemli bir şey yoksa boş liste döndür; sayıyı doldurmak için önemsiz başlık seçme.

En çok 6 madde. Her madde için "aciklama": bunun ne anlama geldiğini ve patronu neden
ilgilendirebileceğini anlatan TEK kısa cümle (en çok 160 karakter). Yalnız başlıktan ve
verilmişse metinden çıkarabildiğini yaz; oran, tutar ya da tarih UYDURMA.

Yanıtı SADECE şu JSON ile ver:
{"secilenler":[{"no":1,"grup":"biz","aciklama":"..."}]}`;
  const user = `${items.map((it, i) => `[${i + 1}] (${it.bolum}${it.mukerrer ? ", mükerrer" : ""}) ${it.baslik}`).join("\n")}${
    detay.length ? `\n\n${detay.join("\n\n")}` : ""
  }`;
  try {
    const json = extractJson(await askGemini([{ role: "user", text: user }], system));
    if (!json) return null;
    const parsed = JSON.parse(json) as { secilenler?: { no?: number; grup?: string; aciklama?: string }[] };
    const picks: Pick[] = [];
    for (const s of parsed.secilenler ?? []) {
      const item = items[Number(s.no) - 1];
      if (!item || picks.some((p) => p.item.url === item.url)) continue;
      picks.push({
        item,
        grup: s.grup === "biz" ? "biz" : "genel",
        aciklama: String(s.aciklama ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
      });
    }
    return picks.slice(0, 6);
  } catch (e) {
    console.error("[resmi-gazete] seçim yapılamadı:", e instanceof Error ? e.message : e);
    return null;
  }
}

function line(p: { item: RgItem; aciklama?: string }): string {
  const tag = p.item.mukerrer ? " (mükerrer)" : "";
  return `• <a href="${p.item.url}">${escapeHtml(p.item.baslik)}</a>${tag}${p.aciklama ? `\n  ${escapeHtml(p.aciklama)}` : ""}`;
}

// Bültenin Resmî Gazete bölümü: bugünün sayısı + dünün, dünkü bültenden sonra çıkan mükerrerleri.
// `mark` verilirse bölüme giren günler "bültende yer aldı" diye işaretlenir.
export async function buildGazetteSection(gun = isoLocal(new Date()), mark = true): Promise<string> {
  try {
    await syncDay(gun);
  } catch (e) {
    console.error("[resmi-gazete] sayı okunamadı:", e instanceof Error ? e.message : e);
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM rg_items
       WHERE tarih = ? OR (tarih = ? AND mukerrer > 0 AND bulten = 0)
       ORDER BY tarih, mukerrer, rowid`
    )
    .all(gun, addDays(gun, -1)) as Row[];
  const items: RgItem[] = rows.map((r) => ({ ...r, kritik: !!r.kritik }));
  if (items.length === 0) return ""; // hafta sonu/tatil ya da sayı henüz yayımlanmadı

  const today = items.filter((i) => i.tarih === gun);
  const sayi = today[0]?.sayi ?? items[0].sayi;
  const head = `📜 <b>Resmî Gazete</b> (${fmtDay(gun)}${sayi ? ` · sayı ${sayi}` : ""})`;
  const all = `<a href="${BASE}/${gun.slice(0, 4)}/${gun.slice(5, 7)}/${gun.replaceAll("-", "")}.htm">Tüm sayı (${today.length} düzenleme)</a>`;

  const picks = await pickWithGemini(items);
  const parts: string[] = [head];
  if (picks) {
    const biz = picks.filter((p) => p.grup === "biz");
    const genel = picks.filter((p) => p.grup === "genel");
    parts.push(
      biz.length ? `<b>Bizi ilgilendirenler</b>\n${biz.map(line).join("\n")}` : "Bugün bizi doğrudan ilgilendiren düzenleme yok."
    );
    if (genel.length) parts.push(`<b>Türkiye geneli</b>\n${genel.map(line).join("\n")}`);
  } else {
    // Yapay zekâ yok: yalnız anahtar kelimeyle bulunan kritik başlıklar.
    const kritik = items.filter((i) => i.kritik);
    parts.push(
      kritik.length
        ? `<b>Bizi ilgilendirebilecekler</b>\n${kritik.map((item) => line({ item })).join("\n")}`
        : "Bugün bizi doğrudan ilgilendiren düzenleme görünmüyor."
    );
  }
  parts.push(all);
  if (mark) db.prepare("UPDATE rg_items SET bulten = 1 WHERE tarih IN (?, ?)").run(gun, addDays(gun, -1));
  return parts.join("\n");
}

// --- Anında uyarı --------------------------------------------------------------

async function summarize(item: RgItem): Promise<string> {
  if (!isGeminiConfigured()) return "";
  const text = await itemText(item.url, 6000);
  if (!text) return "";
  try {
    const out = await askGemini(
      [{ role: "user", text: `Başlık: ${item.baslik}\n\nMetin:\n${text}` }],
      `Bir akaryakıt istasyonu patronu için Resmî Gazete'de yeni çıkan bu düzenlemeyi EN ÇOK iki kısa
cümleyle özetle: ne değişiyor ve ne zaman yürürlüğe giriyor. Yalnız metinde yazanı söyle; metinde
olmayan oran, tutar ya da tarih UYDURMA. Düz metin yaz, başlık ya da madde işareti kullanma.`
    );
    return out.replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    return "";
  }
}

// Uyarı metni: başlık + bağlantı; metin olarak yayımlandıysa iki cümlelik özet.
export async function alertText(kritik: RgItem[]): Promise<string> {
  const blocks: string[] = [];
  for (const item of kritik.slice(0, 5)) {
    const ozet = await summarize(item);
    blocks.push(`• <a href="${item.url}">${escapeHtml(item.baslik)}</a>${ozet ? `\n  ${escapeHtml(ozet)}` : ""}`);
  }
  const mukerrer = kritik.some((i) => i.mukerrer);
  return `📜 <b>Resmî Gazete'de yeni düzenleme</b>${mukerrer ? " (mükerrer sayı)" : ""} · ${fmtDay(kritik[0].tarih)}\n${blocks.join("\n")}`;
}

// Bugünün (gece yarısından sonra dünün de) sayılarına bakar; yeni kritik düzenleme varsa bildirir.
export async function checkGazette(now = new Date()): Promise<number> {
  const db = getDb();
  const firstRun = (db.prepare("SELECT COUNT(*) AS n FROM rg_items").get() as { n: number }).n === 0;
  const today = isoLocal(now);
  const fresh = [...(now.getHours() < 3 ? await syncDay(addDays(today, -1)) : []), ...(await syncDay(today))];
  // İlk kurulumda o günün sayısı "yeni" sayılıp toplu uyarı gitmesin.
  const kritik = firstRun ? [] : fresh.filter((i) => i.kritik);
  if (kritik.length === 0 || getSetting("rg_alert") === "0" || !isTelegramConfigured()) return 0;
  const text = await alertText(kritik);
  let sent = 0;
  for (const c of listChats().filter((x) => x.allowed && x.enabled)) {
    try {
      await sendMessage(c.chatId, text);
      sent++;
    } catch (e) {
      console.error("[resmi-gazete] uyarı gönderilemedi:", e instanceof Error ? e.message : e);
    }
  }
  const mark = db.prepare("UPDATE rg_items SET alerted = 1 WHERE url = ?");
  for (const i of kritik) mark.run(i.url);
  return sent;
}

const g = globalThis as unknown as { __gazetteTimer?: ReturnType<typeof setInterval> };

export function startGazetteScheduler(): void {
  if (g.__gazetteTimer) return;
  let busy = false;
  const run = () => {
    if (busy || Date.now() - Number(getSetting("rg_last_check") ?? 0) < CHECK_EVERY_MS) return;
    busy = true;
    setSetting("rg_last_check", String(Date.now()));
    checkGazette()
      .catch((e) => console.error("[resmi-gazete]", e instanceof Error ? e.message : e))
      .finally(() => {
        busy = false;
      });
  };
  setTimeout(run, 120_000);
  g.__gazetteTimer = setInterval(run, 10 * 60_000);
}
