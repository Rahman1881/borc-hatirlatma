import { NextRequest, NextResponse } from "next/server";
import { getPlateProfile, getRefDate } from "@/lib/vrd-analytics";
import { isValidPlate, normalizePlate } from "@/lib/vrd-ingest";

// Telegram plaka sorgusu: pompacı plakayı yazar, müşteri istasyondan çıkmadan
// "yeni mi, en son ne zaman geldi" görür. Worker (telegram-bot.mjs) bu uçtan
// biçimlenmiş metni alıp gönderir.
//
// Plaka geçmişi kişisel veri sayılır. Bu uç yalnızca aynı makinedeki bot içindir:
// portal (Cloudflare) üzerinden gelen her istek cf-connecting-ip başlığı taşır ve
// reddedilir.

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtDay(iso: string): string {
  const d = isoToDate(iso);
  return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Takvim gününe göre (bugün/dün/X gün önce) — pompacının merak ettiği bu.
function daysAgo(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - isoToDate(iso).getTime()) / 86400000);
}

function relDay(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return "bugün";
  if (d === 1) return "dün";
  return `${d} gün önce`;
}

// "54ZS4811" -> "54 ZS 4811" (pompacının telefonda kolay okuması için)
function fmtPlate(norm: string): string {
  return norm.replace(/^(\d{2})([A-Z]+)(\d+)$/, "$1 $2 $3");
}

function num(n: number): string {
  return n.toLocaleString("tr-TR");
}

// "Son veri" satırı; veri 2 günden eskiyse uyarır (ilk kez geliyor sonucu ona dayanır).
function freshnessLine(ref: string): string {
  const age = daysAgo(ref);
  return age > 2
    ? `⚠️ Veriler güncel değil — son veri ${fmtDay(ref)} (${age} gün önce).`
    : `Son veri: ${fmtDay(ref)}`;
}

function buildPlateText(query: string): string {
  const plaka = normalizePlate(query);
  if (!isValidPlate(plaka)) {
    return "Plaka anlaşılamadı. Örnek: 54 ABC 123";
  }

  const ref = getRefDate();
  if (!ref) {
    return "Plaka sorgusu için önce Müşteri Analitiği ekranında satış verilerinin aktarılması gerekiyor.";
  }

  const p = getPlateProfile(plaka);
  if (!p) {
    return [
      `🆕 <b>${esc(fmtPlate(plaka))}</b> · İLK KEZ GELİYOR`,
      "Bu plakayla daha önce peşin satış kaydı yok.",
      "",
      "<i>Filo / cari hesaplı araçlar bu sorguda görünmez.</i>",
      freshnessLine(ref),
    ].join("\n");
  }

  const shown = esc(fmtPlate(plaka));
  const head =
    p.segment === "Yeni"
      ? `🆕 <b>${shown}</b> · Yeni müşteri`
      : p.segment === "Kaçan"
        ? `⚠️ <b>${shown}</b> · Uzun süredir gelmiyordu`
        : `⭐ <b>${shown}</b> · Sadık müşteri`;

  const lines = [
    head,
    `Son geliş: <b>${relDay(p.sonIso)}</b> (${p.sonZiyaret})`,
    `Ziyaret: ${num(p.ziyaret)} kez · ilk: ${p.ilkZiyaret}`,
  ];
  if (p.ziyaret > 1 && p.ortAralik !== "—") {
    lines.push(`Sıklık: ortalama ${p.ortAralik}de bir · genelde ${p.saatTercihi}`);
  }
  const yakit = p.yakitKarma
    .slice(0, 2)
    .map((y) => `${y.yakit} %${y.pct}`)
    .join(", ");
  if (yakit) lines.push(`Yakıt: ${yakit} · toplam ${num(p.toplamLitre)} L`);
  const son = p.gecmis[0];
  if (son) {
    lines.push(`Son alım: ${son.tarih} · ${son.yakit} ${num(son.litre)} L · ${num(son.tutar)} ₺`);
  }
  lines.push("", freshnessLine(ref));
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  if (req.headers.get("cf-connecting-ip")) {
    return NextResponse.json({ ok: false, error: "Yetkisiz." }, { status: 403 });
  }
  try {
    const q = req.nextUrl.searchParams.get("q") || "";
    return NextResponse.json({ ok: true, text: buildPlateText(q) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Plaka sorgulanamadı.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
