import getDb from "@/lib/db";
import { askGeminiGrounded, isGeminiConfigured } from "@/lib/gemini";
import { getStationName } from "@/lib/station-report";
import { computeForecast, getPumpChanges, listPrices } from "@/lib/fuel-forecast";
import { buildGazetteSection } from "@/lib/resmi-gazete";

// Günlük haber bülteni üç bölümdür:
//  1) Piyasa: portalın KENDİ verisi (ICE Brent, TCMB kuru, Petrol Ofisi pompa fiyatı, son
//     değişiklik, zam tahmini). Yapay zekâ kullanılmaz; rakamlar doğrudur.
//  2) Resmî Gazete: günün sayısından bizi ve Türkiye genelini ilgilendiren düzenlemeler
//     (başlıklar resmî siteden; bkz. resmi-gazete.ts).
//  3) Haberler: Gemini, Google Arama (grounding) ile son günlerin gelişmelerini özetler.
//     Arama eski haberleri de getirir ve model tarihine bakmadan güncel diye yazabilir
//     (14 Kasım 2026 bülteni Kasım 2024 rakamlarıyla gitti: Brent 71 $, dolar 34 TL). Bu yüzden
//     her haber kodda süzülür: yayın tarihi son günlerde olmalı, eski yıla atıf içermemeli ve
//     verdiği Brent / kur / pompa rakamı kendi verimizle tutmalı. Süzgeçten geçemeyen atılır;
//     hiçbiri geçemezse bülten yalnız piyasa bölümüyle gider.
// Sonuç gün bazında önbelleğe alınır (telegram_news_cache).

export type ReportResult = { ok: boolean; text: string };

type NewsEntry = { baslik?: string; aciklama?: string; tarih?: string };

const MAX_AGE_DAYS = 4; // haberin yayın tarihi en çok bu kadar gün eski olabilir

// Portalın kendi verisinden bugünün doğru rakamları (bulunamayan alan null).
type Facts = {
  brent: number | null;
  usd: number | null;
  marketDay: string | null;
  benzin: number | null;
  motorin: number | null;
};

function readFacts(): Facts {
  const facts: Facts = { brent: null, usd: null, marketDay: null, benzin: null, motorin: null };
  try {
    const prices = listPrices();
    const last = prices[prices.length - 1];
    if (last) {
      facts.usd = last.usd;
      facts.marketDay = last.tarih;
      facts.brent = [...prices].reverse().find((p) => p.brent != null)?.brent ?? null;
    }
    const pump = getDb()
      .prepare("SELECT yakit, fiyat FROM pump_prices WHERE tarih = (SELECT MAX(tarih) FROM pump_prices)")
      .all() as { yakit: string; fiyat: number }[];
    facts.benzin = pump.find((p) => p.yakit === "benzin")?.fiyat ?? null;
    facts.motorin = pump.find((p) => p.yakit === "motorin")?.fiyat ?? null;
  } catch {
    // veri yoksa süzgeç yalnız tarih kontrolüyle çalışır
  }
  return facts;
}

function tr(n: number, digits = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(n: number, digits = 2): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${tr(Math.abs(n), digits)}`;
}
function shortDay(iso: string): string {
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${months[m - 1]}`;
}

const LEVEL_SHORT: Record<string, string> = {
  zam: "zam bekleniyor",
  zam_yakin: "zam yaklaşıyor",
  notr: "hareket yok",
  indirim_yakin: "indirim yaklaşıyor",
  indirim: "indirim bekleniyor",
};

// Bültenin yapay zekâsız bölümü: portalın kendi verisi.
function marketSection(f: Facts): string {
  const lines: string[] = [];
  if (f.brent != null) lines.push(`• Brent: <b>${tr(f.brent, 1)} $</b>${f.marketDay ? ` (${shortDay(f.marketDay)}, ICE)` : ""}`);
  if (f.usd != null) lines.push(`• Dolar: <b>${tr(f.usd, 2)} TL</b> (TCMB)`);
  if (f.benzin != null || f.motorin != null) {
    const parts = [
      f.benzin != null ? `benzin <b>${tr(f.benzin)} TL</b>` : null,
      f.motorin != null ? `motorin <b>${tr(f.motorin)} TL</b>` : null,
    ].filter(Boolean);
    lines.push(`• Pompa (Petrol Ofisi Serdivan): ${parts.join(" · ")}`);
  }
  try {
    const changes = getPumpChanges().filter((c) => !c.ignored);
    const last = (["benzin", "motorin"] as const)
      .map((y) => changes.filter((c) => c.yakit === y).pop())
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => `${c.yakit} ${shortDay(c.tarih)} ${signed(c.fark)} TL`);
    if (last.length) lines.push(`• Son fiyat değişikliği: ${last.join(" · ")}`);
    const calc = computeForecast();
    const tahmin = (["motorin", "benzin"] as const)
      .map((y) => {
        const r = calc[y].latest;
        return r ? `${y} ${signed(r.pct, 1)} (${LEVEL_SHORT[r.level] ?? ""})` : null;
      })
      .filter(Boolean);
    if (tahmin.length) lines.push(`• Zam/indirim tahmini: ${tahmin.join(" · ")}`);
  } catch {
    // tahmin verisi yoksa bu satırlar atlanır
  }
  return lines.length ? `📊 <b>Piyasa (kendi verimiz)</b>\n${lines.join("\n")}` : "";
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function numbers(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)]
    .map((m) => Number(m[1].replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
}

// Haberin güncel ve kendi verimizle tutarlı olup olmadığı. Atılacaksa nedenini döndürür.
export function staleReason(h: NewsEntry, f: Facts, today: string): string | null {
  const text = `${h.baslik ?? ""} ${h.aciklama ?? ""}`;
  const lower = text.toLocaleLowerCase("tr");
  const tarih = (h.tarih ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return "yayın tarihi yok";
  if (tarih < addDaysIso(today, -MAX_AGE_DAYS) || tarih > addDaysIso(today, 1)) return `eski tarih (${tarih})`;
  // İki yıl ve daha eski bir yıla atıf (ör. "2024 yılı talep tahmini") eski haber işaretidir.
  const year = Number(today.slice(0, 4));
  const oldYear = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])).find((y) => y <= year - 2);
  if (oldYear) return `eski yıla atıf (${oldYear})`;
  const off = (v: number, ref: number, tol: number) => Math.abs(v / ref - 1) > tol;
  if (f.brent != null && /brent|varil|ham petrol/.test(lower)) {
    const bad = numbers(text, /(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:dolar|\$|usd)/gi).find((v) => v >= 20 && v <= 300 && off(v, f.brent!, 0.12));
    if (bad != null) return `Brent ${bad} $ güncel değil (bizde ${tr(f.brent, 1)})`;
  }
  if (f.usd != null) {
    // Yalnız kur ifadesinin hemen ardından gelen tutar (aynı haberdeki pompa fiyatları değil).
    const bad = numbers(
      text,
      /(?:dolar\s*\/\s*tl|dolar kuru|usd\s*\/\s*try)[^.;]{0,60}?(\d{1,3}[.,]\d{2,4})\s*(?:tl|lira)/gi
    ).find((v) => v >= 5 && v <= 500 && off(v, f.usd!, 0.08));
    if (bad != null) return `kur ${bad} TL güncel değil (bizde ${tr(f.usd)})`;
  }
  const refs = [f.benzin, f.motorin].filter((x): x is number => x != null);
  if (refs.length && /benzin|motorin|mazot|lpg|pompa|litre/.test(lower)) {
    // Litre fiyatı gibi görünen tutarlar (indirim/zam tutarı gibi küçük rakamlar hariç).
    const lo = Math.min(...refs) * 0.3; // LPG benzinin yarısından ucuzdur
    const hi = Math.max(...refs) * 1.25;
    const bad = numbers(text, /(\d{2,3}[.,]\d{2})\s*(?:tl|lira)/gi).find((v) => v >= 10 && (v < lo || v > hi));
    const cheap = numbers(text, /(?:benzin|motorin|mazot)[^.]{0,40}?(\d{2,3}[.,]\d{2})\s*(?:tl|lira)/gi).find(
      (v) => v >= 10 && v < Math.min(...refs) * 0.75
    );
    if (bad != null || cheap != null) return `pompa fiyatı ${bad ?? cheap} TL güncel değil`;
  }
  return null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function fmtToday(): string {
  const months = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Bugünün uzun Türkçe tarihi (prompt'a "şu an hangi gündeyiz" bağlamı için).
function fmtTodayLong(): string {
  const months = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
  ];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function readCache(gun: string): string | null {
  const row = getDb()
    .prepare("SELECT text FROM telegram_news_cache WHERE gun = ?")
    .get(gun) as { text: string } | undefined;
  return row?.text ?? null;
}

function writeCache(gun: string, text: string): void {
  getDb()
    .prepare(
      `INSERT INTO telegram_news_cache (gun, text, created_at)
       VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(gun) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`
    )
    .run(gun, text);
}

// Grounding cevabı düz metindir; modelden JSON istesek de ```json çiti ya da
// ek açıklama gelebilir. Metin içinden ilk { ... son } bloğunu ayıklar.
function extractJson(text: string): string | null {
  // Önce kod çiti içindekini dene.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

// Günlük haber bültenini üretir. Aynı gün için bir kez üretilir, sonra önbellekten döner.
export async function buildNewsReport(force = false): Promise<ReportResult> {
  const gun = todayIso();

  if (!force) {
    const cached = readCache(gun);
    if (cached) return { ok: true, text: cached };
  }

  const bugun = fmtTodayLong();
  const facts = readFacts();
  // Piyasa ve Resmî Gazete bölümleri habere bağlı değildir; haber üretilemese de gider.
  const gazette = await buildGazetteSection(gun).catch(() => "");
  const market = [marketSection(facts), gazette].filter(Boolean).join("\n\n");
  const dogru = [
    facts.brent != null ? `Brent yaklaşık ${tr(facts.brent, 0)} dolar` : null,
    facts.usd != null ? `dolar/TL yaklaşık ${tr(facts.usd, 1)}` : null,
    facts.benzin != null ? `benzin litre fiyatı yaklaşık ${tr(facts.benzin, 0)} TL` : null,
    facts.motorin != null ? `motorin litre fiyatı yaklaşık ${tr(facts.motorin, 0)} TL` : null,
  ].filter(Boolean);

  const system = `Sen bir akaryakıt istasyonu patronu için GÜNLÜK haber bülteni hazırlıyorsun.
Bugün ${bugun}. Google Arama aracını kullanarak SON 1-2 GÜNE ait EN GÜNCEL gelişmeleri araştır.

Kapsam: küresel PETROL (Brent/ham petrol fiyatı, OPEC, arz-talep), TÜRKİYE AKARYAKIT
(benzin/motorin/LPG pompa fiyatı, zam/indirim), ve bunları etkileyen EKONOMİ
(dolar/TL kuru, EPDK/ÖTV/regülasyon, dağıtım-stok).

KURALLAR (çok önemli):
- Tam 5 haber yaz. Her biri FARKLI bir konu/olay olsun; aynı gelişmeyi (ör. "Brent düştü")
  farklı cümlelerle TEKRARLAMA. 5 başlık 5 ayrı konuyu kapsasın.
- Her açıklamada MUTLAKA somut bir veri olsun: rakam (fiyat, %, dolar, TL), tarih ya da
  taraf (kurum/şirket). Genel/clickbait/boş laf yazma.
- Bilgi UYDURMA. Aramada bulamadığın rakamı verme; emin olmadığını yazma.
- En güncel ve istasyon işine yarayacak gelişmelere öncelik ver.
- TARİH KONTROLÜ: Arama sonuçlarında geçmiş yıllardan (ör. aynı günün 2024 ya da 2025 tarihli)
  haberler de çıkar. Her haberin YAYIN TARİHİNE bak; ${bugun} tarihinden ${MAX_AGE_DAYS} günden eski
  haberi KULLANMA. Yayın tarihini göremediğin haberi kullanma.${
    dogru.length
      ? `\n- Bugünün gerçek değerleri (kendi kayıtlarımızdan): ${dogru.join(", ")}. Bunlardan belirgin
  biçimde farklı rakam veren haber ESKİDİR; kullanma.`
      : ""
  }
- Güncel haber azsa 5'e tamamlamak için eski haber ekleme; daha az haber yaz.

Yanıtı SADECE şu JSON ile ver (başka açıklama ekleme); "tarih" haberin yayın tarihidir:
{"haberler":[{"baslik":"kısa net başlık","aciklama":"somut veri içeren 1-2 cümle","tarih":"YYYY-AA-GG"}]}`;

  // Haber bölümü üretilemezse bülten yalnız kendi verimizle gider (önbelleğe yazılmaz; sonraki
  // istekte haberler yeniden denenir).
  const withoutNews = (why: string): ReportResult =>
    market
      ? {
          ok: true,
          text: `📰 <b>${getStationName()} — Günlük Petrol & Akaryakıt Bülteni</b>\n${fmtToday()}\n\n${market}\n\n<i>Haber bölümü bugün hazırlanamadı (${why}).</i>`,
        }
      : { ok: false, text: `📰 Haber bülteni üretilemedi (${why}).` };

  if (!isGeminiConfigured()) return withoutNews("Gemini API anahtarı tanımlı değil");

  let result: { text: string; sources: { title: string; url: string }[] };
  try {
    result = await askGeminiGrounded(
      system,
      `Bugün ${bugun}. Son 1-2 günün en güncel petrol, Türkiye akaryakıt ve ilgili ekonomi gelişmelerini araştır ve istenen JSON formatında, 5 FARKLI konuda, somut rakamlarla ver.`
    );
  } catch {
    return withoutNews("AI yanıtı alınamadı");
  }

  const json = extractJson(result.text);
  if (!json) {
    return withoutNews("yanıt çözümlenemedi");
  }

  let parsed: { haberler?: NewsEntry[] };
  try {
    parsed = JSON.parse(json) as { haberler?: NewsEntry[] };
  } catch {
    return withoutNews("yanıt çözümlenemedi");
  }

  // Süzgeç: eski ya da kendi verimizle çelişen haberler atılır (nedeni sunucu kaydına yazılır).
  const haberler = (parsed.haberler || [])
    .filter((h) => h.baslik && h.aciklama)
    .filter((h) => {
      const reason = staleReason(h, facts, gun);
      if (reason) console.warn(`[haber-bülteni] atıldı (${reason}): ${h.baslik}`);
      return !reason;
    })
    .slice(0, 5);

  if (haberler.length === 0 && !market) {
    return { ok: false, text: "📰 Bugün doğrulanabilen güncel petrol/akaryakıt haberi bulunamadı." };
  }

  const lines = haberler.length
    ? haberler.map((h, i) => `${i + 1}. <b>${h.baslik}</b>\n${h.aciklama}`).join("\n\n")
    : "Bugün doğrulanabilen güncel haber bulunamadı.";

  // Kaynak adlarını (en fazla 4) dipnota ekle.
  const sourceNames = result.sources
    .map((s) => s.title)
    .filter(Boolean)
    .slice(0, 4);
  const kaynak =
    sourceNames.length > 0
      ? `Kaynak: ${sourceNames.join(", ")} · Google Arama + AI`
      : "Kaynak: Google Arama + AI";

  const text = `📰 <b>${getStationName()} — Günlük Petrol & Akaryakıt Bülteni</b>\n${fmtToday()}\n\n${
    market ? `${market}\n\n` : ""
  }📰 <b>Haberler</b>\n${lines}\n\n<i>${kaynak}</i>`;

  writeCache(gun, text);
  return { ok: true, text };
}
