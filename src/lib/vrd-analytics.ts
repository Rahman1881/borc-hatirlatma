import getDb from "@/lib/db";
import { ensureVrdTables, normalizePlate, fuelLabel } from "@/lib/vrd-ingest";

// ————————————————————————————————————————————————————————————————
// Müşteri Analitiği sorguları. Hepsi indeksli vrd_sales tablosundan okur;
// XML'e hiç dokunmaz. Yalnız peşin/bireysel satışlar (is_pesin=1) analiz edilir.
//
// Referans gün ("bugün"): veri geçmişe ait olabildiği için gerçek takvim günü
// değil, veritabanındaki EN SON satış günü esas alınır. Böylece gün/hafta/ay
// kırılımları her zaman dolu veriye denk gelir.
// ————————————————————————————————————————————————————————————————

export type Period = "gun" | "hafta" | "ay" | "ozel";
export type DateRange = { from: string; to: string };

const TR_MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const TR_MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TR_WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toIso(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(iso: string, n: number): string {
  const dt = isoToDate(iso);
  dt.setDate(dt.getDate() + n);
  return toIso(dt);
}
function daysBetween(a: string, b: string): number {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / 86400000);
}
function fmtDayLong(iso: string): string {
  const dt = isoToDate(iso);
  return `${dt.getDate()} ${TR_MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}`;
}
function relDay(iso: string, ref: string): string {
  const d = daysBetween(iso, ref);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  return `${d} gün önce`;
}

// Referans (en son veri) günü. Veri yoksa "" döner.
export function getRefDate(): string {
  ensureVrdTables();
  const db = getDb();
  const row = db
    .prepare("SELECT MAX(iso) as iso FROM vrd_sales WHERE is_pesin = 1")
    .get() as { iso: string | null };
  return row.iso || "";
}

// Bir dönemin [lo, hi] iso sınırlarını referans güne göre hesaplar.
function periodBounds(period: Period, ref: string, range?: DateRange): { lo: string; hi: string } {
  if (period === "ozel") {
    // Geçersiz/eksik aralıkta referans güne düş.
    if (!range || !range.from || !range.to) return { lo: ref, hi: ref };
    return range.from <= range.to
      ? { lo: range.from, hi: range.to }
      : { lo: range.to, hi: range.from };
  }
  if (period === "gun") return { lo: ref, hi: ref };
  if (period === "hafta") {
    const dt = isoToDate(ref);
    const dow = (dt.getDay() + 6) % 7; // Pzt = 0
    return { lo: addDays(ref, -dow), hi: ref };
  }
  // ay: içinde bulunulan takvim ayının 1'i → ref
  const dt = isoToDate(ref);
  return { lo: toIso(new Date(dt.getFullYear(), dt.getMonth(), 1)), hi: ref };
}

function segmentOf(firstIso: string, lastIso: string, ref: string): "sadik" | "yeni" | "kacan" {
  if (daysBetween(lastIso, ref) > 30) return "kacan";
  if (daysBetween(firstIso, ref) <= 30) return "yeni";
  return "sadik";
}

export type PlateRow = {
  plaka: string;
  ziyaret: number;
  litre: number;
  ciro: number;
  iskonto: number;
  sonZiyaret: string;
  segment: "sadik" | "yeni" | "kacan";
  temsilci: string;
};

export type PlateBrief = {
  plaka: string;
  ziyaret: number;
  ciro: number;
  iskonto: number;
  sonZiyaret: string;
  ilkZiyaret: string;
  gunGecti: number;
};

export type OverviewData = {
  refDate: string;
  refLabel: string;
  period: Period;
  periodLabel: string;
  kpi: {
    musteri: number;
    ilkDefa: number;
    iskontoluOran: number;
    iskontoCiro: number;
    ortIskonto: number; // kr/lt
    toplamCiro: number;
    toplamLitre: number;
  };
  fuelDiscounts: { yakit: string; listeFiyat: number; ortSatis: number; litre: number; vazgecilenCiro: number }[];
  fuelDemand: { yakit: string; litre: number; pct: number }[];
  topAttendants: { ad: string; iskonto: number; islem: number }[];
  dailyTrend: { gun: string; iso: string; ciro: number }[];
  segments: { sadik: number; yeni: number; kacan: number };
  segmentPlates: { sadik: PlateBrief[]; yeni: PlateBrief[]; kacan: PlateBrief[] };
  topPlates: PlateRow[];
  topByCiro: PlateRow[];
  hourly: { hour: number; adet: number; litre: number }[];
  weekday: { gun: string; adet: number; litre: number }[];
  patternLabel: string;
};

const FUEL_ORDER = ["motorin", "benzin", "lpg", "adblue", "diger"];

export function getOverview(period: Period, range?: DateRange): OverviewData {
  ensureVrdTables();
  const db = getDb();
  const ref = getRefDate();

  const empty: OverviewData = {
    refDate: "",
    refLabel: "",
    period,
    periodLabel: "",
    kpi: { musteri: 0, ilkDefa: 0, iskontoluOran: 0, iskontoCiro: 0, ortIskonto: 0, toplamCiro: 0, toplamLitre: 0 },
    fuelDiscounts: [],
    fuelDemand: [],
    topAttendants: [],
    dailyTrend: [],
    segments: { sadik: 0, yeni: 0, kacan: 0 },
    segmentPlates: { sadik: [], yeni: [], kacan: [] },
    topPlates: [],
    topByCiro: [],
    hourly: [],
    weekday: [],
    patternLabel: "",
  };
  if (!ref) return empty;

  const { lo, hi } = periodBounds(period, ref, range);
  const periodLabel =
    period === "gun"
      ? fmtDayLong(ref)
      : period === "ay"
      ? `${TR_MONTHS_LONG[isoToDate(ref).getMonth()]} ${isoToDate(ref).getFullYear()}`
      : lo === hi
      ? fmtDayLong(lo)
      : `${fmtDayLong(lo)} – ${fmtDayLong(hi)}`;

  // — KPI —
  const kpiRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT plaka) as musteri,
         COALESCE(SUM(iskonto),0) as iskontoCiro,
         COALESCE(SUM(litre),0) as litre,
         COALESCE(SUM(tutar),0) as tutar,
         COUNT(*) as adet,
         SUM(CASE WHEN iskonto > 0 THEN 1 ELSE 0 END) as iskontolu
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ?`
    )
    .get(lo, hi) as { musteri: number; iskontoCiro: number; litre: number; tutar: number; adet: number; iskontolu: number };

  // İlk defa gelen: plakanın TÜM veri içindeki ilk günü bu döneme düşüyor.
  const ilkDefa = db
    .prepare(
      `SELECT COUNT(*) as c FROM (
         SELECT plaka, MIN(iso) as first_iso
         FROM vrd_sales WHERE is_pesin = 1
         GROUP BY plaka
         HAVING first_iso BETWEEN ? AND ?
       )`
    )
    .get(lo, hi) as { c: number };

  const kpi = {
    musteri: kpiRow.musteri,
    ilkDefa: ilkDefa.c,
    iskontoluOran: kpiRow.adet > 0 ? Math.round((kpiRow.iskontolu / kpiRow.adet) * 100) : 0,
    iskontoCiro: Math.round(kpiRow.iskontoCiro),
    ortIskonto: kpiRow.litre > 0 ? Math.round((kpiRow.iskontoCiro / kpiRow.litre) * 100) : 0, // kr/lt
    toplamCiro: Math.round(kpiRow.tutar),
    toplamLitre: Math.round(kpiRow.litre),
  };

  // — Yakıt bazlı liste vs satış —
  const fuelRows = db
    .prepare(
      `SELECT yakit,
              MAX(liste_fiyat) as listeFiyat,
              SUM(tutar) as tutar,
              SUM(litre) as litre,
              SUM(iskonto) as vazgecilenCiro
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ? AND litre > 0
       GROUP BY yakit`
    )
    .all(lo, hi) as { yakit: string; listeFiyat: number; tutar: number; litre: number; vazgecilenCiro: number }[];

  const fuelDiscounts = fuelRows
    .map((f) => ({
      yakit: fuelLabel(f.yakit),
      _key: f.yakit,
      listeFiyat: f.listeFiyat,
      ortSatis: f.litre > 0 ? f.tutar / f.litre : 0,
      litre: Math.round(f.litre),
      vazgecilenCiro: Math.round(f.vazgecilenCiro),
    }))
    .sort((a, b) => FUEL_ORDER.indexOf(a._key) - FUEL_ORDER.indexOf(b._key))
    .map(({ _key, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars

  // — Yakıt talep dağılımı (litre payı) —
  const totFuelLitre = fuelRows.reduce((s, f) => s + f.litre, 0) || 1;
  const fuelDemand = fuelRows
    .map((f) => ({ _key: f.yakit, yakit: fuelLabel(f.yakit), litre: Math.round(f.litre), pct: Math.round((f.litre / totFuelLitre) * 100) }))
    .sort((a, b) => FUEL_ORDER.indexOf(a._key) - FUEL_ORDER.indexOf(b._key))
    .map(({ _key, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars

  // — En çok iskonto veren temsilciler —
  const topAttendants = db
    .prepare(
      `SELECT temsilci as ad, SUM(iskonto) as iskonto, COUNT(*) as islem
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ? AND temsilci != '' AND iskonto > 0
       GROUP BY temsilci
       ORDER BY iskonto DESC
       LIMIT 6`
    )
    .all(lo, hi)
    .map((r) => {
      const x = r as { ad: string; iskonto: number; islem: number };
      return { ad: x.ad, iskonto: Math.round(x.iskonto), islem: x.islem };
    });

  // — Günlük vazgeçilen ciro trendi (son 7 gün, ref günü dahil) —
  const trendLo = addDays(ref, -6);
  const trendRows = db
    .prepare(
      `SELECT iso, SUM(iskonto) as ciro
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ?
       GROUP BY iso`
    )
    .all(trendLo, ref) as { iso: string; ciro: number }[];
  const trendMap = new Map(trendRows.map((r) => [r.iso, r.ciro]));
  const dailyTrend = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(trendLo, i);
    return {
      iso,
      gun: TR_WEEKDAYS[isoToDate(iso).getDay()],
      ciro: Math.round(trendMap.get(iso) || 0),
    };
  });

  // — RFM segmentleri (tüm veri üzerinden plaka bazlı) —
  const plateAgg = db
    .prepare(
      `SELECT plaka,
              MAX(plaka_display) as display,
              MIN(iso) as first_iso,
              MAX(iso) as last_iso,
              COUNT(DISTINCT iso) as ziyaret,
              SUM(tutar) as ciro,
              SUM(iskonto) as iskonto
       FROM vrd_sales WHERE is_pesin = 1
       GROUP BY plaka`
    )
    .all() as {
    plaka: string;
    display: string;
    first_iso: string;
    last_iso: string;
    ziyaret: number;
    ciro: number;
    iskonto: number;
  }[];

  const enriched = plateAgg.map((p) => ({ ...p, seg: segmentOf(p.first_iso, p.last_iso, ref) }));
  const segments = { sadik: 0, yeni: 0, kacan: 0 };
  for (const p of enriched) segments[p.seg]++;

  const toBrief = (p: (typeof enriched)[number]): PlateBrief => ({
    plaka: p.display || p.plaka,
    ziyaret: p.ziyaret,
    ciro: Math.round(p.ciro),
    iskonto: Math.round(p.iskonto),
    sonZiyaret: relDay(p.last_iso, ref),
    ilkZiyaret: fmtDayLong(p.first_iso),
    gunGecti: daysBetween(p.last_iso, ref),
  });

  const segmentPlates = {
    // Sadık: en çok ziyaret edenler
    sadik: enriched.filter((p) => p.seg === "sadik").sort((a, b) => b.ziyaret - a.ziyaret).slice(0, 20).map(toBrief),
    // Yeni: en son katılanlar
    yeni: enriched.filter((p) => p.seg === "yeni").sort((a, b) => (a.first_iso < b.first_iso ? 1 : -1)).slice(0, 20).map(toBrief),
    // Kaçan: en değerliden başlayarak (geri kazanım önceliği)
    kacan: enriched.filter((p) => p.seg === "kacan").sort((a, b) => b.ciro - a.ciro).slice(0, 20).map(toBrief),
  };

  // Segment ve temsilci için plakaların genel (tüm veri) first/last'ı gerekli.
  const firstLast = new Map(enriched.map((p) => [p.plaka, p]));

  // — Dönem içi plaka tablosu; iskonto ve ciro sıralı iki görünüm —
  const buildPlateRows = (orderBy: "iskonto" | "ciro"): PlateRow[] => {
    const rows = db
      .prepare(
        `SELECT plaka,
                MAX(plaka_display) as display,
                COUNT(DISTINCT iso) as ziyaret,
                SUM(litre) as litre,
                SUM(tutar) as ciro,
                SUM(iskonto) as iskonto,
                MAX(iso) as son_donem
         FROM vrd_sales
         WHERE is_pesin = 1 AND iso BETWEEN ? AND ?
         GROUP BY plaka
         ORDER BY ${orderBy} DESC
         LIMIT 15`
      )
      .all(lo, hi) as {
      plaka: string;
      display: string;
      ziyaret: number;
      litre: number;
      ciro: number;
      iskonto: number;
      son_donem: string;
    }[];
    return rows.map((r) => {
      const fl = firstLast.get(r.plaka);
      return {
        plaka: r.display || r.plaka,
        ziyaret: r.ziyaret,
        litre: Math.round(r.litre),
        ciro: Math.round(r.ciro),
        iskonto: Math.round(r.iskonto),
        sonZiyaret: relDay(fl?.last_iso || r.son_donem, ref),
        segment: fl ? segmentOf(fl.first_iso, fl.last_iso, ref) : ("yeni" as const),
        temsilci: topTemsilciForPlate(db, r.plaka),
      };
    });
  };
  const topPlates = buildPlateRows("iskonto");
  const topByCiro = buildPlateRows("ciro");

  // — Zaman & yoğunluk desenleri (son 90 gün) —
  const patLo = addDays(ref, -89);
  const patternLabel = `Son 90 gün · ${fmtDayLong(patLo)} – ${fmtDayLong(ref)}`;

  const hourRows = db
    .prepare(
      `SELECT hour, COUNT(*) as adet, SUM(litre) as litre
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ? AND hour IS NOT NULL
       GROUP BY hour`
    )
    .all(patLo, ref) as { hour: number; adet: number; litre: number }[];
  const hourMap = new Map(hourRows.map((r) => [r.hour, r]));
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const r = hourMap.get(h);
    return { hour: h, adet: r?.adet || 0, litre: Math.round(r?.litre || 0) };
  });

  const dayRows = db
    .prepare(
      `SELECT iso, COUNT(*) as adet, SUM(litre) as litre
       FROM vrd_sales
       WHERE is_pesin = 1 AND iso BETWEEN ? AND ?
       GROUP BY iso`
    )
    .all(patLo, ref) as { iso: string; adet: number; litre: number }[];
  const wkAcc = Array.from({ length: 7 }, () => ({ adet: 0, litre: 0 }));
  for (const r of dayRows) {
    const dow = isoToDate(r.iso).getDay();
    wkAcc[dow].adet += r.adet;
    wkAcc[dow].litre += r.litre;
  }
  // Pazartesi'den başlat
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    gun: TR_WEEKDAYS[dow],
    adet: wkAcc[dow].adet,
    litre: Math.round(wkAcc[dow].litre),
  }));

  return {
    refDate: ref,
    refLabel: fmtDayLong(ref),
    period,
    periodLabel,
    kpi,
    fuelDiscounts,
    fuelDemand,
    topAttendants,
    dailyTrend,
    segments,
    segmentPlates,
    topPlates,
    topByCiro,
    hourly,
    weekday,
    patternLabel,
  };
}

function topTemsilciForPlate(db: ReturnType<typeof getDb>, plaka: string): string {
  const row = db
    .prepare(
      `SELECT temsilci, COUNT(*) as c
       FROM vrd_sales
       WHERE is_pesin = 1 AND plaka = ? AND temsilci != ''
       GROUP BY temsilci ORDER BY c DESC LIMIT 1`
    )
    .get(plaka) as { temsilci: string } | undefined;
  return row?.temsilci || "—";
}

export type PlateProfile = {
  plaka: string;
  ilkZiyaret: string;
  sonZiyaret: string;
  ziyaret: number;
  ortAralik: string;
  toplamLitre: number;
  toplamCiro: number;
  toplamIskonto: number;
  segment: "Sadık" | "Yeni" | "Kaçan";
  temsilci: string;
  saatTercihi: string;
  yakitKarma: { yakit: string; pct: number }[];
  aylikTrend: { ay: string; adet: number }[];
  gecmis: { tarih: string; yakit: string; litre: number; tutar: number; iskonto: number }[];
};

const SEG_LABEL: Record<"sadik" | "yeni" | "kacan", "Sadık" | "Yeni" | "Kaçan"> = {
  sadik: "Sadık",
  yeni: "Yeni",
  kacan: "Kaçan",
};

// Bir plakanın tüm profilini döndürür. query ham girilen plaka (normalize edilir).
export function getPlateProfile(query: string): PlateProfile | null {
  ensureVrdTables();
  const db = getDb();
  const ref = getRefDate();
  if (!ref) return null;
  const plaka = normalizePlate(query);
  if (!plaka) return null;

  const agg = db
    .prepare(
      `SELECT COUNT(DISTINCT iso) as ziyaret,
              MIN(iso) as first_iso,
              MAX(iso) as last_iso,
              SUM(litre) as litre,
              SUM(tutar) as ciro,
              SUM(iskonto) as iskonto,
              MAX(plaka_display) as display
       FROM vrd_sales
       WHERE is_pesin = 1 AND plaka = ?`
    )
    .get(plaka) as {
    ziyaret: number;
    first_iso: string | null;
    last_iso: string | null;
    litre: number;
    ciro: number;
    iskonto: number;
    display: string | null;
  };
  if (!agg.first_iso || agg.ziyaret === 0) return null;

  const ortAralikGun =
    agg.ziyaret > 1 ? Math.round(daysBetween(agg.first_iso, agg.last_iso!) / (agg.ziyaret - 1)) : 0;

  // Saat tercihi: en yoğun saat, 2 saatlik bant olarak.
  const hourRow = db
    .prepare(
      `SELECT hour, COUNT(*) as c FROM vrd_sales
       WHERE is_pesin = 1 AND plaka = ? AND hour IS NOT NULL
       GROUP BY hour ORDER BY c DESC LIMIT 1`
    )
    .get(plaka) as { hour: number } | undefined;
  const saatTercihi =
    hourRow != null
      ? `${String(hourRow.hour).padStart(2, "0")}:00 – ${String((hourRow.hour + 2) % 24).padStart(2, "0")}:00`
      : "—";

  const temsilci = topTemsilciForPlate(db, plaka);

  // Yakıt karması (litre payı).
  const fuelRows = db
    .prepare(
      `SELECT yakit, SUM(litre) as litre FROM vrd_sales
       WHERE is_pesin = 1 AND plaka = ?
       GROUP BY yakit ORDER BY litre DESC`
    )
    .all(plaka) as { yakit: string; litre: number }[];
  const totLitre = fuelRows.reduce((s, f) => s + f.litre, 0) || 1;
  const yakitKarma = fuelRows.map((f) => ({
    yakit: fuelLabel(f.yakit),
    pct: Math.round((f.litre / totLitre) * 100),
  }));

  // Son 12 ay ziyaret trendi (ref ayından geriye).
  const monthRows = db
    .prepare(
      `SELECT substr(iso,1,7) as ym, COUNT(DISTINCT iso) as adet
       FROM vrd_sales WHERE is_pesin = 1 AND plaka = ?
       GROUP BY ym`
    )
    .all(plaka) as { ym: string; adet: number }[];
  const monthMap = new Map(monthRows.map((r) => [r.ym, r.adet]));
  const refDt = isoToDate(ref);
  const aylikTrend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(refDt.getFullYear(), refDt.getMonth() - (11 - i), 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { ay: TR_MONTHS_SHORT[d.getMonth()], adet: monthMap.get(ym) || 0 };
  });

  // Son alımlar (en yeni 15).
  const gecmis = (
    db
      .prepare(
        `SELECT iso, yakit, litre, tutar, iskonto FROM vrd_sales
         WHERE is_pesin = 1 AND plaka = ?
         ORDER BY iso DESC, saat DESC LIMIT 15`
      )
      .all(plaka) as { iso: string; yakit: string; litre: number; tutar: number; iskonto: number }[]
  ).map((g) => {
    const dt = isoToDate(g.iso);
    return {
      tarih: `${dt.getDate()} ${TR_MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`,
      yakit: fuelLabel(g.yakit),
      litre: Math.round(g.litre),
      tutar: Math.round(g.tutar),
      iskonto: Math.round(g.iskonto),
    };
  });

  return {
    plaka: agg.display || plaka,
    ilkZiyaret: fmtDayLong(agg.first_iso),
    sonZiyaret: fmtDayLong(agg.last_iso!),
    ziyaret: agg.ziyaret,
    ortAralik: ortAralikGun > 0 ? `${ortAralikGun} gün` : "—",
    toplamLitre: Math.round(agg.litre),
    toplamCiro: Math.round(agg.ciro),
    toplamIskonto: Math.round(agg.iskonto),
    segment: SEG_LABEL[segmentOf(agg.first_iso, agg.last_iso!, ref)],
    temsilci,
    saatTercihi,
    yakitKarma,
    aylikTrend,
    gecmis,
  };
}
