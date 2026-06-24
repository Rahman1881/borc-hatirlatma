import getDb from "@/lib/db";
import {
  getCalendar,
  summarizeFiles,
  type Aggregation,
  type CalendarDay,
} from "@/lib/vrd-sales";
import { askGemini, isGeminiConfigured } from "@/lib/gemini";

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

// Bir gün/dönem için kısa AI yorumu (Gemini varsa). Hata olursa boş döner.
async function aiComment(title: string, agg: Aggregation): Promise<string> {
  if (!isGeminiConfigured()) return "";
  try {
    const data = `Dönem: ${title}
Toplam ciro: ${agg.toplamTutar} TL
Toplam litre: ${agg.toplamLitre}
Fiş adedi: ${agg.fisAdedi}
Yakıtlar: ${agg.yakitlar.map((f) => `${f.label} ${f.tutar}TL/${f.litre}L`).join(", ")}
Müşteri tipi: ${agg.musteriTipi.map((m) => `${m.label} ${m.tutar}TL`).join(", ")}
En çok alan filolar: ${agg.topFilolar.slice(0, 5).map((f) => `${f.ad} ${f.tutar}TL`).join(", ")}`;

    const reply = await askGemini(
      [{ role: "user", text: `Bu satış verisini 1-2 cümleyle yorumla:\n${data}` }],
      `Sen bir akaryakıt istasyonu iş zekası asistanısın. Verilen satış özetini patron için
çok kısa (en fazla 2 cümle), pratik ve Türkçe yorumla. Dikkat çeken nokta varsa belirt.
Rakamları ₺ ile yaz. Selamlama yapma, doğrudan yoruma geç.`
    );
    return reply.trim();
  } catch {
    return "";
  }
}

// En yeni günün (ya da verilen iso'nun) tüm vardiyalarını birleştirip özetler.
function summarizeDay(day: CalendarDay): Aggregation {
  const files = day.vardiyalar.map((v) => v.file);
  return summarizeFiles(files);
}

export type ReportResult = { ok: boolean; text: string };

// Günlük kapanış raporu: en yeni güne ait satışlar.
export async function buildDailyReport(): Promise<ReportResult> {
  const calendar = getCalendar();
  if (calendar.length === 0) {
    return {
      ok: false,
      text: "📊 Günlük rapor hazırlanamadı: pompa satış verisi (VRD) bulunamadı.",
    };
  }
  const day = calendar[0];
  const agg = summarizeDay(day);
  const comment = await aiComment(fmtDay(day.iso), agg);

  const vardiyaLines = day.vardiyalar
    .map((v) => `  • ${v.no}. Vardiya: ${tl(v.toplamTutar)} · ${lt(v.toplamLitre)}`)
    .join("\n");

  let text = `📊 <b>${getStationName()} — Günlük Rapor</b>\n${fmtDay(day.iso)}\n\n`;
  text += aggregationLines(agg);
  if (vardiyaLines) text += `\n\n<b>Vardiyalar:</b>\n${vardiyaLines}`;
  if (comment) text += `\n\n💡 ${comment}`;
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
  const comment = await aiComment(period, agg);

  const dayLines = days
    .map((d) => {
      const t = d.vardiyalar.reduce((s, v) => s + v.toplamTutar, 0);
      return `  • ${fmtDay(d.iso)}: ${tl(t)}`;
    })
    .join("\n");

  let text = `📊 <b>${getStationName()} — Haftalık Rapor</b>\n${period}\n\n`;
  text += aggregationLines(agg);
  if (dayLines) text += `\n\n<b>Günlük ciro:</b>\n${dayLines}`;
  if (comment) text += `\n\n💡 ${comment}`;
  return { ok: true, text };
}

export async function buildReport(type: "daily" | "weekly"): Promise<ReportResult> {
  return type === "weekly" ? buildWeeklyReport() : buildDailyReport();
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

  return `GERÇEK SATIŞ VERİSİ (${getStationName()}, en güncel gün: ${fmtDay(day.iso)}):

Toplam ciro: ${tl(agg.toplamTutar)}
Toplam satış: ${lt(agg.toplamLitre)} · ${agg.fisAdedi} fiş

Yakıt kırılımı:
${fuels || "- veri yok"}

Müşteri tipi:
${musteri || "- veri yok"}

En çok alan filolar:
${filolar || "- veri yok"}

Not: Bu veriler pompadan (VRD) gerçek satışlardır. Geçmiş günler de mevcut; tarih sorulursa
"Satış Raporu" sayfasından gün/hafta/ay seçilebileceğini söyle.`;
}
