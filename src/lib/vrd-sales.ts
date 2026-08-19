import fs from "node:fs";
import path from "node:path";
import getDb from "@/lib/db";

// Pompa satış verisi: istasyondaki POAS (Petrol Ofisi) vardiya kayıtlarını okur.
// Gerçek ortamda dosyalar Muhasebe PC'de \\192.168.0.10\J\VRD altında XML + txt
// olarak 3 vardiya halinde tutulur (20260610.d1a/.d1b/.d1c). Geliştirme aşamasında
// yerel data/vrd/ klasöründeki örnek dosyalarla çalışır. Üretimde yol Ayarlar'dan
// (settings.vrd_dir) verilir.

export type FuelKind = "motorin" | "benzin" | "lpg" | "adblue" | "diger";
export type CustomerKind = "istasyon" | "acik_hesap" | "filo" | "diger";

export type SaleRecord = {
  tarih: string; // 10/06/2026
  saat: string; // 07:54:43
  filoAdi: string;
  kodu: string;
  plaka: string;
  yakitRaw: string;
  yakit: FuelKind;
  litre: number;
  fiyat: number;
  tutar: number;
  tabanca: string;
  pompa: string;
  fisNo: string;
  plaka2: string;
  musteri: CustomerKind;
};

export type FuelSummary = {
  yakit: FuelKind;
  label: string;
  litre: number;
  tutar: number;
  adet: number;
};

// Bir veya daha fazla vardiyanın birleştirilmiş satış özeti (yakıt, pompa, saat,
// müşteri tipi, filo kırılımları).
export type Aggregation = {
  toplamTutar: number;
  toplamLitre: number;
  fisAdedi: number;
  yakitlar: FuelSummary[];
  pompalar: { pompa: string; litre: number; tutar: number; adet: number }[];
  saatler: { saat: number; tutar: number; adet: number }[];
  musteriTipi: { tip: CustomerKind; label: string; tutar: number; adet: number }[];
  topFilolar: { ad: string; tutar: number; litre: number; adet: number }[];
};

// Tek bir ayrıştırılmış vardiya dosyası.
export type ParsedShift = {
  file: string;
  tarih: string; // GG/AA/YYYY
  iso: string; // YYYY-MM-DD
  vardiyaNo: string; // 1 / 2 / 3
  sales: SaleRecord[];
};

// Takvim görünümü: bir gün ve o güne ait vardiyalar (özet metrikleriyle).
export type CalendarDay = {
  iso: string;
  tarih: string;
  vardiyalar: {
    no: string;
    file: string;
    toplamTutar: number;
    toplamLitre: number;
    fisAdedi: number;
  }[];
};

export const FUEL_LABELS: Record<FuelKind, string> = {
  motorin: "Motorin",
  benzin: "Benzin",
  lpg: "LPG / Otogaz",
  adblue: "AdBlue",
  diger: "Diğer",
};

export const CUSTOMER_LABELS: Record<CustomerKind, string> = {
  istasyon: "İstasyon (peşin)",
  acik_hesap: "Açık Hesap",
  filo: "Filo",
  diger: "Diğer",
};

// VRD dosyalarının okunacağı klasör. Ayarlar'da tanımlıysa onu, değilse yerel
// örnek klasörünü kullanır.
export function getVrdDir(): string {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("vrd_dir") as { value: string } | undefined;
    const custom = (row?.value || process.env.VRD_DIR || "").trim();
    if (custom) return custom;
  } catch {
    // settings okunamazsa varsayılana düş
  }
  return path.join(process.cwd(), "data", "vrd");
}

// Ayarlar'da kayıtlı ham VRD yolu (tanımlı değilse boş döner).
export function getVrdDirRaw(): string {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("vrd_dir") as { value: string } | undefined;
    return (row?.value || "").trim();
  } catch {
    return "";
  }
}

// Bir klasörün okunabilir olup olmadığını ve içindeki XML dosya sayısını döndürür.
export function checkVrdDir(dir: string): { ok: boolean; xmlCount: number; error?: string } {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xml"));
    return { ok: true, xmlCount: files.length };
  } catch (e) {
    return { ok: false, xmlCount: 0, error: e instanceof Error ? e.message : "Klasör okunamadı." };
  }
}

// POAS yakıt adını normalize eder.
export function normalizeFuel(raw: string): FuelKind {
  const s = (raw || "").toLocaleLowerCase("tr");
  if (s.includes("adblue") || s.includes("ad blue")) return "adblue";
  if (s.includes("otogaz") || s.includes("pogaz") || s.includes("lpg"))
    return "lpg";
  if (s.includes("eurodzl") || s.includes("dzl") || s.includes("motorin"))
    return "motorin";
  if (s.includes("95") || s.includes("kbn") || s.includes("benzin"))
    return "benzin";
  return "diger";
}

// KODU / FILOADI'ye göre müşteri tipini belirler.
export function classifyCustomer(kodu: string, filoAdi: string): CustomerKind {
  const k = (kodu || "").trim().toLocaleUpperCase("tr");
  const f = (filoAdi || "").trim().toLocaleUpperCase("tr");
  if (k === "C0000" || f === "ISTASYON" || f === "İSTASYON") return "istasyon";
  if (k.startsWith("M")) return "filo";
  if (/^\d+$/.test(k)) return "acik_hesap";
  if (k.startsWith("C")) return "istasyon";
  return "diger";
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Basit, düz şemalı XML için etiket içeriği çıkarır.
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : "";
}

type ParsedFile = {
  tarih: string;
  vardiyaNo: string;
  sales: SaleRecord[];
};

// 'GG/AA/YYYY' -> 'YYYY-AA-GG'
function isoFromTarih(tarih: string): string {
  const m = tarih.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

// Bir POAS XML dosyasını ayrıştırır.
export function parseVrdXml(xml: string): ParsedFile {
  const vardiyaBlock = (xml.match(/<Vardiya>([\s\S]*?)<\/Vardiya>/i) || [])[1] || "";
  const tarih = tag(vardiyaBlock, "TARIH");
  const vardiyaNo = tag(vardiyaBlock, "NO");

  const sales: SaleRecord[] = [];
  const re = /<Satislar>([\s\S]*?)<\/Satislar>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const kodu = tag(b, "KODU");
    const filoAdi = tag(b, "FILOADI");
    const yakitRaw = tag(b, "YAKIT");
    sales.push({
      tarih: tag(b, "TARIH"),
      saat: tag(b, "SAAT"),
      filoAdi,
      kodu,
      plaka: tag(b, "PLAKA"),
      yakitRaw,
      yakit: normalizeFuel(yakitRaw),
      litre: num(tag(b, "LITRE")),
      fiyat: num(tag(b, "FYT")),
      tutar: num(tag(b, "TUTAR")),
      tabanca: tag(b, "TABANCA"),
      pompa: tag(b, "POMPA"),
      fisNo: tag(b, "FISNO"),
      plaka2: tag(b, "PLAKA2"),
      musteri: classifyCustomer(kodu, filoAdi),
    });
  }

  return { tarih: tarih || (sales[0]?.tarih ?? ""), vardiyaNo, sales };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Bir veya daha fazla vardiyaya ait satış kayıtlarını birleştirip özet üretir.
export function summarizeSales(sales: SaleRecord[]): Aggregation {
  const fuelMap = new Map<FuelKind, FuelSummary>();
  const pompaMap = new Map<string, { litre: number; tutar: number; adet: number }>();
  const saatMap = new Map<number, { tutar: number; adet: number }>();
  const musteriMap = new Map<CustomerKind, { tutar: number; adet: number }>();
  const filoMap = new Map<string, { tutar: number; litre: number; adet: number }>();

  let toplamTutar = 0;
  let toplamLitre = 0;

  for (const s of sales) {
    toplamTutar += s.tutar;
    toplamLitre += s.litre;

    const f = fuelMap.get(s.yakit) || {
      yakit: s.yakit,
      label: FUEL_LABELS[s.yakit],
      litre: 0,
      tutar: 0,
      adet: 0,
    };
    f.litre += s.litre;
    f.tutar += s.tutar;
    f.adet += 1;
    fuelMap.set(s.yakit, f);

    const p = pompaMap.get(s.pompa) || { litre: 0, tutar: 0, adet: 0 };
    p.litre += s.litre;
    p.tutar += s.tutar;
    p.adet += 1;
    pompaMap.set(s.pompa, p);

    const hour = parseInt(s.saat.slice(0, 2), 10);
    if (Number.isFinite(hour)) {
      const h = saatMap.get(hour) || { tutar: 0, adet: 0 };
      h.tutar += s.tutar;
      h.adet += 1;
      saatMap.set(hour, h);
    }

    const c = musteriMap.get(s.musteri) || { tutar: 0, adet: 0 };
    c.tutar += s.tutar;
    c.adet += 1;
    musteriMap.set(s.musteri, c);

    // İstasyon (peşin) dışındaki kayıtlar filo/açık hesap müşterisidir.
    if (s.musteri !== "istasyon" && s.filoAdi && s.filoAdi.toLocaleUpperCase("tr") !== "ISTASYON") {
      const key = s.filoAdi.trim();
      const fl = filoMap.get(key) || { tutar: 0, litre: 0, adet: 0 };
      fl.tutar += s.tutar;
      fl.litre += s.litre;
      fl.adet += 1;
      filoMap.set(key, fl);
    }
  }

  const fuelOrder: FuelKind[] = ["motorin", "benzin", "lpg", "adblue", "diger"];
  const yakitlar = Array.from(fuelMap.values())
    .map((f) => ({ ...f, litre: round2(f.litre), tutar: round2(f.tutar) }))
    .sort((a, b) => fuelOrder.indexOf(a.yakit) - fuelOrder.indexOf(b.yakit));

  const pompalar = Array.from(pompaMap.entries())
    .map(([pompa, v]) => ({ pompa, litre: round2(v.litre), tutar: round2(v.tutar), adet: v.adet }))
    .sort((a, b) => a.pompa.localeCompare(b.pompa, "tr"));

  const saatler = Array.from(saatMap.entries())
    .map(([saat, v]) => ({ saat, tutar: round2(v.tutar), adet: v.adet }))
    .sort((a, b) => a.saat - b.saat);

  const musteriOrder: CustomerKind[] = ["istasyon", "filo", "acik_hesap", "diger"];
  const musteriTipi = Array.from(musteriMap.entries())
    .map(([tip, v]) => ({ tip, label: CUSTOMER_LABELS[tip], tutar: round2(v.tutar), adet: v.adet }))
    .sort((a, b) => musteriOrder.indexOf(a.tip) - musteriOrder.indexOf(b.tip));

  const topFilolar = Array.from(filoMap.entries())
    .map(([ad, v]) => ({ ad, tutar: round2(v.tutar), litre: round2(v.litre), adet: v.adet }))
    .sort((a, b) => b.tutar - a.tutar)
    .slice(0, 10);

  return {
    toplamTutar: round2(toplamTutar),
    toplamLitre: round2(toplamLitre),
    fisAdedi: sales.length,
    yakitlar,
    pompalar,
    saatler,
    musteriTipi,
    topFilolar,
  };
}

// getAllShifts önbelleği. VRD klasörü genelde ağ paylaşımı (\\192.168.0.10\J\VRD)
// olduğu için her stat/read bir ağ gidiş-dönüşüdür. İki kademeli önbellek:
//   1) dirCheckedAt: klasör en fazla DIR_CHECK_TTL_MS'de bir taranır. Tek sayfa
//      render'ı getAllShifts'i 10 kez çağırdığı için bu tek başına 10 kat kazandırır.
//   2) parseCache: dosya bazlı (boyut+mtime anahtarlı) ayrıştırma önbelleği. Yeni
//      vardiya dosyası düştüğünde tüm arşiv değil, yalnız o dosya yeniden okunur.
const DIR_CHECK_TTL_MS = 10_000;

let shiftCache: { dir: string; shifts: ParsedShift[]; checkedAt: number } | null = null;
const parseCache = new Map<string, { key: string; shift: ParsedShift | null }>();

// VRD klasöründeki tüm XML dosyalarını ayrıştırır (yeni -> eski sıralı).
export function getAllShifts(): ParsedShift[] {
  const dir = getVrdDir();
  const now = Date.now();

  if (shiftCache && shiftCache.dir === dir && now - shiftCache.checkedAt < DIR_CHECK_TTL_MS) {
    return shiftCache.shifts;
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xml"));
  } catch {
    return [];
  }

  // Klasör değiştiyse önceki klasörün ayrıştırma önbelleği geçersizdir.
  if (shiftCache && shiftCache.dir !== dir) parseCache.clear();

  const shifts: ParsedShift[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    let key: string;
    try {
      const st = fs.statSync(full);
      key = `${st.size}:${st.mtimeMs}`;
    } catch {
      continue;
    }

    const cached = parseCache.get(file);
    if (cached && cached.key === key) {
      if (cached.shift) shifts.push(cached.shift);
      continue;
    }

    let shift: ParsedShift | null = null;
    try {
      const parsed = parseVrdXml(fs.readFileSync(full, "utf8"));
      if (parsed.sales.length > 0) {
        shift = {
          file,
          tarih: parsed.tarih,
          iso: isoFromTarih(parsed.tarih),
          vardiyaNo: parsed.vardiyaNo,
          sales: parsed.sales,
        };
      }
    } catch {
      // bozuk dosya: null olarak önbelleğe alınır, tekrar tekrar okunmaz
    }
    parseCache.set(file, { key, shift });
    if (shift) shifts.push(shift);
  }

  // Silinen dosyaların önbellek kayıtlarını at (bellek sınırsız büyümesin).
  if (parseCache.size > files.length) {
    const alive = new Set(files);
    for (const f of parseCache.keys()) if (!alive.has(f)) parseCache.delete(f);
  }

  // iso + vardiya no'ya göre sırala, en yeni en üstte.
  shifts.sort((a, b) => {
    if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1;
    return (parseInt(b.vardiyaNo, 10) || 0) - (parseInt(a.vardiyaNo, 10) || 0);
  });

  shiftCache = { dir, shifts, checkedAt: now };
  return shifts;
}

// Gün bazlı takvim: her gün ve o güne ait vardiyalar (özet metrikleriyle).
export function getCalendar(): CalendarDay[] {
  const shifts = getAllShifts();
  const byDay = new Map<string, CalendarDay>();

  for (const s of shifts) {
    let day = byDay.get(s.iso);
    if (!day) {
      day = { iso: s.iso, tarih: s.tarih, vardiyalar: [] };
      byDay.set(s.iso, day);
    }
    let tutar = 0;
    let litre = 0;
    for (const x of s.sales) {
      tutar += x.tutar;
      litre += x.litre;
    }
    day.vardiyalar.push({
      no: s.vardiyaNo,
      file: s.file,
      toplamTutar: round2(tutar),
      toplamLitre: round2(litre),
      fisAdedi: s.sales.length,
    });
  }

  const days = Array.from(byDay.values());
  for (const d of days) {
    d.vardiyalar.sort(
      (a, b) => (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0)
    );
  }
  days.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
  return days;
}

// Seçili dosyalardaki (vardiyalardaki) satışları birleştirip özet üretir.
export function summarizeFiles(files: string[]): Aggregation {
  const set = new Set(files);
  const shifts = getAllShifts();
  const sales = shifts
    .filter((s) => set.has(s.file))
    .flatMap((s) => s.sales);
  return summarizeSales(sales);
}
