import getDb from "@/lib/db";
import { ensureDailyPrices } from "@/lib/fuel-prices";
import { isTelegramConfigured, listChats, sendMessage } from "@/lib/telegram";

// Zam/İndirim Tahmini. Türkiye'de rafineri fiyatı Akdeniz ürün fiyatı (Platts CIF MED,
// $/ton) × TCMB dolar kuruyla oluşur; son değişiklikten beri bu maliyet belli bir
// oranı (sektörde konuşulan ~%3) aşınca pompaya zam ya da indirim gelir. Resmi bir
// formül yayınlanmadığı için eşik ve ortalama gün sayısı ayardır; gerçekleşen
// değişikliklerle (Petrol Ofisi günlük fiyatları) karşılaştırılarak ayarlanır.
//
// Veri: TradingView'daki ücretsiz NYMEX kontratları — motorin NYMEX:Z62! (ULSD 10ppm
// Cargoes CIF MED), benzin NYMEX:A3G2! (Premium Unleaded 10ppm FOB MED). Otomatik çekmek
// kullanım şartlarına aykırı olduğundan günde bir kez Telegram'dan ya da portaldan elle
// girilir; kur TCMB'den otomatik alınır. İkinci ay kontratı kullanılır: önündeki ay
// kontratı ay boyunca ortalamaya sabitlendiği için ay sonunda neredeyse kıpırdamaz.
// İkinci ay kontratı ay başında bir sonrakine geçer; o geçişteki sıçrama piyasa hareketi
// olmadığından seri ay değişiminde zincirlenir (o günün oranı 1 sayılır).

export type Fuel = "motorin" | "benzin";
export type Level = "zam" | "zam_yakin" | "notr" | "indirim_yakin" | "indirim";

export type ForecastConfig = {
  enabled: boolean;
  esikPct: number; // rafinerinin fiyat değiştirdiği sapma (%)
  ortalamaGun: number; // kaç kapanışın ortalaması alınır
  yogunlukMotorin: number; // kg/litre
  yogunlukBenzin: number;
  eselPay: number; // eşel mobil: değişimin devletin ÖTV'den karşıladığı payı (%)
  gunlukDurum: boolean; // her gün durum gönder (kapalıysa yalnız uyarılar)
  yoksay: string[]; // baz sayılmayacak pompa değişiklikleri: "YYYY-MM-DD|yakit"
};

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  enabled: true,
  esikPct: 3,
  ortalamaGun: 5,
  yogunlukMotorin: 0.84,
  yogunlukBenzin: 0.75,
  eselPay: 0,
  gunlukDurum: true,
  yoksay: [],
};

export type QuoteRow = {
  tarih: string;
  z6: number | null;
  a3g: number | null;
  usd: number;
  entered_by: string | null;
  entered_at: number;
};

export type PumpChange = {
  tarih: string; // yeni fiyatın ilk görüldüğü gün
  yakit: Fuel;
  eski: number;
  yeni: number;
  fark: number;
  ignored: boolean;
};

export type FuelRow = {
  tarih: string;
  raw: number; // $/ton
  usd: number;
  pct: number; // son değişiklikteki baza göre sapma (%)
  tl: number; // pompaya yansıması beklenen TL/litre (KDV dahil)
  level: Level;
  change: PumpChange | null; // hesaba esas son pompa değişikliği
  baseTarih: string;
  calibrating: boolean; // değişiklikten önceki veri yok; baz ilk girilen gün
};

export type FuelCalc = {
  yakit: Fuel;
  rows: FuelRow[];
  latest: FuelRow | null;
  lastChange: PumpChange | null;
  changes: (PumpChange & { estimate: FuelRow | null })[];
};

const FUELS: { key: Fuel; col: "z6" | "a3g"; label: string; icon: string; symbol: string }[] = [
  { key: "motorin", col: "z6", label: "Motorin", icon: "🛢", symbol: "Z62!" },
  { key: "benzin", col: "a3g", label: "Benzin", icon: "⛽", symbol: "A3G2!" },
];

const STATION = { il: "Sakarya", ilce: "Serdivan", plaka: 54 };
// Bu tutarın altındaki pompa farkları dağıtıcı/bayi marjı oynamasıdır, rafineri
// değişikliği sayılmaz (baz sıfırlanmaz).
const MIN_PUMP_CHANGE = 0.3;
// Elle girilen fiyat için akla yatkın aralık ($/ton) — yanlış yazımı yakalamak için.
const MIN_PRICE = 200;
const MAX_PRICE = 3000;
// Önceki kapanışa göre bundan büyük fark yazım hatası olabilir; uyarılır.
const JUMP_WARN = 0.12;

// --- Ayarlar --------------------------------------------------------------

function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getForecastConfig(): ForecastConfig {
  try {
    const raw = getSetting("fuel_forecast");
    if (raw) return { ...DEFAULT_FORECAST_CONFIG, ...(JSON.parse(raw) as Partial<ForecastConfig>) };
  } catch {
    // bozuksa varsayılan
  }
  return { ...DEFAULT_FORECAST_CONFIG };
}

export function saveForecastConfig(patch: Partial<ForecastConfig>): ForecastConfig {
  const cur = getForecastConfig();
  const num = (v: unknown, min: number, max: number, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const next: ForecastConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    esikPct: patch.esikPct != null ? num(patch.esikPct, 0.5, 20, cur.esikPct) : cur.esikPct,
    ortalamaGun:
      patch.ortalamaGun != null ? Math.round(num(patch.ortalamaGun, 1, 20, cur.ortalamaGun)) : cur.ortalamaGun,
    yogunlukMotorin:
      patch.yogunlukMotorin != null ? num(patch.yogunlukMotorin, 0.6, 1, cur.yogunlukMotorin) : cur.yogunlukMotorin,
    yogunlukBenzin:
      patch.yogunlukBenzin != null ? num(patch.yogunlukBenzin, 0.6, 1, cur.yogunlukBenzin) : cur.yogunlukBenzin,
    eselPay: patch.eselPay != null ? num(patch.eselPay, 0, 100, cur.eselPay) : cur.eselPay,
    gunlukDurum: typeof patch.gunlukDurum === "boolean" ? patch.gunlukDurum : cur.gunlukDurum,
    yoksay: Array.isArray(patch.yoksay) ? patch.yoksay.map(String) : cur.yoksay,
  };
  setSetting("fuel_forecast", JSON.stringify(next));
  return next;
}

export function setChangeIgnored(tarih: string, yakit: Fuel, ignored: boolean): ForecastConfig {
  const key = `${tarih}|${yakit}`;
  const cur = getForecastConfig();
  const set = new Set(cur.yoksay);
  if (ignored) set.add(key);
  else set.delete(key);
  return saveForecastConfig({ yoksay: [...set] });
}

// --- Tarih yardımcıları (yerel saat) ----------------------------------------

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}
function isWeekend(iso: string): boolean {
  const wd = parseIso(iso).getDay();
  return wd === 0 || wd === 6;
}
function prevBusinessDay(iso: string): string {
  let d = addDays(iso, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

// Elle girilen fiyat hangi kapanışa ait sayılır. CME, NYMEX kapanışlarını New York
// 14:47'den itibaren ön, 19:00'da kesin yayınlar — Türkiye saatiyle yaz ~21:47 / 02:00,
// kış ~22:47 / 03:00; TradingView ~10 dk gecikmeli gösterir. Bu yüzden hafta içi
// 23:00'ten sonra girilen değer o günün kapanışı, öncesi bir önceki iş günününkü sayılır.
const SAME_DAY_FROM_HOUR = 23;
export function defaultEntryDate(now = new Date()): string {
  const today = isoLocal(now);
  if (!isWeekend(today) && now.getHours() >= SAME_DAY_FROM_HOUR) return today;
  return prevBusinessDay(today);
}

const TR_MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
function fmtDay(iso: string): string {
  const d = parseIso(iso);
  return `${d.getDate()} ${TR_MONTHS_SHORT[d.getMonth()]}`;
}
function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtSigned(n: number, digits = 2): string {
  const s = fmtNum(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}
function fmtPct(n: number): string {
  const s = `%${fmtNum(Math.abs(n), 1)}`;
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

// --- TCMB kuru ---------------------------------------------------------------

async function fetchUsdForDate(iso: string): Promise<number | null> {
  const [y, m, d] = iso.split("-");
  const res = await fetch(`https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const hit = xml.match(/CurrencyCode="USD"[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
  const n = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// O günün TCMB dolar satış kuru; tatil/hafta sonu ya da 15:30 öncesi ise bir önceki
// yayımlanan kur.
async function getUsdRate(iso: string): Promise<number> {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetchUsdForDate(addDays(iso, -i));
      if (r) return r;
    } catch {
      // ağ hatası: bir önceki günü dene
    }
  }
  throw new Error("TCMB dolar kuru alınamadı.");
}

// --- Veri ----------------------------------------------------------------------

export function listQuotes(): QuoteRow[] {
  return getDb().prepare("SELECT * FROM market_quotes ORDER BY tarih ASC").all() as QuoteRow[];
}

export function deleteQuote(tarih: string): void {
  getDb().prepare("DELETE FROM market_quotes WHERE tarih = ?").run(tarih);
}

// Petrol Ofisi'nin Sakarya pompa fiyatlarından (günlük çekilen) değişiklikler.
export function getPumpChanges(cfg = getForecastConfig()): PumpChange[] {
  const rows = getDb()
    .prepare(
      `SELECT tarih, yakit, AVG(fiyat) AS fiyat FROM fuel_prices
       WHERE plaka = ? AND LOWER(marka) LIKE '%petrol ofisi%' AND yakit IN ('motorin', 'benzin')
       GROUP BY tarih, yakit ORDER BY yakit, tarih`
    )
    .all(STATION.plaka) as { tarih: string; yakit: Fuel; fiyat: number }[];
  const ignored = new Set(cfg.yoksay);
  const out: PumpChange[] = [];
  const prev: Partial<Record<Fuel, number>> = {};
  for (const r of rows) {
    const p = prev[r.yakit];
    if (p != null && Math.abs(r.fiyat - p) >= MIN_PUMP_CHANGE) {
      out.push({
        tarih: r.tarih,
        yakit: r.yakit,
        eski: p,
        yeni: r.fiyat,
        fark: r.fiyat - p,
        ignored: ignored.has(`${r.tarih}|${r.yakit}`),
      });
    }
    prev[r.yakit] = r.fiyat;
  }
  return out.sort((a, b) => a.tarih.localeCompare(b.tarih));
}

// --- Hesap ---------------------------------------------------------------------

function levelOf(pct: number, esik: number): Level {
  if (pct >= esik) return "zam";
  if (pct >= esik * 0.7) return "zam_yakin";
  if (pct <= -esik) return "indirim";
  if (pct <= -esik * 0.7) return "indirim_yakin";
  return "notr";
}

function findLastIndex<T>(arr: T[], fn: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
  return -1;
}

function buildFuel(
  fuel: Fuel,
  quotes: QuoteRow[],
  allChanges: PumpChange[],
  cfg: ForecastConfig
): FuelCalc {
  const meta = FUELS.find((f) => f.key === fuel)!;
  const n = Math.max(1, Math.round(cfg.ortalamaGun));
  const dens = fuel === "motorin" ? cfg.yogunlukMotorin : cfg.yogunlukBenzin;

  // Zincirlenmiş seri: kontrat ay başında değişince aradaki fark sayılmaz.
  type Pt = { tarih: string; raw: number; usd: number; idx: number; c: number; avg: number };
  const pts: Pt[] = [];
  for (const q of quotes) {
    const raw = q[meta.col];
    if (raw == null) continue;
    const prev = pts[pts.length - 1];
    const idx = !prev ? raw : prev.tarih.slice(0, 7) === q.tarih.slice(0, 7) ? (prev.idx * raw) / prev.raw : prev.idx;
    pts.push({ tarih: q.tarih, raw, usd: q.usd, idx, c: idx * q.usd, avg: 0 });
  }
  pts.forEach((p, i) => {
    const win = pts.slice(Math.max(0, i - n + 1), i + 1);
    p.avg = win.reduce((a, x) => a + x.c, 0) / win.length;
  });

  const changes = allChanges.filter((c) => c.yakit === fuel && !c.ignored);
  const rows: FuelRow[] = pts.map((p) => {
    const ch = changes.filter((c) => c.tarih <= p.tarih).pop() ?? null;
    // Baz: değişiklik kararından önceki son kapanıştaki ortalama.
    let j = ch ? findLastIndex(pts, (x) => x.tarih < ch.tarih) : -1;
    let base: number;
    let calibrating = false;
    if (j >= 0) {
      base = pts[j].avg;
    } else {
      j = ch ? pts.findIndex((x) => x.tarih >= ch.tarih) : 0;
      base = pts[j].c;
      calibrating = true;
    }
    const pct = (p.avg / base - 1) * 100;
    const tl = (pct / 100) * ((p.raw * p.usd * dens) / 1000) * 1.2 * (1 - cfg.eselPay / 100);
    return {
      tarih: p.tarih,
      raw: p.raw,
      usd: p.usd,
      pct,
      tl,
      level: levelOf(pct, cfg.esikPct),
      change: ch,
      baseTarih: pts[j].tarih,
      calibrating,
    };
  });

  const own = allChanges.filter((c) => c.yakit === fuel);
  return {
    yakit: fuel,
    rows,
    latest: rows[rows.length - 1] ?? null,
    lastChange: changes[changes.length - 1] ?? null,
    // Her değişiklik için: değişiklikten önceki son kapanışta modelin söylediği.
    changes: own.map((c) => {
      const i = findLastIndex(rows, (r) => r.tarih < c.tarih);
      return { ...c, estimate: i >= 0 ? rows[i] : null };
    }),
  };
}

export function computeForecast(cfg = getForecastConfig()): Record<Fuel, FuelCalc> {
  const quotes = listQuotes();
  const changes = getPumpChanges(cfg);
  return {
    motorin: buildFuel("motorin", quotes, changes, cfg),
    benzin: buildFuel("benzin", quotes, changes, cfg),
  };
}

// --- Telegram metinleri --------------------------------------------------------

const LEVEL_TEXT: Record<Level, string> = {
  zam: "🔴 Eşik aşıldı — zam bekleniyor",
  zam_yakin: "🟠 Zam yaklaşıyor",
  notr: "⚪ Belirgin bir hareket yok",
  indirim_yakin: "🟡 İndirim yaklaşıyor",
  indirim: "🟢 Eşik aşıldı — indirim bekleniyor",
};

export function buildStatusText(cfg = getForecastConfig()): string {
  const calc = computeForecast(cfg);
  const latestDates = FUELS.map((f) => calc[f.key].latest?.tarih).filter(Boolean) as string[];
  if (latestDates.length === 0) {
    return (
      "📈 <b>Zam/İndirim Tahmini</b>\nHenüz piyasa verisi girilmedi.\n\n" + ENTRY_HELP
    );
  }
  const tarih = latestDates.sort().pop()!;
  const lines: string[] = [];

  for (const f of FUELS) {
    const r = calc[f.key].latest;
    if (r?.level === "zam")
      lines.push(`🚨 <b>${f.label.toLocaleUpperCase("tr")}E ZAM BEKLENİYOR</b> — tanker alımını öne çekmeyi düşünün.`);
    if (r?.level === "indirim")
      lines.push(`🟢 <b>${f.label.toLocaleUpperCase("tr")}E İNDİRİM BEKLENİYOR</b> — alımı birkaç gün erteleyebilirsiniz.`);
  }
  if (lines.length) lines.push("");

  lines.push(`📈 <b>Zam/İndirim Tahmini</b> · ${fmtDay(tarih)} kapanışı`);
  const usd = FUELS.map((f) => calc[f.key].latest).find((r) => r?.tarih === tarih)?.usd;
  for (const f of FUELS) {
    const r = calc[f.key].latest;
    if (!r) {
      lines.push(`${f.icon} <b>${f.label}</b>: veri yok`);
      continue;
    }
    const stale = r.tarih !== tarih ? ` (${fmtDay(r.tarih)})` : "";
    lines.push(
      `${f.icon} <b>${f.label}</b>: ${fmtPct(r.pct)} (eşik %${fmtNum(cfg.esikPct, 1)}) · ~${fmtSigned(r.tl)} TL/lt${stale}`
    );
    lines.push(`   ${LEVEL_TEXT[r.level]}`);
  }
  const parts = FUELS.map((f) => {
    const r = calc[f.key].latest;
    return r ? `${f.symbol.replace("2!", "")} ${fmtNum(r.raw, 1)}` : null;
  }).filter(Boolean);
  if (usd) lines.push(`Kur ${fmtNum(usd, 4)} · ${parts.join(" · ")} $/ton`);
  const last = FUELS.map((f) => {
    const c = calc[f.key].lastChange;
    return c ? `${f.label.toLocaleLowerCase("tr")} ${fmtDay(c.tarih)} (${fmtSigned(c.fark)} TL)` : null;
  }).filter(Boolean);
  if (last.length) lines.push(`Son değişiklik: ${last.join(", ")}`);
  for (const f of FUELS) {
    const r = calc[f.key].latest;
    if (!r?.calibrating) continue;
    lines.push(
      r.change
        ? `ℹ️ ${f.label}: ${fmtDay(r.change.tarih)} değişikliğinden önceki kapanışlar girilmedi; sapma ${fmtDay(r.baseTarih)} kapanışından hesaplanıyor.`
        : `ℹ️ ${f.label}: son pompa değişikliği henüz görülmedi; sapma ${fmtDay(r.baseTarih)} kapanışından hesaplanıyor.`
    );
  }
  lines.push("<i>Tahmindir; kesin değişikliği rafineri açıklar.</i>");
  return lines.join("\n");
}

export const ENTRY_HELP =
  "Her sabah (09:00–10:00) TradingView'dan dünkü kapanışı yazın:\n" +
  "• Motorin: <b>NYMEX:Z62!</b>\n• Benzin: <b>NYMEX:A3G2!</b>\n" +
  "Örnek: <code>z6 1025,3 a3g 985,3</code>\n" +
  "Geçmiş bir gün için tarih ekleyin: <code>z6 1025,3 a3g 985,3 20.10</code>\n" +
  "Durumu görmek için: /piyasa";

// --- Giriş ayrıştırma ------------------------------------------------------------

// "1,025.345" (TradingView), "1025,345" (Türkçe), "985.3" ... → sayı. Tek tür ayırıcı
// belirsizse ($/ton için) akla yatkın aralıkta kalan yorum seçilir.
export function parsePrice(s: string): number | null {
  const t = s.trim();
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const dot = t.lastIndexOf(".");
  const comma = t.lastIndexOf(",");
  const inRange = (n: number) => Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE;
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const n = Number(t.split(thou).join("").replace(dec, "."));
    return Number.isFinite(n) ? n : null;
  }
  const sep = comma >= 0 ? "," : dot >= 0 ? "." : null;
  if (!sep) return Number(t);
  const parts = t.split(sep);
  const asDecimal = parts.length === 2 ? Number(`${parts[0]}.${parts[1]}`) : NaN;
  const asThousands = parts.slice(1).every((p) => p.length === 3) ? Number(parts.join("")) : NaN;
  if (inRange(asDecimal)) return asDecimal;
  if (inRange(asThousands)) return asThousands;
  return Number.isFinite(asDecimal) ? asDecimal : Number.isFinite(asThousands) ? asThousands : null;
}

export type ParsedEntry = { z6?: number; a3g?: number; tarih?: string; error?: string };

export function parseEntryText(text: string, now = new Date()): ParsedEntry | null {
  let rest = text.toLocaleLowerCase("tr");
  const out: ParsedEntry = {};
  const re = /(z6(?:2!?)?|a3g(?:2!?)?|motorin|benzin)\s*[:=]?\s*(\d[\d.,]*)/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(rest))) {
    found = true;
    const n = parsePrice(m[2]);
    const key = m[1].startsWith("z6") || m[1] === "motorin" ? "z6" : "a3g";
    if (n == null) return { error: `"${m[2]}" sayı olarak okunamadı.` };
    out[key] = n;
  }
  if (!found) return null;
  rest = rest.replace(re, " ");
  const d = rest.match(/(?<![\d.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d.,])/);
  if (d) {
    const day = Number(d[1]);
    const mon = Number(d[2]);
    let year = d[3] ? Number(d[3].length === 2 ? `20${d[3]}` : d[3]) : now.getFullYear();
    let iso = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dt = parseIso(iso);
    if (mon < 1 || mon > 12 || dt.getDate() !== day) return { error: "Tarih anlaşılamadı (gün.ay yazın, ör. 20.10)." };
    if (!d[3] && iso > isoLocal(now)) {
      year -= 1;
      iso = `${year}-${iso.slice(5)}`;
    }
    out.tarih = iso;
  }
  return out;
}

// --- Kayıt + bildirim --------------------------------------------------------------

async function sendToChats(chatIds: string[], text: string): Promise<number> {
  let sent = 0;
  for (const id of chatIds) {
    try {
      await sendMessage(id, text);
      sent++;
    } catch (e) {
      console.error("[zam-tahmini] mesaj gönderilemedi:", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

// Rapor alan kişiler (Ayarlar → Telegram'da erişimi ve raporları açık olanlar).
function subscriberIds(exclude?: string): string[] {
  return listChats()
    .filter((c) => c.allowed && c.enabled && c.chatId !== exclude)
    .map((c) => c.chatId);
}

export type SaveResult = { ok: boolean; text: string; tarih?: string; broadcast?: number };

export async function saveQuote(input: {
  tarih?: string;
  z6?: number | null;
  a3g?: number | null;
  by: string; // chat_id ya da "portal"
}): Promise<SaveResult> {
  const tarih = input.tarih || defaultEntryDate();
  const z6 = input.z6 ?? null;
  const a3g = input.a3g ?? null;
  if (z6 == null && a3g == null) return { ok: false, text: "En az bir fiyat girin.\n\n" + ENTRY_HELP };
  for (const [label, v] of [["Motorin (Z62!)", z6], ["Benzin (A3G2!)", a3g]] as const) {
    if (v != null && (v < MIN_PRICE || v > MAX_PRICE))
      return {
        ok: false,
        text: `${label} için ${fmtNum(v, 1)} $/ton akla yatkın değil (${MIN_PRICE}–${MAX_PRICE} arası beklenir).`,
      };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return { ok: false, text: "Tarih geçersiz." };
  if (tarih > isoLocal(new Date())) return { ok: false, text: "İleri tarihli kapanış girilemez." };
  if (isWeekend(tarih)) return { ok: false, text: `${fmtDay(tarih)} hafta sonu; o gün kapanış olmaz.` };

  const db = getDb();
  const existing = db.prepare("SELECT usd FROM market_quotes WHERE tarih = ?").get(tarih) as
    | { usd: number }
    | undefined;
  let usd: number;
  try {
    usd = existing?.usd ?? (await getUsdRate(tarih));
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Kur alınamadı." };
  }

  // Yazım hatası uyarısı: aynı kontrat ayındaki önceki kapanışa göre büyük fark.
  const warnings: string[] = [];
  for (const [label, col, v] of [["Motorin", "z6", z6], ["Benzin", "a3g", a3g]] as const) {
    if (v == null) continue;
    const prev = db
      .prepare(`SELECT tarih, ${col} AS v FROM market_quotes WHERE tarih < ? AND ${col} IS NOT NULL ORDER BY tarih DESC LIMIT 1`)
      .get(tarih) as { tarih: string; v: number } | undefined;
    if (prev && v === prev.v)
      warnings.push(
        `⚠️ ${label} önceki kapanışla (${fmtDay(prev.tarih)}) birebir aynı; TradingView henüz güncellenmemiş olabilir. Rakam değişince tekrar yazın.`
      );
    else if (prev && prev.tarih.slice(0, 7) === tarih.slice(0, 7) && Math.abs(v / prev.v - 1) > JUMP_WARN)
      warnings.push(
        `⚠️ ${label} önceki kapanışa (${fmtDay(prev.tarih)}: ${fmtNum(prev.v, 1)}) göre ${fmtPct((v / prev.v - 1) * 100)} değişti; rakam yanlışsa tekrar yazın.`
      );
  }

  db.prepare(
    `INSERT INTO market_quotes (tarih, z6, a3g, usd, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tarih) DO UPDATE SET z6 = COALESCE(excluded.z6, z6), a3g = COALESCE(excluded.a3g, a3g),
       entered_by = excluded.entered_by, entered_at = excluded.entered_at`
  ).run(tarih, z6, a3g, usd, input.by, Date.now());

  const cfg = getForecastConfig();
  const status = buildStatusText(cfg);
  const head = `✅ ${fmtDay(tarih)} kapanışı kaydedildi.`;
  const text = [head, ...warnings, "", status].join("\n");

  // Günün kaydıysa (geçmiş gün ya da düzeltme değilse) rapor alanlara da gönder.
  let broadcast = 0;
  if (cfg.enabled && isTelegramConfigured() && tarih === defaultEntryDate() && getSetting("ff_last_broadcast") !== tarih) {
    const calc = computeForecast(cfg);
    const levels = FUELS.map((f) => calc[f.key].latest?.level ?? "notr").join(",");
    const prevLevels = getSetting("ff_last_levels") ?? "";
    const alert = levels.split(",").some((l) => l !== "notr") && levels !== prevLevels;
    if (cfg.gunlukDurum || alert) {
      setSetting("ff_last_broadcast", tarih);
      setSetting("ff_last_levels", levels);
      broadcast = await sendToChats(subscriberIds(input.by), status);
    }
  }
  return { ok: true, text, tarih, broadcast };
}

// Telegram botundan gelen mesaj ("z6 1025,3 a3g 985,3", "/piyasa").
export async function handleTelegramEntry(chatId: string, text: string): Promise<string> {
  const lower = text.trim().toLocaleLowerCase("tr");
  if (lower === "/piyasa" || lower === "/zam" || lower === "piyasa") return buildStatusText();
  const parsed = parseEntryText(text);
  if (!parsed) return ENTRY_HELP;
  if (parsed.error) return `${parsed.error}\n\n${ENTRY_HELP}`;
  const r = await saveQuote({ tarih: parsed.tarih, z6: parsed.z6, a3g: parsed.a3g, by: chatId });
  return r.text;
}

// --- Zamanlayıcı (pompa değişikliği + hatırlatma) ---------------------------------

async function checkPumpChanges(today: string): Promise<void> {
  const info = await ensureDailyPrices(STATION.plaka, STATION.il, STATION.ilce);
  if (info.rows.length === 0) return; // çekilemedi; sonraki turda tekrar
  setSetting("ff_pump_checked", today);
  const cfg = getForecastConfig();
  const calc = computeForecast(cfg);
  const lines: string[] = [];
  for (const f of FUELS) {
    const c = calc[f.key].changes.find((x) => x.tarih === today);
    const key = `ff_notified_${today}_${f.key}`;
    if (!c || getSetting(key)) continue;
    setSetting(key, "1");
    const dir = c.fark > 0 ? "zam" : "indirim";
    lines.push(
      `${f.icon} <b>${f.label}e ${dir} geldi</b>: ${fmtSigned(c.fark)} TL (${fmtNum(c.eski)} → ${fmtNum(c.yeni)})`
    );
    if (c.estimate)
      lines.push(`   Modelin beklentisi: ~${fmtSigned(c.estimate.tl)} TL (${fmtPct(c.estimate.pct)}, ${fmtDay(c.estimate.tarih)})`);
  }
  if (lines.length === 0) return;
  await sendToChats(subscriberIds(), ["⛽ <b>Pompa fiyatı değişti</b> (Petrol Ofisi, Sakarya)", ...lines].join("\n"));
}

async function remindMissing(today: string): Promise<void> {
  setSetting("ff_reminded", today);
  const want = prevBusinessDay(today);
  const row = getDb().prepare("SELECT 1 FROM market_quotes WHERE tarih = ?").get(want);
  if (row) return;
  // Hatırlatma, en son veri giren kişiye gider (portaldan girildiyse kimseye).
  const last = getDb()
    .prepare("SELECT entered_by FROM market_quotes WHERE entered_by IS NOT NULL AND entered_by != 'portal' ORDER BY entered_at DESC LIMIT 1")
    .get() as { entered_by: string } | undefined;
  if (!last) return;
  await sendToChats(
    [last.entered_by],
    `⏰ ${fmtDay(want)} kapanışı için Akdeniz fiyatı girilmedi.\n` +
      `TradingView'dan değerleri yazın, ör. <code>z6 1025,3 a3g 985,3 ${parseIso(want).getDate()}.${parseIso(want).getMonth() + 1}</code>`
  );
}

async function tick(): Promise<void> {
  const cfg = getForecastConfig();
  if (!cfg.enabled || !isTelegramConfigured()) return;
  const now = new Date();
  const today = isoLocal(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Fiyatlar 00:01'de değişir; marka siteleri sabah güncel olur.
  if (minutes >= 8 * 60 + 30 && minutes < 14 * 60 && getSetting("ff_pump_checked") !== today) {
    await checkPumpChanges(today);
  }
  const wd = now.getDay();
  if (wd >= 1 && wd <= 5 && minutes >= 10 * 60 + 30 && getSetting("ff_reminded") !== today) {
    await remindMissing(today);
  }
}

const g = globalThis as unknown as { __fuelForecastTimer?: ReturnType<typeof setInterval> };

export function startForecastScheduler(): void {
  if (g.__fuelForecastTimer) return;
  const run = () =>
    tick().catch((e) => console.error("[zam-tahmini] zamanlayıcı hatası:", e instanceof Error ? e.message : e));
  setTimeout(run, 90_000);
  g.__fuelForecastTimer = setInterval(run, 5 * 60_000);
}
