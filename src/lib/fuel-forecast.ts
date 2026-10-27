import getDb from "@/lib/db";
import { ensureDailyPrices } from "@/lib/fuel-prices";
import { isTelegramConfigured, listChats, sendMessage } from "@/lib/telegram";

// Zam/İndirim Tahmini. Türkiye'de rafineri fiyatı Akdeniz ürün fiyatı (Platts) × TCMB
// dolar kuruyla oluşur; son değişiklikten beri bu maliyet belli bir oranı aşınca pompaya
// zam ya da indirim gelir. Resmi formül yayınlanmadığı için eşik ve ortalama ayardır.
//
// Veri (otomatik, ücretsiz) — hepsi ICE'tan (ice.com ürün sayfalarının grafik verisi; site
// şartları otomatik erişimi kısıtlıyor, kullanıcı kararıyla kullanılıyor):
//  • Motorin: ICE Low Sulphur Gasoil (Avrupa motorini) — Platts Akdeniz motorini buna göre fiyatlanır.
//  • Benzin: ICE Premium Unleaded 10ppm FOB Med (Platts Akdeniz benzini) — Türkiye'nin benzin bazı.
//  • Brent (yalnız bilgi, hesaba girmez): ICE Brent.
//  Her biri önündeki ay kontratının günlük kapanışı ($/ton, Brent $/varil); günün kapanışı henüz
//  yayınlanmadıysa Londra 16:30 fiyatı gün içi veriden alınır. Veri gelmezse yedek kaynak yoktur;
//  o gün Telegram'dan hata bildirilir.
//  • Kur: TCMB günlük dolar satış kuru.
//  • Gerçekleşen değişiklikler: Petrol Ofisi'nin Serdivan fiyat arşivi (her gün); bugünün
//    fiyatı arşive ertesi gün düştüğü için sabah güncel fiyat sayfasından eklenir.
//
// Kontrat değişince (vade dolunca) seri zincirlenir (o günün oranı 1 sayılır). Daha önce
// kullanılan Yahoo (ABD motorin/benzin) ve TradingView (Platts Z6/A3G) kaynakları kaldırıldı.

export type Fuel = "motorin" | "benzin";
export type Level = "zam" | "zam_yakin" | "notr" | "indirim_yakin" | "indirim";

export type ForecastConfig = {
  enabled: boolean;
  esikPct: number; // rafinerinin fiyat değiştirdiği sapma (%)
  // Güncel maliyet: son kaç kapanışın ortalaması (yakıta göre).
  ortalamaMotorin: number;
  ortalamaBenzin: number;
  // Pompaya yansıyan / hesaplanan TL oranı. Geçmiş testten: motorin ~1,3, benzin ~0,95.
  katsayiMotorin: number;
  katsayiBenzin: number;
  eselPay: number; // eşel mobil: değişimin devletin ÖTV'den karşıladığı payı (%)
  gunlukDurum: boolean; // her gün durum gönder (kapalıysa yalnız uyarılar)
  yoksay: string[]; // baz sayılmayacak pompa değişiklikleri: "YYYY-MM-DD|yakit"
};

// Resmi hesap (sektör bilirkişisi): son 5 kapanışın ortalaması. Baz = değişiklikten bir gün
// önceki kapanış; bu ikili 27 Ekim'deki resmi "değer" mesajını benzinde birebir tutturdu (+2,60).
export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  enabled: true,
  esikPct: 3,
  ortalamaMotorin: 5,
  ortalamaBenzin: 5,
  katsayiMotorin: 1.3,
  katsayiBenzin: 0.95,
  eselPay: 0,
  gunlukDurum: true,
  yoksay: [],
};

export type PriceRow = {
  tarih: string; // Londra işlem günü
  ho: number | null; // eski (Yahoo ABD motorin, artık yazılmıyor)
  ho_kontrat: string | null;
  rb: number | null; // eski (Yahoo ABD benzin, artık yazılmıyor)
  rb_kontrat: string | null;
  brent: number | null; // $/varil (bilgi)
  ice: number | null; // Avrupa motorini (ICE gasoil), $/ton
  ice_kontrat: string | null; // ör. "ICE Nov26"
  med: number | null; // Akdeniz benzini (ICE/Platts Med), $/ton
  med_kontrat: string | null;
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
  raw: number; // $/ton
  kontrat: string; // ör. "ICE Nov26"
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

// ICE ürünleri: grafik verisi için ürün/hub kimlikleri ve ürün sayfası.
type IceProduct = { productId: number; hubId: number; page: string };
const ICE_GASOIL: IceProduct = { productId: 5817, hubId: 9373, page: "34361119/Low-Sulphur-Gasoil-Futures" };
const ICE_MED_GASOLINE: IceProduct = {
  productId: 3558,
  hubId: 4148,
  page: "6753555/Premium-Unleaded-Gasoline-10ppm-FOB-Med-Cargoes-Future",
};
const ICE_BRENT: IceProduct = { productId: 254, hubId: 403, page: "219/Brent-Crude-Futures" };

const FUELS = [
  {
    key: "motorin",
    col: "ice",
    kcol: "ice_kontrat",
    product: ICE_GASOIL,
    litrePerTon: 1000 / 0.845,
    label: "Motorin",
    icon: "🛢",
    source: "Avrupa motorin (ICE)",
  },
  {
    key: "benzin",
    col: "med",
    kcol: "med_kontrat",
    product: ICE_MED_GASOLINE,
    litrePerTon: 1000 / 0.745,
    label: "Benzin",
    icon: "⛽",
    source: "Akdeniz benzin (ICE)",
  },
] as const;

// Petrol Ofisi arşivi: il ve ilçe kodları sitenin kendi kodları (District/Search).
const PO = { cityId: "54", districtId: "05416", ad: "Petrol Ofisi Serdivan", il: "Sakarya", ilce: "Serdivan", plaka: 54 };
const PUMP_SOURCE = "po"; // kaynak değişirse pompa geçmişi silinip yeniden doldurulur
// Bu tutarın altındaki pompa farkları dağıtıcı/bayi marjı oynamasıdır, rafineri
// değişikliği sayılmaz (baz sıfırlanmaz).
const MIN_PUMP_CHANGE = 0.3;
const SNAPSHOT_LONDON = 16 * 60 + 30; // Platts/ICE kapanışı (Londra saati)
const FETCH_AFTER_LONDON = 16 * 60 + 45; // ICE gün içi verisi ~15 dk gecikmeli
// Akdeniz benzininde ekranda işlem olmadığı için o günün değeri ancak kapanış yayınlanınca
// gelir; motorin hazırsa bu saate kadar beklenir, sonra mesaj benzinin son değeriyle gider.
const BENZIN_WAIT_LONDON = 20 * 60 + 30;
const GIVE_UP_LONDON = 22 * 60; // bu saate kadar veri gelmezse o gün hata bildirilir
const BACKFILL_DAYS = 45; // ilk kurulumda geriye dönük doldurulan gün (ICE günlük verisi ~3 ay)

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

const CONFIG_KEY = "fuel_forecast_v4";
// Eski kayıtlar (v3: motorin 2 / benzin 3, v2: tek "ortalamaGun") aktarılır; ortalamalar resmi
// hesaptaki 5 güne geçer.
const OLD_CONFIG_KEYS = ["fuel_forecast_v3", "fuel_forecast_v2"];

export function getForecastConfig(): ForecastConfig {
  try {
    const raw = getSetting(CONFIG_KEY);
    if (raw) return { ...DEFAULT_FORECAST_CONFIG, ...(JSON.parse(raw) as Partial<ForecastConfig>) };
    for (const key of OLD_CONFIG_KEYS) {
      const old = getSetting(key);
      if (!old) continue;
      const o = JSON.parse(old) as Partial<ForecastConfig> & { ortalamaGun?: number };
      delete o.ortalamaGun;
      delete o.ortalamaMotorin;
      delete o.ortalamaBenzin;
      return { ...DEFAULT_FORECAST_CONFIG, ...o };
    }
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
    ortalamaMotorin: Math.round(num(patch.ortalamaMotorin, 1, 20, cur.ortalamaMotorin)),
    ortalamaBenzin: Math.round(num(patch.ortalamaBenzin, 1, 20, cur.ortalamaBenzin)),
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
// günlük çubuklar kapanış (settlement) fiyatıdır — gasoil ve Akdeniz benzini Londra 16:30
// (Platts değerlendirme saati), Brent 19:30.
const ICE_BASE = "https://www.ice.com/marketdata/api/productguide/charting";
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

// ICE'tan günlük kapanışları çekip kaydeder. İlk kurulumda (ya da bir yakıtın son 45 gününde
// eksik varsa) son 45 günü doldurur, sonra her seferinde son ~2 haftayı tazeler. Kayıtlı bir
// günün kontratı değiştiyse (vadesi geçti) o günün değeri olduğu gibi kalır; geçmiş tahminler
// değişmez. Hata olursa `errors` içinde döner (o yakıt boş kalır, başka kaynağa geçilmez).
export async function refreshMarket(
  now = new Date()
): Promise<{ added: string[]; latest: string; errors: string[] }> {
  const db = getDb();
  const latest = expectedLatestDate(now);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM market_prices").get() as { n: number }).n;
  const missing = (
    db
      .prepare("SELECT COUNT(*) AS n FROM market_prices WHERE tarih >= ? AND (ice IS NULL OR med IS NULL)")
      .get(addDays(latest, -BACKFILL_DAYS)) as { n: number }
  ).n;
  const days = businessDays(addDays(latest, count < 5 || missing > 3 ? -BACKFILL_DAYS : -14), latest);

  const errors: string[] = [];
  const fetchIce = async (label: string, product: IceProduct) => {
    try {
      return await iceDaily(product, latest, now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[zam-tahmini] ${label} alınamadı:`, msg);
      errors.push(`${label}: ${msg}`);
      return null;
    }
  };
  const fuelData: ({ kontrat: string; prices: Map<string, number> } | null)[] = [];
  for (const f of FUELS) fuelData.push(await fetchIce(f.source, f.product));
  // Brent yalnız bilgi; kontrat değişince geçmiş günler yeniden yazılmasın diye yalnız son 3 iş
  // günü güncellenir (16:30 fiyatı → kesin kapanış). Yahoo'dan ICE'a geçişte bir kez düzeltilir.
  const brent = await fetchIce("Brent (ICE)", ICE_BRENT);
  const brentFix = brent != null && getSetting("ff_brent_source") !== "ice";
  const brentDays = new Set(brentFix ? days : days.slice(-3));

  const existing = new Map((db.prepare("SELECT * FROM market_prices").all() as PriceRow[]).map((r) => [r.tarih, r]));
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO market_prices
       (tarih, ho, ho_kontrat, rb, rb_kontrat, brent, ice, ice_kontrat, med, med_kontrat, usd, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const added: string[] = [];
  for (const d of days) {
    const prev = existing.get(d);
    const vals = FUELS.map((f, i) => {
      const keep = prev && prev[f.col] != null ? { v: prev[f.col] as number, k: prev[f.kcol] as string | null } : null;
      const got = fuelData[i];
      const v = got?.prices.get(d);
      return v != null && (!keep || keep.k === got!.kontrat) ? { v, k: got!.kontrat } : keep;
    });
    const b = (prev?.brent == null || brentDays.has(d) ? brent?.prices.get(d) : undefined) ?? prev?.brent ?? null;
    if (vals.every((x) => x == null) && b == null) continue; // tatil ya da veri yok
    const usd = prev?.usd ?? (await getUsdRate(d));
    upsert.run(
      d,
      prev?.ho ?? null,
      prev?.ho_kontrat ?? null,
      prev?.rb ?? null,
      prev?.rb_kontrat ?? null,
      b,
      vals[0]?.v ?? null,
      vals[0]?.k ?? null,
      vals[1]?.v ?? null,
      vals[1]?.k ?? null,
      usd,
      Date.now()
    );
    if (!prev) added.push(d);
  }
  if (brentFix) setSetting("ff_brent_source", "ice");
  return { added, latest, errors };
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
  const n = Math.max(1, Math.round(fuel === "motorin" ? cfg.ortalamaMotorin : cfg.ortalamaBenzin));
  const kats = fuel === "motorin" ? cfg.katsayiMotorin : cfg.katsayiBenzin;

  // Zincirlenmiş seri: kontrat değişince aradaki fark sayılmaz.
  type Pt = { tarih: string; raw: number; kontrat: string; usd: number; idx: number; c: number; avg: number };
  const pts: Pt[] = [];
  for (const q of prices) {
    const raw = q[meta.col];
    const kontrat = q[meta.kcol];
    if (raw == null || !kontrat) continue;
    const prev = pts[pts.length - 1];
    const idx = !prev ? raw : prev.kontrat === kontrat ? (prev.idx * raw) / prev.raw : prev.idx;
    pts.push({ tarih: q.tarih, raw, kontrat, usd: q.usd, idx, c: idx * q.usd, avg: 0 });
  }
  pts.forEach((p, i) => {
    const win = pts.slice(Math.max(0, i - n + 1), i + 1);
    p.avg = win.reduce((a, x) => a + x.c, 0) / win.length;
  });

  const changes = allChanges.filter((c) => c.yakit === fuel && !c.ignored);
  const rows: FuelRow[] = pts.map((p) => {
    const ch = changes.filter((c) => c.tarih <= p.tarih).pop() ?? null;
    // Baz: değişiklikten bir gün önceki kapanış (değişiklik gününden önceki son kapanış).
    // Rafineri yeni fiyatı en son fiyat seviyesine göre belirler; ortalama alınca hızlı
    // hareketlerde baz geride kalıyordu (10 Ekim'de +6,40 TL'lik zam bunu gösterdi).
    let j = ch ? findLastIndex(pts, (x) => x.tarih < ch.tarih) : -1;
    let base: number;
    let calibrating = false;
    if (j >= 0) {
      base = pts[j].c;
    } else {
      j = ch ? pts.findIndex((x) => x.tarih >= ch.tarih) : 0;
      base = pts[j].c;
      calibrating = true;
    }
    const pct = (p.avg / base - 1) * 100;
    const perLitre = (p.raw * p.usd) / meta.litrePerTon; // TL/litre ürün maliyeti
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
      ...FUELS.map((f) => (row[f.col] != null ? `${f.source} ${fmtNum(row[f.col] as number, 2)} $/t` : null)),
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

  // 1) Piyasa: hafta içi Londra 16:45'ten sonra, o günün kapanışları alınana kadar. Motorin
  // hazır ama benzin henüz yoksa 20:30'a kadar beklenir; 22:00'ye kadar hiçbiri gelmezse hata
  // bildirilir (yedek kaynak yok).
  const lon = zoned(now, "Europe/London");
  if (!isWeekend(lon.iso) && lon.minutes >= FETCH_AFTER_LONDON && getSetting("ff_market_day") !== lon.iso) {
    let errors: string[] = [];
    try {
      errors = (await refreshMarket(now)).errors;
    } catch (e) {
      errors = [e instanceof Error ? e.message : String(e)];
      console.error("[zam-tahmini] piyasa verisi alınamadı:", errors[0]);
    }
    const row = getDb().prepare("SELECT ice, med FROM market_prices WHERE tarih = ?").get(lon.iso) as
      | { ice: number | null; med: number | null }
      | undefined;
    const have = FUELS.filter((f) => row?.[f.col] != null);
    const done = have.length === FUELS.length || (have.length > 0 && lon.minutes >= BENZIN_WAIT_LONDON);
    if (done) {
      setSetting("ff_market_day", lon.iso);
      await broadcastDay(lon.iso);
    }
    // Hata bildirimi: gerçek bir çekim hatası varken eksik yakıt kaldıysa, ya da 22:00'ye kadar
    // hiç veri gelmediyse. (Benzin kapanışı geç yayınlanırsa uyarı atılmaz; mesajda benzinin
    // son değeri tarihiyle görünür, ertesi günkü tazelemede tamamlanır.)
    const eksik = FUELS.filter((f) => row?.[f.col] == null).map((f) => f.source);
    if ((done && eksik.length > 0 && errors.length > 0) || (!done && lon.minutes >= GIVE_UP_LONDON)) {
      setSetting("ff_market_day", lon.iso);
      if (isTelegramConfigured())
        await sendToChats(
          subscriberIds(),
          `⚠️ <b>Zam tahmini: ICE verisi alınamadı</b> (${fmtDay(lon.iso)})\n` +
            `Eksik: ${eksik.join(", ")}.` +
            (errors.length ? `\nHata: ${errors.join(" · ")}` : "\nICE o gün kapanış yayınlamamış olabilir (tatil).") +
            (have.length ? "\nEksik yakıt için son bilinen değer kullanıldı." : "\nBugün tahmin gönderilemedi.")
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
