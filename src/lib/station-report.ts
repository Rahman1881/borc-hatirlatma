import getDb from "@/lib/db";
import {
  getCalendar,
  getAllShifts,
  summarizeFiles,
  type Aggregation,
  type CalendarDay,
} from "@/lib/vrd-sales";

// Gerçek VRD satış verisinden Telegram raporları ve AI sohbet bağlamı üretir.

function tl(n: number): string {
  return `₺${Math.round(n).toLocaleString("tr-TR")}`;
}

function lt(n: number): string {
  return `${Math.round(n).toLocaleString("tr-TR")} L`;
}

function fmtDay(iso: string): string {
  const months = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]} ${y}`;
}

export function getStationName(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("station_name") as { value: string } | undefined;
  return (row?.value || "Çark Petrol Ofisi").trim();
}

// Bir özetin yakıt / müşteri kırılımını düz metne döker.
function aggregationLines(agg: Aggregation): string {
  const fuels = agg.yakitlar
    .filter((f) => f.tutar > 0)
    .map((f) => `  • ${f.label}: ${tl(f.tutar)} · ${lt(f.litre)}`)
    .join("\n");

  const musteri = agg.musteriTipi
    .filter((m) => m.tutar > 0)
    .map((m) => `  • ${m.label}: ${tl(m.tutar)} (${m.adet} fiş)`)
    .join("\n");

  const parts = [
    `<b>Toplam ciro:</b> ${tl(agg.toplamTutar)}`,
    `<b>Toplam satış:</b> ${lt(agg.toplamLitre)} · ${agg.fisAdedi} fiş`,
  ];
  if (fuels) parts.push(`\n<b>Yakıt kırılımı:</b>\n${fuels}`);
  if (musteri) parts.push(`\n<b>Müşteri tipi:</b>\n${musteri}`);
  return parts.join("\n");
}

// En yeni günün (ya da verilen iso'nun) tüm vardiyalarını birleştirip özetler.
function summarizeDay(day: CalendarDay): Aggregation {
  const files = day.vardiyalar.map((v) => v.file);
  return summarizeFiles(files);
}

export type ReportResult = { ok: boolean; text: string };

// Bugünün ISO tarihi (yerel saat).
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Günlük satış raporu: BİR ÖNCEKİ tam günün (3 vardiya birleşik) satışları.
// Her sabah 09:30'da gönderilir; o saatte bugünün ilk vardiyası düşmüş olabileceği
// için "en güncel gün" yerine bugünden önceki son tam günü alırız.
export async function buildDailyReport(): Promise<ReportResult> {
  const calendar = getCalendar();
  if (calendar.length === 0) {
    return {
      ok: false,
      text: "📊 Günlük rapor hazırlanamadı: pompa satış verisi (VRD) bulunamadı.",
    };
  }
  const today = todayIso();
  // Takvim yeni -> eski sıralı; bugünden önceki ilk gün = dün (ya da son tam gün).
  const day = calendar.find((d) => d.iso < today) ?? calendar[0];
  const agg = summarizeDay(day);

  const vardiyaLines = day.vardiyalar
    .map((v) => `  • ${v.no}. Vardiya: ${tl(v.toplamTutar)} · ${lt(v.toplamLitre)}`)
    .join("\n");

  let text = `📊 <b>${getStationName()} — Günlük Satış Raporu</b>\n${fmtDay(day.iso)}\n\n`;
  text += aggregationLines(agg);
  if (vardiyaLines) text += `\n\n<b>Vardiyalar:</b>\n${vardiyaLines}`;
  return { ok: true, text };
}

// Tek bir vardiya raporu: VRD klasörüne yeni dosya düşünce o vardiyanın özetini
// üretir (worker olay tabanlı gönderir).
export async function buildShiftReport(file: string): Promise<ReportResult> {
  const shift = getAllShifts().find((s) => s.file === file);
  if (!shift) {
    return { ok: false, text: `Vardiya dosyası bulunamadı: ${file}` };
  }
  const agg = summarizeFiles([file]);

  // Vardiyanın saat aralığı (ilk -> son satış saati).
  const saatler = agg.saatler.filter((h) => h.tutar > 0).map((h) => h.saat);
  const aralik =
    saatler.length > 0
      ? `${String(Math.min(...saatler)).padStart(2, "0")}:00–${String(
          Math.max(...saatler) + 1
        ).padStart(2, "0")}:00`
      : "";

  let text = `🧾 <b>${getStationName()} — ${shift.vardiyaNo}. Vardiya Raporu</b>\n${fmtDay(
    shift.iso
  )}${aralik ? ` · ${aralik}` : ""}\n\n`;
  text += aggregationLines(agg);
  return { ok: true, text };
}

// Haftalık rapor: en yeni 7 günün satışları.
export async function buildWeeklyReport(): Promise<ReportResult> {
  const calendar = getCalendar();
  if (calendar.length === 0) {
    return {
      ok: false,
      text: "📊 Haftalık rapor hazırlanamadı: pompa satış verisi (VRD) bulunamadı.",
    };
  }
  const days = calendar.slice(0, 7);
  const files = days.flatMap((d) => d.vardiyalar.map((v) => v.file));
  const agg = summarizeFiles(files);
  const period = `${fmtDay(days[days.length - 1].iso)} – ${fmtDay(days[0].iso)}`;

  const dayLines = days
    .map((d) => {
      const t = d.vardiyalar.reduce((s, v) => s + v.toplamTutar, 0);
      return `  • ${fmtDay(d.iso)}: ${tl(t)}`;
    })
    .join("\n");

  let text = `📊 <b>${getStationName()} — Haftalık Rapor</b>\n${period}\n\n`;
  text += aggregationLines(agg);
  if (dayLines) text += `\n\n<b>Günlük ciro:</b>\n${dayLines}`;
  return { ok: true, text };
}

export async function buildReport(type: "daily" | "weekly"): Promise<ReportResult> {
  return type === "weekly" ? buildWeeklyReport() : buildDailyReport();
}

// ---------------------------------------------------------------------------
// Vardiya raporu takibi: hangi VRD dosyasının gönderildiğini DB'de tutar.
// İlk çalıştırmada mevcut tüm dosyalar "raporlandı" işaretlenir; böylece geçmiş
// vardiyalar için toplu (spam) gönderim yapılmaz, sadece bundan sonra düşenler
// raporlanır.
// ---------------------------------------------------------------------------

// İlk kez çalışıyorsa (tablo boşsa) mevcut tüm dosyaları işaretler ve true döner.
function ensureShiftBaseline(): boolean {
  const db = getDb();
  const { c } = db
    .prepare("SELECT COUNT(*) AS c FROM telegram_reported_shifts")
    .get() as { c: number };
  if (c > 0) return false;
  const files = getAllShifts().map((s) => s.file);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO telegram_reported_shifts (file) VALUES (?)"
  );
  const tx = db.transaction((arr: string[]) => {
    for (const f of arr) ins.run(f);
  });
  tx(files);
  return true;
}

// Bir vardiya dosyasını "raporlandı" olarak sahiplenir. Gerçekten bu çağrı
// işaretlediyse true, başkası daha önce işaretlemişse false döner. INSERT OR IGNORE
// tek adımda çalıştığı için eşzamanlı iki istek aynı dosyayı sahiplenemez.
function claimShift(file: string): boolean {
  const info = getDb()
    .prepare("INSERT OR IGNORE INTO telegram_reported_shifts (file) VALUES (?)")
    .run(file);
  return info.changes === 1;
}

// Henüz raporlanmamış vardiya dosyaları (eski -> yeni sıralı).
function listUnreportedShiftFiles(): string[] {
  const db = getDb();
  const reported = new Set(
    (
      db.prepare("SELECT file FROM telegram_reported_shifts").all() as {
        file: string;
      }[]
    ).map((r) => r.file)
  );
  // getAllShifts yeni -> eski; eski -> yeni göndermek için ters çeviririz.
  return getAllShifts()
    .map((s) => s.file)
    .filter((f) => !reported.has(f))
    .reverse();
}

// Yeni düşen vardiyaların rapor metinlerini üretir ve "raporlandı" işaretler.
// İlk çalıştırmada (baseline) boş döner.
export async function buildPendingShiftReports(): Promise<
  { file: string; text: string }[]
> {
  if (ensureShiftBaseline()) return [];
  // Dosyalar rapor üretilmeden ÖNCE sahiplenilir. Rapor üretimi await içerdiği ve
  // ağ diskinden okuma uzun sürebildiği için, eşzamanlı gelen ikinci istek aksi
  // halde aynı vardiyayı "gönderilmemiş" görüp raporu ikinci kez gönderiyordu.
  const files = listUnreportedShiftFiles().filter(claimShift);
  const out: { file: string; text: string }[] = [];
  for (const f of files) {
    const r = await buildShiftReport(f);
    if (r.ok) out.push({ file: f, text: r.text });
  }
  return out;
}

// Vardiya raporu KAPALIYKEN çağrılır: rapor üretmeden, yeni dosyaları sessizce
// "raporlandı" işaretler. Böylece özellik yeniden açıldığında geçmiş vardiyalar
// toplu gönderilmez; yalnızca açıldıktan sonra düşenler raporlanır.
export function skipPendingShifts(): void {
  if (ensureShiftBaseline()) return;
  for (const f of listUnreportedShiftFiles()) claimShift(f);
}

// ---------------------------------------------------------------------------
// Gösterge Paneli (dashboard) verisi — tamamı gerçek VRD satışından üretilir.
// Bağlı olmayan modüller (market, tank) "bağlı değil" olarak işaretlenir.
// ---------------------------------------------------------------------------

export type DashKpi = {
  key: string;
  label: string;
  value: string;
  change: string;
  positive: boolean;
  sub: string;
  connected: boolean;
};

export type DashWeekly = { gun: string; motorin: number; benzin: number; lpg: number };
export type DashFuelMix = { name: string; value: number; color: string };
export type DashShift = { name: string; ciro: string; litre: string; musteri: number };

export type DashboardData = {
  hasData: boolean;
  stationName: string;
  dateLabel: string;
  summary: string;
  kpis: DashKpi[];
  weekly: DashWeekly[];
  fuelMix: DashFuelMix[];
  shifts: DashShift[];
};

const FUEL_COLORS: Record<string, string> = {
  Motorin: "#2563eb",
  Benzin: "#f97316",
  "LPG / Otogaz": "#22c55e",
  AdBlue: "#a855f7",
  Diğer: "#94a3b8",
};

const WEEKDAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return WEEKDAYS_SHORT[new Date(y, m - 1, d).getDay()];
}

function pctChange(now: number, prev: number): { change: string; positive: boolean } {
  if (!prev || prev <= 0) return { change: "—", positive: true };
  const p = ((now - prev) / prev) * 100;
  const sign = p >= 0 ? "+" : "";
  return { change: `${sign}%${p.toFixed(1).replace(".", ",")}`, positive: p >= 0 };
}

function fuelTutar(agg: Aggregation, yakit: string): number {
  return agg.yakitlar.find((f) => f.yakit === yakit)?.tutar ?? 0;
}

export function buildDashboardData(): DashboardData {
  const stationName = getStationName();
  const calendar = getCalendar();

  if (calendar.length === 0) {
    return {
      hasData: false,
      stationName,
      dateLabel: "",
      summary:
        "Pompa satış verisi (VRD) henüz okunamadı. Veriler bağlanınca gösterge paneli gerçek satışlarla dolacak.",
      kpis: [],
      weekly: [],
      fuelMix: [],
      shifts: [],
    };
  }

  const day = calendar[0];
  const agg = summarizeDay(day);
  const prevAgg = calendar[1] ? summarizeDay(calendar[1]) : null;

  // --- KPI'lar ---
  const ciroChange = pctChange(agg.toplamTutar, prevAgg?.toplamTutar ?? 0);
  const litreChange = pctChange(agg.toplamLitre, prevAgg?.toplamLitre ?? 0);
  const fisChange = pctChange(agg.fisAdedi, prevAgg?.fisAdedi ?? 0);
  const prevSub = prevAgg ? `Önceki gün: ${tl(prevAgg.toplamTutar)}` : "Önceki gün verisi yok";

  const kpis: DashKpi[] = [
    {
      key: "fuel",
      label: "Günlük Yakıt Cirosu",
      value: tl(agg.toplamTutar),
      change: ciroChange.change,
      positive: ciroChange.positive,
      sub: prevSub,
      connected: true,
    },
    {
      key: "liters",
      label: "Satılan Yakıt",
      value: lt(agg.toplamLitre),
      change: litreChange.change,
      positive: litreChange.positive,
      sub: prevAgg ? `Önceki gün: ${lt(prevAgg.toplamLitre)}` : "Önceki gün verisi yok",
      connected: true,
    },
    {
      key: "fis",
      label: "Fiş Sayısı (müşteri)",
      value: agg.fisAdedi.toLocaleString("tr-TR"),
      change: fisChange.change,
      positive: fisChange.positive,
      sub: prevAgg ? `Önceki gün: ${prevAgg.fisAdedi.toLocaleString("tr-TR")} fiş` : "Önceki gün verisi yok",
      connected: true,
    },
  ];

  // --- Haftalık trend (son 7 gün, bin ₺) ---
  const weeklyDays = calendar.slice(0, 7).reverse(); // eski -> yeni
  const weekly: DashWeekly[] = weeklyDays.map((d) => {
    const a = summarizeFiles(d.vardiyalar.map((v) => v.file));
    return {
      gun: weekdayShort(d.iso),
      motorin: Math.round(fuelTutar(a, "motorin") / 1000),
      benzin: Math.round(fuelTutar(a, "benzin") / 1000),
      lpg: Math.round(fuelTutar(a, "lpg") / 1000),
    };
  });

  // --- Yakıt dağılımı (en güncel gün, % ciro) ---
  const fuelMix: DashFuelMix[] = agg.yakitlar
    .filter((f) => f.tutar > 0)
    .map((f) => ({
      name: f.label,
      value: agg.toplamTutar > 0 ? Math.round((f.tutar / agg.toplamTutar) * 100) : 0,
      color: FUEL_COLORS[f.label] ?? "#94a3b8",
    }))
    .filter((f) => f.value > 0);

  // --- Vardiya performansı (gerçek 1./2./3. vardiya) ---
  const shifts: DashShift[] = day.vardiyalar.map((v) => ({
    name: `${v.no}. Vardiya`,
    ciro: tl(v.toplamTutar),
    litre: lt(v.toplamLitre),
    musteri: v.fisAdedi,
  }));

  // En çok satan yakıt (özet metninde kullanılır)
  const topFuel = [...agg.yakitlar].filter((f) => f.tutar > 0).sort((a, b) => b.tutar - a.tutar)[0];

  // --- Günlük özet metni (veriden kurulu kısa özet) ---
  const summary = buildDashboardSummary(stationName, day.iso, agg, prevAgg, topFuel?.label);

  return {
    hasData: true,
    stationName,
    dateLabel: fmtDay(day.iso),
    summary,
    kpis,
    weekly,
    fuelMix,
    shifts,
  };
}

// Veriden kurulu kısa özet (AI çağrısı yapmadan; sayfa server-render hızlı kalsın).
function buildDashboardSummary(
  stationName: string,
  iso: string,
  agg: Aggregation,
  prevAgg: Aggregation | null,
  topFuelLabel?: string
): string {
  const parts: string[] = [];
  parts.push(`${fmtDay(iso)} toplam yakıt cirosu ${tl(agg.toplamTutar)} (${lt(agg.toplamLitre)}, ${agg.fisAdedi} fiş).`);
  if (prevAgg) {
    const c = pctChange(agg.toplamTutar, prevAgg.toplamTutar);
    parts.push(`Önceki güne göre ${c.positive ? "artış" : "düşüş"} var (${c.change}).`);
  }
  if (topFuelLabel) parts.push(`En güçlü kalem ${topFuelLabel}.`);
  return parts.join(" ");
}

// AI sohbeti için gerçek veri bağlamı: en yeni günün satış özeti (mock yerine).
export function buildRealStationContext(): string {
  const calendar = getCalendar();
  if (calendar.length === 0) {
    return "GÜNCEL VERİ: Pompa satış verisi (VRD) henüz bağlı değil.";
  }
  const day = calendar[0];
  const agg = summarizeDay(day);
  const fuels = agg.yakitlar
    .filter((f) => f.tutar > 0)
    .map((f) => `- ${f.label}: ${tl(f.tutar)} / ${lt(f.litre)}`)
    .join("\n");
  const musteri = agg.musteriTipi
    .filter((m) => m.tutar > 0)
    .map((m) => `- ${m.label}: ${tl(m.tutar)} (${m.adet} fiş)`)
    .join("\n");
  const filolar = agg.topFilolar
    .slice(0, 5)
    .map((f) => `- ${f.ad}: ${tl(f.tutar)} / ${lt(f.litre)}`)
    .join("\n");

  // Gerçek vardiya kırılımı (1./2./3. vardiya).
  const vardiyalar = day.vardiyalar
    .map(
      (v) => `- ${v.no}. Vardiya: ${tl(v.toplamTutar)} / ${lt(v.toplamLitre)} / ${v.fisAdedi} fiş`
    )
    .join("\n");

  // Gerçek saatlik yoğunluk (saat -> ciro / fiş adedi).
  const saatlik = agg.saatler
    .filter((h) => h.tutar > 0)
    .map(
      (h) => `- ${String(h.saat).padStart(2, "0")}:00: ${tl(h.tutar)} / ${h.adet} fiş`
    )
    .join("\n");

  return `GERÇEK SATIŞ VERİSİ (${getStationName()}, en güncel gün: ${fmtDay(day.iso)}):

Toplam ciro: ${tl(agg.toplamTutar)}
Toplam satış: ${lt(agg.toplamLitre)} · ${agg.fisAdedi} fiş

Yakıt kırılımı:
${fuels || "- veri yok"}

Müşteri tipi:
${musteri || "- veri yok"}

En çok alan filolar:
${filolar || "- veri yok"}

Vardiya kırılımı:
${vardiyalar || "- veri yok"}

Saatlik satış (saat: ciro / fiş sayısı) — en yoğun saatler/vardiya için bunu kullan;
fiş sayısı müşteri sayısına en yakın ölçüdür:
${saatlik || "- veri yok"}

Not: Bu veriler pompadan (VRD) gerçek satışlardır. Geçmiş günler de mevcut; tarih sorulursa
"Satış Raporu" sayfasından gün/hafta/ay seçilebileceğini söyle.`;
}
