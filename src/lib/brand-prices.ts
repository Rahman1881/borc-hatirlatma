import type { FuelType, PriceRow } from "@/lib/fuel-prices";

// Marka dağıtıcılarının kendi sitelerinden günlük il/ilçe akaryakıt fiyatlarını çeker.
// Captcha yok, resmi dağıtıcı fiyatı. Türkiye'de pompa fiyatını dağıtıcı il bazında
// belirlediği için bu fiyatlar istasyon pompa fiyatıyla pratikte aynıdır.

// İstasyonun bulunduğu ilçe öncelikli; yoksa il merkezine düşülür.
const PREFERRED_ILCE = ["SERDIVAN", "ADAPAZARI"];

function norm(s: string): string {
  return s.toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
}

// Türkçe il adını URL slug'ına çevirir (Petrol Ofisi / TP sayfaları için).
function ilSlug(il: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i",
  };
  return il
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüİ]/g, (c) => map[c] || c)
    .replace(/\s+/g, "-")
    .trim();
}

// "63,61" (virgül ondalık) ve "63.67" (nokta ondalık) biçimlerini güvenle parse eder.
function parseNum(raw: string): number | null {
  const v = raw.trim();
  if (v === "-" || v === "") return null;
  const num = v.includes(",")
    ? parseFloat(v.replace(/\./g, "").replace(",", "."))
    : parseFloat(v);
  return isNaN(num) || num <= 0 ? null : num;
}

// Tercih edilen ilçeyi seçer (Serdivan > Adapazarı > ilk kayıt).
function pickRow<T>(rows: { name: string; data: T }[]): T | null {
  if (rows.length === 0) return null;
  for (const want of PREFERRED_ILCE) {
    const hit = rows.find((r) => norm(r.name) === want);
    if (hit) return hit.data;
  }
  return rows[0].data;
}

type Prices = Partial<Record<FuelType, number>>;

const REQUEST_TIMEOUT_MS = 15_000;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`${url} → zaman aşımı (${REQUEST_TIMEOUT_MS / 1000}sn)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- Petrol Ofisi ---
// Sütunlar: Şehir, V/Max Kurşunsuz 95, V/Max Diesel, Gazyağı, Kalorifer, Fuel Oil, PO/gaz Otogaz
async function fetchPetrolOfisi(il: string): Promise<Prices | null> {
  const html = await fetchText(
    `https://www.petrolofisi.com.tr/akaryakit-fiyatlari/${ilSlug(il)}-akaryakit-fiyatlari`
  );
  const rowRe = /data-disctrict-name="([^"]*)"([\s\S]*?)<\/tr>/g;
  const rows: { name: string; data: Prices }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const name = m[1];
    const spans = [...m[2].matchAll(/<span class="with-tax">\s*([\d.,]+)\s*<\/span>/g)].map(
      (s) => s[1]
    );
    if (spans.length === 0) continue;
    const benzin = parseNum(spans[0] || "");
    const motorin = parseNum(spans[1] || "");
    const lpg = parseNum(spans[5] || "");
    const data: Prices = {};
    if (benzin) data.benzin = benzin;
    if (motorin) data.motorin = motorin;
    if (lpg) data.lpg = lpg;
    rows.push({ name, data });
  }
  return pickRow(rows);
}

// --- Opet (JSON API) ---
async function fetchOpet(plaka: number): Promise<Prices | null> {
  const txt = await fetchText(
    `https://api.opet.com.tr/api/fuelprices/prices?ProvinceCode=${plaka}`
  );
  let arr: {
    districtName: string;
    prices: { productShortName: string; amount: number }[];
  }[];
  try {
    arr = JSON.parse(txt);
  } catch {
    return null;
  }
  const rows = arr.map((d) => {
    const data: Prices = {};
    for (const p of d.prices) {
      if (p.productShortName === "KURS" && p.amount > 0) data.benzin = p.amount;
      if (p.productShortName === "MT_ULT" && p.amount > 0 && !data.motorin)
        data.motorin = p.amount;
      if (p.productShortName === "MT_ECO" && p.amount > 0 && !data.motorin)
        data.motorin = p.amount;
    }
    return { name: d.districtName, data };
  });
  return pickRow(rows);
}

// --- Türkiye Petrolleri (TP) ---
async function fetchTP(il: string): Promise<Prices | null> {
  const html = await fetchText(
    `https://www.tppd.com.tr/${ilSlug(il)}-akaryakit-fiyatlari`
  );
  // Satır: <td data-title="İL&#199;E">NAME</td> ... numeric td'ler
  const rowRe =
    /<td[^>]*data-title="İL&#199;E"[^>]*>\s*([^<]+?)\s*<\/td>([\s\S]*?)<\/tr>/g;
  const cellRe = /data-title="([^"]+?)"[^>]*>\s*([^<]+?)\s*<\/td>/g;
  const rows: { name: string; data: Prices }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const name = m[1];
    const data: Prices = {};
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[2]))) {
      const title = c[1];
      const val = parseNum(c[2]);
      if (!val) continue;
      if (title.includes("BENZİN")) data.benzin = val;
      else if (title.includes("MOTORİN") && !data.motorin) data.motorin = val;
    }
    rows.push({ name, data });
  }
  return pickRow(rows);
}

// --- Aytemiz ---
// Tek tabloda tüm sütunlar: İl, Benzin, Motorin (Dizel), Motorin (Euro), Kalorifer, Fuel Oil
async function fetchAytemiz(il: string): Promise<Prices | null> {
  const html = await fetchText(
    `https://www.aytemiz.com.tr/akaryakit-fiyatlari/benzin-fiyatlari/${ilSlug(il)}-benzin-fiyati`
  );
  const rowRe =
    /<tr>\s*<td[^>]*><span[^>]*>([^<]+)<\/span>((?:<td[^>]*>[^<]*)+)/g;
  const rows: { name: string; data: Prices }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const name = m[1];
    const vals = [...m[2].matchAll(/<td[^>]*>([^<]*)/g)].map((v) => v[1]);
    const data: Prices = {};
    const benzin = parseNum(vals[0] || "");
    const motorin = parseNum(vals[1] || "");
    if (benzin) data.benzin = benzin;
    if (motorin) data.motorin = motorin;
    rows.push({ name, data });
  }
  return pickRow(rows);
}

// --- Doviz.com (birincil kaynak) ---
// Tek ilçe sayfasında TÜM markaları (Shell, Opet, Aytemiz, Kadoil, Sunpet, Hypco...)
// listeler. Sütunlar: Marka, Benzin, Motorin, LPG, Tarih. Captcha yok, resmi verilerle
// birebir uyuşuyor (PO/Opet/Aytemiz değerleri markaların kendi siteleriyle aynı).
async function fetchDoviz(
  plaka: number,
  il: string,
  ilce: string,
  tarih: string
): Promise<PriceRow[]> {
  const html = await fetchText(
    `https://www.doviz.com/akaryakit-fiyatlari/${ilSlug(il)}/${ilSlug(ilce)}`
  );
  const rowRe =
    /<img src="https:\/\/cdn\.doviz\.com\/images\/fuel\/[^"]+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
  const out: PriceRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const marka = m[1].trim();
    const benzin = parseNum(m[2].replace("₺", ""));
    const motorin = parseNum(m[3].replace("₺", ""));
    const lpg = parseNum(m[4].replace("₺", ""));
    // Sadece akaryakıt (benzin/motorin) satan markalar; salt-LPG firmaları atlanır.
    if (benzin == null && motorin == null) continue;
    const vals: [FuelType, number | null][] = [
      ["benzin", benzin],
      ["motorin", motorin],
      ["lpg", lpg],
    ];
    for (const [yakit, fiyat] of vals) {
      if (fiyat != null) out.push({ tarih, il, plaka, marka, yakit, fiyat, kaynak: "marka" });
    }
  }
  return out;
}

// Yedek: markaların kendi resmi siteleri (doviz.com erişilemezse).
const FALLBACK_BRANDS: {
  marka: string;
  fetch: (il: string, plaka: number) => Promise<Prices | null>;
}[] = [
  { marka: "Petrol Ofisi", fetch: (il) => fetchPetrolOfisi(il) },
  { marka: "Opet", fetch: (_il, plaka) => fetchOpet(plaka) },
  { marka: "Türkiye Petrolleri", fetch: (il) => fetchTP(il) },
  { marka: "Aytemiz", fetch: (il) => fetchAytemiz(il) },
];

async function fetchFallback(
  plaka: number,
  il: string,
  tarih: string
): Promise<PriceRow[]> {
  const out: PriceRow[] = [];
  const results = await Promise.allSettled(
    FALLBACK_BRANDS.map(async (b) => ({ marka: b.marka, prices: await b.fetch(il, plaka) }))
  );
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.prices) continue;
    const { marka, prices } = r.value;
    for (const yakit of ["benzin", "motorin", "lpg"] as FuelType[]) {
      const fiyat = prices[yakit];
      if (typeof fiyat === "number" && fiyat > 0) {
        out.push({ tarih, il, plaka, marka, yakit, fiyat, kaynak: "marka" });
      }
    }
  }
  return out;
}

// Önce doviz.com'dan tüm markalar; başarısızsa resmi marka sitelerine düşer.
export async function fetchBrandPrices(
  plaka: number,
  il: string,
  ilce: string,
  tarih: string
): Promise<PriceRow[]> {
  try {
    const rows = await fetchDoviz(plaka, il, ilce, tarih);
    if (rows.length > 0) return rows;
  } catch {
    // doviz.com erişilemedi — yedeğe düş
  }
  return fetchFallback(plaka, il, tarih);
}
