import {
  ensureDailyPrices,
  plakaForIl,
  type FuelType,
  type PriceRow,
} from "@/lib/fuel-prices";
import { getStationName } from "@/lib/station-report";

// Rakip akaryakıt fiyat karşılaştırması (Telegram raporu). İstasyonun bulunduğu
// Sakarya/Serdivan için belli başlı markaların benzin ve motorin fiyatlarını
// pahalıdan ucuza sıralayıp gönderir. LPG dahil edilmez. "Bizimki" (Petrol Ofisi)
// satırı vurgulanır.

export type ReportResult = { ok: boolean; text: string };

const STATION = { il: "Sakarya", ilce: "Serdivan", plaka: 54 };

// Rapora girecek markalar (istenen sıraya göre). Anahtar: doviz.com marka adıyla
// eşleşmek için kullanılan parça; etiket: Telegram'da gösterilecek ad.
const BRANDS: { match: string; label: string; isOurs?: boolean }[] = [
  { match: "petrol ofisi", label: "Petrol Ofisi (Bizimki)", isOurs: true },
  { match: "opet", label: "Opet" },
  { match: "shell", label: "Shell" },
  { match: "aytemiz", label: "Aytemiz" },
  { match: "sunpet", label: "Sunpet" },
  { match: "alpet", label: "Alpet" },
];

// Sadece benzin ve motorin (LPG yok), gösterim sırası.
const FUELS: { key: FuelType; label: string; icon: string }[] = [
  { key: "benzin", label: "Benzin", icon: "⛽" },
  { key: "motorin", label: "Motorin", icon: "🛢" },
];

function tl(n: number): string {
  return `₺${n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtToday(): string {
  const months = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Bir markayı, kayıttaki marka adından (içerir-tabanlı) eşler.
function matchBrand(marka: string): (typeof BRANDS)[number] | null {
  const n = marka.toLocaleLowerCase("tr");
  for (const b of BRANDS) {
    if (n.includes(b.match)) return b;
  }
  return null;
}

type Entry = { label: string; fiyat: number; isOurs: boolean };

// Belirli bir yakıt için, hedef markaların fiyatlarını pahalıdan ucuza sıralı döner.
function entriesForFuel(rows: PriceRow[], fuel: FuelType): Entry[] {
  const byLabel = new Map<string, Entry>();
  for (const r of rows) {
    if (r.yakit !== fuel) continue;
    const b = matchBrand(r.marka);
    if (!b) continue;
    const prev = byLabel.get(b.label);
    if (!prev || r.fiyat > 0) {
      byLabel.set(b.label, {
        label: b.label,
        fiyat: r.fiyat,
        isOurs: !!b.isOurs,
      });
    }
  }
  return Array.from(byLabel.values())
    .filter((e) => e.fiyat > 0)
    .sort((a, b) => b.fiyat - a.fiyat); // pahalıdan ucuza
}

export async function buildPriceReport(): Promise<ReportResult> {
  const plaka = plakaForIl(STATION.il) ?? STATION.plaka;
  const info = await ensureDailyPrices(plaka, STATION.il, STATION.ilce);

  if (info.rows.length === 0) {
    return {
      ok: false,
      text: "💸 Bugün için rakip akaryakıt fiyatı alınamadı (kaynağa ulaşılamadı).",
    };
  }

  const blocks: string[] = [];
  for (const f of FUELS) {
    const entries = entriesForFuel(info.rows, f.key);
    if (entries.length === 0) continue;
    const lines = entries.map((e, i) => {
      const name = e.isOurs ? `<b>${e.label}</b>` : e.label;
      return `${i + 1}. ${name} — ${tl(e.fiyat)}`;
    });
    blocks.push(`${f.icon} <b>${f.label}</b> (pahalıdan ucuza)\n${lines.join("\n")}`);
  }

  if (blocks.length === 0) {
    return {
      ok: false,
      text: "💸 Bugün için rakip benzin/motorin fiyatı bulunamadı.",
    };
  }

  const text =
    `💸 <b>${getStationName()} — Rakip Fiyat Karşılaştırması</b>\n${fmtToday()}\n\n` +
    blocks.join("\n\n") +
    `\n\n<i>Kaynak: marka dağıtıcı fiyatları · Serdivan/Sakarya</i>`;

  return { ok: true, text };
}
