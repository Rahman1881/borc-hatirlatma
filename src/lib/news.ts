import getDb from "@/lib/db";
import { askGeminiGrounded, isGeminiConfigured } from "@/lib/gemini";
import { getStationName } from "@/lib/station-report";

// Günlük haber bülteni: Gemini'nin Google Arama (grounding) yeteneğiyle güncel
// web'i kendisi araştırır; son 1-2 günün petrol (Brent), Türkiye akaryakıt ve
// ilgili ekonomi gelişmelerini SOMUT rakamlarla, BİRBİRİNDEN FARKLI 5 başlık
// halinde özetler. Sonuç gün bazında önbelleğe alınır (telegram_news_cache).

export type ReportResult = { ok: boolean; text: string };

type NewsEntry = { baslik?: string; aciklama?: string };

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

  if (!isGeminiConfigured()) {
    return {
      ok: false,
      text: "📰 Haber bülteni için Gemini API anahtarı gerekli. Ayarlar > Yapay Zeka bölümünden girin.",
    };
  }

  const bugun = fmtTodayLong();

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

Yanıtı SADECE şu JSON ile ver (başka açıklama ekleme):
{"haberler":[{"baslik":"kısa net başlık","aciklama":"somut veri içeren 1-2 cümle"}]}`;

  let result: { text: string; sources: { title: string; url: string }[] };
  try {
    result = await askGeminiGrounded(
      system,
      `Bugün ${bugun}. Son 1-2 günün en güncel petrol, Türkiye akaryakıt ve ilgili ekonomi gelişmelerini araştır ve istenen JSON formatında, 5 FARKLI konuda, somut rakamlarla ver.`
    );
  } catch {
    return { ok: false, text: "📰 Haber bülteni üretilemedi (AI yanıtı alınamadı)." };
  }

  const json = extractJson(result.text);
  if (!json) {
    return { ok: false, text: "📰 Haber bülteni üretilemedi (yanıt çözümlenemedi)." };
  }

  let parsed: { haberler?: NewsEntry[] };
  try {
    parsed = JSON.parse(json) as { haberler?: NewsEntry[] };
  } catch {
    return { ok: false, text: "📰 Haber bülteni üretilemedi (yanıt çözümlenemedi)." };
  }

  const haberler = (parsed.haberler || [])
    .filter((h) => h.baslik && h.aciklama)
    .slice(0, 5);

  if (haberler.length === 0) {
    return { ok: false, text: "📰 Bugün öne çıkan petrol/akaryakıt haberi bulunamadı." };
  }

  const lines = haberler
    .map((h, i) => `${i + 1}. <b>${h.baslik}</b>\n${h.aciklama}`)
    .join("\n\n");

  // Kaynak adlarını (en fazla 4) dipnota ekle.
  const sourceNames = result.sources
    .map((s) => s.title)
    .filter(Boolean)
    .slice(0, 4);
  const kaynak =
    sourceNames.length > 0
      ? `Kaynak: ${sourceNames.join(", ")} · Google Arama + AI`
      : "Kaynak: Google Arama + AI";

  const text = `📰 <b>${getStationName()} — Günlük Petrol & Akaryakıt Bülteni</b>\n${fmtToday()}\n\n${lines}\n\n<i>${kaynak}</i>`;

  writeCache(gun, text);
  return { ok: true, text };
}
