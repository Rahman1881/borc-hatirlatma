import getDb from "@/lib/db";
import { ensureDailyPrices } from "@/lib/fuel-prices";
import { isTelegramConfigured, listChats, sendMessage } from "@/lib/telegram";

// Zam/İndirim Tahmini. Türkiye'de rafineri fiyatı Akdeniz ürün fiyatı (Platts) × TCMB
// dolar kuruyla oluşur; son değişiklikten beri bu maliyet belli bir oranı aşınca pompaya
// zam ya da indirim gelir. Resmi formül yayınlanmadığı için eşik ve ortalama ayardır.
//
// Veri (otomatik, ücretsiz):
//  • Motorin: Avrupa motorini — ICE Low Sulphur Gasoil, önündeki ay kontratının Londra 16:30
//    kapanışı ($/ton). Platts Akdeniz motorini bu kontrata göre fiyatlanır. ice.com'un kendi
//    grafik verisinden günde 2–3 istekle alınır (kullanıcı kararı; site şartları otomatik
//    erişimi kısıtlıyor). Gelmediği gün yerine ABD motorini (aşağıda) kullanılır.
//  • Benzin (ve motorin yedeği): Yahoo Finance'ten ABD benzin (RBOB) ve motorin (NYMEX Heating
//    Oil) vadelileri, her iş günü Londra 16:30'daki fiyat. Platts ücretli; TradingView'daki
//    Platts kontratları (Z6/A3G) işlem görmediği için günlerce aynı kalıyor.
//  • Brent (yalnız bilgi, hesaba girmez): ICE Brent önündeki ay kontratı — haberlerdeki "Brent".
//  • Kur: TCMB günlük dolar satış kuru.
//  • Gerçekleşen değişiklikler: Petrol Ofisi'nin Serdivan fiyat arşivi (her gün); bugünün
//    fiyatı arşive ertesi gün düştüğü için sabah güncel fiyat sayfasından eklenir.
//
// Kontrat: her ay bir sonraki ayın kontratı (Ekim'de Kasım). Yahoo'nun sürekli serisi
// (HO=F) geçişi vadeden önce rastgele yaptığı ve aylar arası fark büyük olduğu için
// kullanılmaz; kontrat değişince seri zincirlenir (o günün oranı 1 sayılır).

export type Fuel = "motorin" | "benzin";
export type Level = "zam" | "zam_yakin" | "notr" | "indirim_yakin" | "indirim";

export type ForecastConfig = {
  enabled: boolean;
  esikPct: number; // rafinerinin fiyat değiştirdiği sapma (%)
  ortalamaGun: number; // kaç kapanışın ortalaması alınır
  // Pompaya yansıyan / hesaplanan TL oranı. Geçmiş testten: motorin ~1,3, benzin ~0,95.
  katsayiMotorin: number;
  katsayiBenzin: number;
  eselPay: number; // eşel mobil: değişimin devletin ÖTV'den karşıladığı payı (%)
  gunlukDurum: boolean; // her gün durum gönder (kapalıysa yalnız uyarılar)
  yoksay: string[]; // baz sayılmayacak pompa değişiklikleri: "YYYY-MM-DD|yakit"
};

// Geçmiş test (2023-03 → 2026-10): 3 kapanış ortalaması, %3 eşik → motorinde alarmların
// ~%67'si 5 iş günü içinde aynı yönde değişiklikle sonuçlandı, ortalama ~2,8 iş günü önce.
export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  enabled: true,
  esikPct: 3,
  ortalamaGun: 3,
  katsayiMotorin: 1.3,
  katsayiBenzin: 0.95,
  eselPay: 0,
  gunlukDurum: true,
  yoksay: [],
};

export type PriceRow = {
  tarih: string; // Londra işlem günü
  ho: number | null; // $/galon
  ho_kontrat: string | null;
  rb: number | null;
  rb_kontrat: string | null;
  brent: number | null; // $/varil (bilgi)
  ice: number | null; // Avrupa motorini, $/ton
  ice_kontrat: string | null; // ör. "ICE Nov26"
  usd: number;
  fetched_at: number;
};

export type PumpChange = {
  tarih: string; // yeni fiyatın geçerli olduğu gün
  yakit: Fuel;
  eski: number;
  yeni: number;
  fark: number;
  ignored: boolean;
};

export type FuelRow = {
  tarih: string;
  raw: number; // ICE: $/ton, Yahoo: $/galon
  kontrat: string; // "ICE Nov26" ya da "HOX26.NYM"
  usd: number;
  pct: number; // son değişiklikteki baza göre sapma (%)
  tl: number; // pompaya yansıması beklenen TL/litre (KDV dahil)
  level: Level;
  change: PumpChange | null; // hesaba esas son pompa değişikliği
  baseTarih: string;
  calibrating: boolean; // değişiklikten önceki piyasa verisi yok; baz ilk gün
};

export type FuelCalc = {
  yakit: Fuel;
  rows: FuelRow[];
  latest: FuelRow | null;
  lastChange: PumpChange | null;
  changes: (PumpChange & { estimate: FuelRow | null })[];
};

const FUELS = [
  { key: "motorin", col: "ho", kcol: "ho_kontrat", root: "HO", label: "Motorin", icon: "🛢" },
  { key: "benzin", col: "rb", kcol: "rb_kontrat", root: "RB", label: "Benzin", icon: "⛽" },
] as const;

// Petrol Ofisi arşivi: il ve ilçe kodları sitenin kendi kodları (District/Search).
const PO = { cityId: "54", districtId: "05416", ad: "Petrol Ofisi Serdivan", il: "Sakarya", ilce: "Serdivan", plaka: 54 };
const PUMP_SOURCE = "po"; // kaynak değişirse pompa geçmişi silinip yeniden doldurulur
// Bu tutarın altındaki pompa farkları dağıtıcı/bayi marjı oynamasıdır, rafineri
// değişikliği sayılmaz (baz sıfırlanmaz).
const MIN_PUMP_CHANGE = 0.3;
const LITRE_PER_GALLON = 3.78541;
const DIESEL_LITRE_PER_TON = 1000 / 0.845;
const SNAPSHOT_LONDON = 16 * 60 + 30; // Platts/ICE kapanışı (Londra saati)
const FETCH_AFTER_LONDON = 16 * 60 + 45; // Yahoo vadeli verisi ~10 dk gecikmeli
const GIVE_UP_LONDON = 22 * 60; // bu saate kadar veri gelmezse o gün uyarılır
const BACKFILL_DAYS = 45; // ilk kurulumda geriye dönük doldurulan gün (Yahoo 15 dk verisi 60 gün)

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

const CONFIG_KEY = "fuel_forecast_v2";

export function getForecastConfig(): ForecastConfig {
  try {
    const raw = getSetting(CONFIG_KEY);
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
    return v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const next: ForecastConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    esikPct: num(patch.esikPct, 0.5, 20, cur.esikPct),
    ortalamaGun: Math.round(num(patch.ortalamaGun, 1, 20, cur.ortalamaGun)),
    katsayiMotorin: num(patch.katsayiMotorin, 0.1, 5, cur.katsayiMotorin),
    katsayiBenzin: num(patch.katsayiBenzin, 0.1, 5, cur.katsayiBenzin),
    eselPay: num(patch.eselPay, 0, 100, cur.eselPay),
    gunlukDurum: typeof patch.gunlukDurum === "boolean" ? patch.gunlukDurum : cur.gunlukDurum,
    yoksay: Array.isArray(patch.yoksay) ? patch.yoksay.map(String) : cur.yoksay,
  };
  setSetting(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function setChangeIgnored(tarih: string, yakit: Fuel, ignored: boolean): ForecastConfig {
  const key = `${tarih}|${yakit}`;
  const set = new Set(getForecastConfig().yoksay);
  if (ignored) set.add(key);
  else set.delete(key);
  return saveForecastConfig({ yoksay: [...set] });
}

// --- Tarih yardımcıları ------------------------------------------------------

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
function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
}

// Verilen saat dilimindeki tarih ve gün içi dakika.
function zoned(now: Date, timeZone: string): { iso: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// En son hangi günün Londra kapanışı alınabilir: hafta içi 16:45 sonrası o gün, değilse
// bir önceki iş günü.
export function expectedLatestDate(now = new Date()): string {
  const lon = zoned(now, "Europe/London");
  if (!isWeekend(lon.iso) && lon.minutes >= FETCH_AFTER_LONDON) return lon.iso;
  return prevBusinessDay(lon.iso);
}

// Verinin Türkiye saatiyle kaçta çekileceği ("18:45"; Avrupa kış saatinde "19:45").
export function fetchTimeTr(now = new Date()): string {
  const lon = zoned(now, "Europe/London");
  let diff = now.getHours() * 60 + now.getMinutes() - lon.minutes;
  if (diff < 0) diff += 24 * 60;
  const m = (FETCH_AFTER_LONDON + diff) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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

// --- Dış kaynaklar -------------------------------------------------------------

// TCMB günlük kuru; tatil/hafta sonu ise bir önceki yayımlanan kur.
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

const MONTH_CODES = "FGHJKMNQUVXZ";
// Bir günde kullanılacak kontrat: bir sonraki ayın vadelisi (HO/RB, vadesinden önceki
// ayın son iş günü sona erer; ay boyunca geçerli kalır).
function contractFor(iso: string, root: string): string {
  const [y, m] = iso.split("-").map(Number);
  const dm = m === 12 ? 1 : m + 1;
  const dy = m === 12 ? y + 1 : y;
  return `${root}${MONTH_CODES[dm - 1]}${String(dy).slice(2)}.NYM`;
}

// Yahoo 15 dakikalık verisinden her günün Londra 16:30 fiyatı (son 60 gün). Vadesi geçmiş
// kontratlar Yahoo'da yok → null.
async function londonSnapshots(symbol: string): Promise<Map<string, number> | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=60d&interval=15m`,
    { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const j = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = j.chart?.result?.[0];
  const ts = r?.timestamp;
  const close = r?.indicators?.quote?.[0]?.close;
  if (!ts || !close) return null;
  const out = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (c == null) continue;
    // Çubuk zamanı başlangıçtır; 16:15 çubuğunun kapanışı 16:30 fiyatıdır.
    const z = zoned(new Date(ts[i] * 1000), "Europe/London");
    if (z.minutes >= 12 * 60 && z.minutes <= SNAPSHOT_LONDON - 15) out.set(z.iso, c);
  }
  return out;
}

// Petrol Ofisi fiyat arşivi (sitedeki "Arşiv Fiyatları" sayfasının isteği): her gün için
// KDV dahil V/Max Kurşunsuz 95 ve V/Max Diesel — güncel fiyat sayfasıyla aynı ürünler.
async function fetchPoArchive(from: string, to: string): Promise<{ tarih: string; benzin?: number; motorin?: number }[]> {
  const res = await fetch("https://www.petrolofisi.com.tr/Fuel/Search", {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ template: "3", cityId: PO.cityId, districtId: PO.districtId, startDate: from, endDate: to }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Petrol Ofisi arşivi: HTTP ${res.status}`);
  const html = await res.text();
  const strip = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => strip(c[1]).trim())
  );
  const head = rows.find((r) => r[0] === "Tarih");
  if (!head) throw new Error("Petrol Ofisi arşivi okunamadı (tablo bulunamadı).");
  const iB = head.indexOf("V/Max Kurşunsuz 95");
  const iM = head.indexOf("V/Max Diesel");
  const first = (t: string | undefined) => {
    const m = t?.match(/(\d+\.\d+)/);
    return m ? Number(m[1]) : undefined;
  };
  const out: { tarih: string; benzin?: number; motorin?: number }[] = [];
  for (const r of rows) {
    const d = r[0]?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!d) continue;
    out.push({ tarih: `${d[3]}-${d[2]}-${d[1]}`, benzin: first(r[iB]), motorin: first(r[iM]) });
  }
  return out;
}

// ICE: ice.com ürün sayfalarının grafik verisi. Önündeki ay kontratı listenin ilk sırasındadır;
// günlük çubuklar kapanış (settlement) fiyatıdır — gasoil Londra 16:30, Brent 19:30.
const ICE_BASE = "https://www.ice.com/marketdata/api/productguide/charting";
type IceProduct = { productId: number; hubId: number; page: string };
const ICE_GASOIL: IceProduct = { productId: 5817, hubId: 9373, page: "34361119/Low-Sulphur-Gasoil-Futures" };
const ICE_BRENT: IceProduct = { productId: 254, hubId: 403, page: "219/Brent-Crude-Futures" };
const ICE_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

async function iceJson<T>(product: IceProduct, path: string): Promise<T> {
  const res = await fetch(`${ICE_BASE}/${path}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      Referer: `https://www.ice.com/products/${product.page}/data`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ICE: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// "Fri Oct 23 15:20:00 2026" → { iso: "2026-10-23", minutes: 920 } (ICE saatleri GMT).
function iceTime(s: string): { iso: string; minutes: number } | null {
  const m = s.match(/^\w{3} (\w{3}) (\d{2}) (\d{2}):(\d{2}):\d{2} (\d{4})$/);
  if (!m || !ICE_MONTHS[m[1]]) return null;
  return { iso: `${m[5]}-${ICE_MONTHS[m[1]]}-${m[2]}`, minutes: Number(m[3]) * 60 + Number(m[4]) };
}

// Önündeki ay kontratının günlük kapanışları (son ~3 ay); `today` kapanışı henüz
// yayınlanmadıysa o günün Londra 16:30 fiyatı gün içi verisinden eklenir.
async function iceDaily(
  product: IceProduct,
  today: string,
  now: Date
): Promise<{ kontrat: string; prices: Map<string, number> }> {
  const list = await iceJson<{ marketId: number; marketStrip: string }[]>(
    product,
    `contract-data?productId=${product.productId}&hubId=${product.hubId}&mode=2`
  );
  const front = list[0];
  if (!front) throw new Error("ICE: kontrat listesi boş.");
  const hist = await iceJson<{ bars?: [string, number][] }>(
    product,
    `data/historical?marketId=${front.marketId}&historicalSpan=1`
  );
  const prices = new Map<string, number>();
  for (const [t, v] of hist.bars ?? []) {
    const z = iceTime(t);
    if (z && Number.isFinite(v)) prices.set(z.iso, v);
  }
  if (!prices.has(today)) {
    // Londra 16:30'un GMT karşılığı (yaz saatinde 15:30); 10 dk'lık çubuğun kapanışı.
    const lon = zoned(now, "Europe/London");
    const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
    let offset = lon.minutes - utc;
    if (offset < -720) offset += 1440;
    if (offset > 720) offset -= 1440;
    const cutoff = SNAPSHOT_LONDON - offset - 10;
    const day = await iceJson<{ bars?: [string, number][] }>(
      product,
      `data/current-day?mode=2&marketId=${front.marketId}`
    );
    let snap: number | null = null;
    for (const [t, v] of day.bars ?? []) {
      const z = iceTime(t);
      if (z && z.iso === today && z.minutes <= cutoff && Number.isFinite(v)) snap = v;
    }
    if (snap != null) prices.set(today, snap);
  }
  return { kontrat: `ICE ${front.marketStrip}`, prices };
}

// --- Veri ----------------------------------------------------------------------

export function listPrices(): PriceRow[] {
  return getDb().prepare("SELECT * FROM market_prices ORDER BY tarih ASC").all() as PriceRow[];
}

export async function refreshPumpPrices(days: number): Promise<number> {
  const db = getDb();
  if (getSetting("ff_pump_source") !== PUMP_SOURCE) {
    db.prepare("DELETE FROM pump_prices").run();
    setSetting("ff_pump_source", PUMP_SOURCE);
    days = Math.max(days, 420);
  }
  const today = isoLocal(new Date());
  const stmt = db.prepare("INSERT OR REPLACE INTO pump_prices (tarih, yakit, fiyat) VALUES (?, ?, ?)");
  const rows = await fetchPoArchive(addDays(today, -days), today);
  for (const r of rows) {
    if (r.motorin) stmt.run(r.tarih, "motorin", r.motorin);
    if (r.benzin) stmt.run(r.tarih, "benzin", r.benzin);
  }
  // Bugünün fiyatı arşive ertesi gün düşer; güncel fiyat sayfasından ekle.
  if (!rows.some((r) => r.tarih === today)) {
    const info = await ensureDailyPrices(PO.plaka, PO.il, PO.ilce).catch(() => null);
    for (const p of info?.rows ?? []) {
      if (p.tarih !== today || !p.marka.toLocaleLowerCase("tr").includes("petrol ofisi")) continue;
      if (p.yakit === "motorin" || p.yakit === "benzin") stmt.run(today, p.yakit, p.fiyat);
    }
  }
  return rows.length;
}

export function getPumpChanges(cfg = getForecastConfig()): PumpChange[] {
  const rows = getDb()
    .prepare("SELECT tarih, yakit, fiyat FROM pump_prices ORDER BY yakit, tarih")
    .all() as { tarih: string; yakit: Fuel; fiyat: number }[];
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

// Yahoo ve ICE'tan Londra 16:30 fiyatlarını çekip kaydeder. İlk kurulumda son 45 günü
// doldurur, sonra her seferinde son ~2 haftayı tazeler. Kayıtlı bir günün kontratı
// değiştiyse (vadesi geçti) o günün değeri olduğu gibi kalır; geçmiş tahminler değişmez.
export async function refreshMarket(now = new Date()): Promise<{ added: string[]; latest: string }> {
  const db = getDb();
  const latest = expectedLatestDate(now);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM market_prices").get() as { n: number }).n;
  // İlk kurulumda ya da ICE sonradan eklendiğinde (son 45 günde ICE'sız kayıt varsa) geriye doldur.
  const noIce = (
    db
      .prepare("SELECT COUNT(*) AS n FROM market_prices WHERE tarih >= ? AND ice IS NULL")
      .get(addDays(latest, -BACKFILL_DAYS)) as { n: number }
  ).n;
  const days = businessDays(addDays(latest, count < 5 || noIce > 3 ? -BACKFILL_DAYS : -14), latest);

  // Her yakıt için gereken kontratlar + yedek olarak bugünün kontratı (vadesi geçmiş
  // kontratların Yahoo'da verisi olmadığından eski günler bununla doldurulur).
  const snaps = new Map<string, Map<string, number> | null>();
  for (const f of FUELS) {
    const need = new Set([...days.map((d) => contractFor(d, f.root)), contractFor(latest, f.root)]);
    for (const sym of need) if (!snaps.has(sym)) snaps.set(sym, await londonSnapshots(sym));
  }
  // Brent (yalnız bilgi): ICE önündeki ay kontratı. Yahoo'nun BZ=F serisi vadeden önce bir
  // sonraki kontrata geçtiği için kullanılmaz. Kontrat değişince geçmiş günler yeni kontratla
  // yeniden yazılmasın diye yalnız son 3 iş günü güncellenir (16:30 fiyatı → kesin kapanış).
  const brent = await iceDaily(ICE_BRENT, latest, now).catch((e) => {
    console.error("[zam-tahmini] ICE Brent alınamadı:", e instanceof Error ? e.message : e);
    return null;
  });
  // Kaynak Yahoo'dan ICE'a geçtiğinde bir kez bütün pencere düzeltilir.
  const brentFix = brent != null && getSetting("ff_brent_source") !== "ice";
  const brentDays = new Set(brentFix ? days : days.slice(-3));
  const ice = await iceDaily(ICE_GASOIL, latest, now).catch((e) => {
    console.error("[zam-tahmini] ICE verisi alınamadı, motorinde ABD verisi kullanılacak:", e instanceof Error ? e.message : e);
    return null;
  });

  const existing = new Map((db.prepare("SELECT * FROM market_prices").all() as PriceRow[]).map((r) => [r.tarih, r]));
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO market_prices (tarih, ho, ho_kontrat, rb, rb_kontrat, brent, ice, ice_kontrat, usd, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const added: string[] = [];
  for (const d of days) {
    const prev = existing.get(d);
    const yahoo = FUELS.map((f) => {
      const keep = prev && prev[f.col] != null ? { v: prev[f.col] as number, k: prev[f.kcol] as string } : null;
      const natural = contractFor(d, f.root);
      const v = snaps.get(natural)?.get(d);
      if (v != null) return { v, k: natural };
      if (keep) return keep;
      const fallback = contractFor(latest, f.root);
      const w = snaps.get(fallback)?.get(d);
      return w != null ? { v: w, k: fallback } : null;
    });
    const iv = ice?.prices.get(d);
    const keepIce = prev?.ice != null ? { v: prev.ice, k: prev.ice_kontrat } : null;
    const iceVal =
      iv != null && (!keepIce || keepIce.k === ice!.kontrat) ? { v: iv, k: ice!.kontrat } : keepIce;
    if (yahoo.every((x) => x == null) && !iceVal) continue; // tatil ya da veri yok
    const usd = prev?.usd ?? (await getUsdRate(d));
    upsert.run(
      d,
      yahoo[0]?.v ?? null,
      yahoo[0]?.k ?? null,
      yahoo[1]?.v ?? null,
      yahoo[1]?.k ?? null,
      (prev?.brent == null || brentDays.has(d) ? brent?.prices.get(d) : undefined) ?? prev?.brent ?? null,
      iceVal?.v ?? null,
      iceVal?.k ?? null,
      usd,
      Date.now()
    );
    if (!prev) added.push(d);
  }
  if (brentFix) setSetting("ff_brent_source", "ice");
  return { added, latest };
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

function buildFuel(fuel: Fuel, prices: PriceRow[], allChanges: PumpChange[], cfg: ForecastConfig): FuelCalc {
  const meta = FUELS.find((f) => f.key === fuel)!;
  const n = Math.max(1, Math.round(cfg.ortalamaGun));
  const kats = fuel === "motorin" ? cfg.katsayiMotorin : cfg.katsayiBenzin;

  // Zincirlenmiş seri: kontrat (ya da kaynak) değişince aradaki fark sayılmaz. Motorinde
  // ICE varsa o, yoksa ABD motorini; litre başına maliyet birimine göre hesaplanır.
  type Pt = { tarih: string; raw: number; kontrat: string; usd: number; perUnit: number; idx: number; c: number; avg: number };
  const pts: Pt[] = [];
  for (const q of prices) {
    const useIce = fuel === "motorin" && q.ice != null && q.ice_kontrat;
    const raw = useIce ? q.ice : q[meta.col];
    const kontrat = useIce ? q.ice_kontrat : q[meta.kcol];
    if (raw == null || !kontrat) continue;
    const perUnit = useIce ? 1 / DIESEL_LITRE_PER_TON : 1 / LITRE_PER_GALLON; // birim → litre
    const prev = pts[pts.length - 1];
    const idx = !prev ? raw : prev.kontrat === kontrat ? (prev.idx * raw) / prev.raw : prev.idx;
    pts.push({ tarih: q.tarih, raw, kontrat, usd: q.usd, perUnit, idx, c: idx * q.usd, avg: 0 });
  }
  pts.forEach((p, i) => {
    const win = pts.slice(Math.max(0, i - n + 1), i + 1);
    p.avg = win.reduce((a, x) => a + x.c, 0) / win.length;
  });

  const changes = allChanges.filter((c) => c.yakit === fuel && !c.ignored);
  const rows: FuelRow[] = pts.map((p) => {
    const ch = changes.filter((c) => c.tarih <= p.tarih).pop() ?? null;
    // Baz: değişiklik gününden önceki son kapanıştaki ortalama.
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
    const perLitre = p.raw * p.usd * p.perUnit; // TL/litre ürün maliyeti
    const tl = (pct / 100) * perLitre * 1.2 * kats * (1 - cfg.eselPay / 100);
    return {
      tarih: p.tarih,
      raw: p.raw,
      kontrat: p.kontrat,
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
  const prices = listPrices();
  const changes = getPumpChanges(cfg);
  return {
    motorin: buildFuel("motorin", prices, changes, cfg),
    benzin: buildFuel("benzin", prices, changes, cfg),
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
    return `📈 <b>Zam/İndirim Tahmini</b>\nHenüz piyasa verisi yok. Veri her iş günü saat ~${fetchTimeTr()} sonrası otomatik çekilir.`;
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

  lines.push(`📈 <b>Zam/İndirim Tahmini</b> · ${fmtDay(tarih)} Avrupa kapanışı`);
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
  const row = listPrices().find((p) => p.tarih === tarih);
  if (row) {
    const parts = [
      // ICE yoksa motorin ABD verisinden hesaplandığı için onu gösterir.
      row.ice != null
        ? `Avrupa motorin (ICE) ${fmtNum(row.ice, 2)} $/t`
        : row.ho != null
          ? `ABD motorin ${fmtNum(row.ho, 3)} $/gal`
          : null,
      row.brent != null ? `Brent ${fmtNum(row.brent, 1)} $` : null,
    ].filter(Boolean);
    lines.push(`Kur ${fmtNum(row.usd, 4)} · ${parts.join(" · ")}`);
  }
  const last = FUELS.map((f) => {
    const c = calc[f.key].lastChange;
    return c ? `${f.label.toLocaleLowerCase("tr")} ${fmtDay(c.tarih)} (${fmtSigned(c.fark)} TL)` : null;
  }).filter(Boolean);
  if (last.length) lines.push(`Son pompa değişikliği: ${last.join(", ")}`);
  for (const f of FUELS) {
    const r = calc[f.key].latest;
    if (r?.calibrating)
      lines.push(
        `ℹ️ ${f.label}: son değişiklikten önceki piyasa verisi yok; sapma ${fmtDay(r.baseTarih)} kapanışından hesaplanıyor.`
      );
  }
  return lines.join("\n");
}

// --- Bildirim ------------------------------------------------------------------

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
function subscriberIds(): string[] {
  return listChats()
    .filter((c) => c.allowed && c.enabled)
    .map((c) => c.chatId);
}

// Günün kapanışı geldiyse (bir kez) rapor alanlara gönderir.
async function broadcastDay(tarih: string): Promise<number> {
  const cfg = getForecastConfig();
  if (!cfg.enabled || !isTelegramConfigured() || getSetting("ff_last_broadcast") === tarih) return 0;
  const calc = computeForecast(cfg);
  const levels = FUELS.map((f) => calc[f.key].latest?.level ?? "notr").join(",");
  const prevLevels = getSetting("ff_last_levels") ?? "";
  const alert = levels.split(",").some((l) => l !== "notr") && levels !== prevLevels;
  setSetting("ff_last_broadcast", tarih);
  if (!cfg.gunlukDurum && !alert) return 0;
  setSetting("ff_last_levels", levels);
  return sendToChats(subscriberIds(), buildStatusText(cfg));
}

async function checkPumpChanges(today: string): Promise<void> {
  await refreshPumpPrices(30);
  setSetting("ff_pump_checked", today);
  const calc = computeForecast();
  const lines: string[] = [];
  for (const f of FUELS) {
    const c = calc[f.key].changes.find((x) => x.tarih === today);
    const key = `ff_notified_${today}_${f.key}`;
    if (!c || getSetting(key)) continue;
    setSetting(key, "1");
    const dir = c.fark > 0 ? "zam" : "indirim";
    lines.push(`${f.icon} <b>${f.label}e ${dir} geldi</b>: ${fmtSigned(c.fark)} TL (${fmtNum(c.eski)} → ${fmtNum(c.yeni)})`);
    if (c.estimate)
      lines.push(
        `   Modelin beklentisi: ~${fmtSigned(c.estimate.tl)} TL (${fmtPct(c.estimate.pct)}, ${fmtDay(c.estimate.tarih)})`
      );
  }
  if (lines.length === 0 || !isTelegramConfigured()) return;
  await sendToChats(subscriberIds(), [`⛽ <b>Pompa fiyatı değişti</b> (${PO.ad})`, ...lines].join("\n"));
}

// --- Zamanlayıcı ---------------------------------------------------------------

async function tick(): Promise<void> {
  const cfg = getForecastConfig();
  if (!cfg.enabled) return;
  const now = new Date();

  // 1) Piyasa: hafta içi Londra 16:45'ten sonra, o günün kapanışı alınana kadar.
  const lon = zoned(now, "Europe/London");
  if (!isWeekend(lon.iso) && lon.minutes >= FETCH_AFTER_LONDON && getSetting("ff_market_day") !== lon.iso) {
    try {
      await refreshMarket(now);
    } catch (e) {
      console.error("[zam-tahmini] piyasa verisi alınamadı:", e instanceof Error ? e.message : e);
    }
    const got = getDb().prepare("SELECT 1 FROM market_prices WHERE tarih = ?").get(lon.iso);
    if (got) {
      setSetting("ff_market_day", lon.iso);
      await broadcastDay(lon.iso);
    } else if (lon.minutes >= GIVE_UP_LONDON) {
      setSetting("ff_market_day", lon.iso);
      if (isTelegramConfigured())
        await sendToChats(
          subscriberIds(),
          `⚠️ ${fmtDay(lon.iso)} için piyasa verisi alınamadı (ABD piyasası tatil olabilir); bugün tahmin gönderilemedi.`
        );
    }
  }

  // 2) Pompa: fiyatlar 00:01'de değişir; sabah Petrol Ofisi'nden kontrol.
  const today = isoLocal(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 8 * 60 + 30 && minutes < 14 * 60 && getSetting("ff_pump_checked") !== today) {
    await checkPumpChanges(today);
  }
}

// İlk açılışta (ya da pompa kaynağı değişince): pompa geçmişi (Petrol Ofisi, ~14 ay) ve son
// 45 günün piyasa verisi.
export async function bootstrapForecast(): Promise<void> {
  const db = getDb();
  const pumps = (db.prepare("SELECT COUNT(*) AS n FROM pump_prices").get() as { n: number }).n;
  if (pumps === 0 || getSetting("ff_pump_source") !== PUMP_SOURCE) await refreshPumpPrices(420);
  const prices = (db.prepare("SELECT COUNT(*) AS n FROM market_prices").get() as { n: number }).n;
  if (prices < 5) await refreshMarket();
}

const g = globalThis as unknown as { __fuelForecastTimer?: ReturnType<typeof setInterval> };

export function startForecastScheduler(): void {
  if (g.__fuelForecastTimer) return;
  const log = (e: unknown) => console.error("[zam-tahmini]", e instanceof Error ? e.message : e);
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    tick()
      .catch(log)
      .finally(() => {
        busy = false;
      });
  };
  setTimeout(() => {
    bootstrapForecast().catch(log).finally(run);
  }, 90_000);
  g.__fuelForecastTimer = setInterval(run, 5 * 60_000);
}
