import getDb from "@/lib/db";
import { askGeminiJson, isGeminiConfigured } from "@/lib/gemini";
import { getStationName } from "@/lib/station-report";

// Günlük haber bülteni: petrol (global/Brent) ve Türkiye akaryakıt + ekonomi
// haberlerini Google Haberler RSS'ten çeker, Gemini ile 5 tanesini seçip kısa
// Türkçe açıklama yazdırır. Sonuç gün bazında önbelleğe alınır (telegram_news_cache).

export type ReportResult = { ok: boolean; text: string };

const FETCH_TIMEOUT_MS = 15_000;

// Google Haberler RSS arama sorguları (Türkçe, TR bölgesi).
const NEWS_QUERIES = [
  "akaryakıt fiyat zam Türkiye",
  "petrol Brent fiyat",
  "benzin motorin LPG fiyat",
];

type NewsItem = { title: string; source: string; pubDate: string };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// RSS pubDate (RFC822, ör. "Tue, 24 Jun 2026 09:30:00 GMT") -> zaman damgası (ms).
// Ayrıştırılamazsa null döner.
function parsePubDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Dünün başlangıcı (yerel saat, 00:00). Bülten yalnızca bundan sonraki haberleri
// içerir; böylece eski/bayat başlıklar elenir, sadece dün + bugünün gelişmeleri kalır.
function yesterdayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

const TR_MONTHS: Record<string, number> = {
  ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5,
  temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11,
};

// Google bazı "her güne" ait fiyat haberlerini eski içerikle ama yeni pubDate ile
// yeniden yayınlar (ör. başlıkta "8 Mayıs" geçer ama feed'de güncel görünür). Başlıkta
// geçen "8 Mayıs", "4 Nisan 2026" gibi tarih referanslarını bulur; başlık bir tarih
// içeriyor ve referans verilen EN YENİ tarih cutoff'tan eskiyse (bayat içerik) false
// döner. Tarih referansı yoksa true (pubDate'e güvenilir).
function titleDateOk(title: string, cutoff: number): boolean {
  const lc = title.toLocaleLowerCase("tr");
  const re =
    /(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?:\s+(\d{4}))?/g;
  const now = Date.now();
  let newest = -Infinity;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lc)) !== null) {
    const day = Number(m[1]);
    const month = TR_MONTHS[m[2]];
    const year = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (day < 1 || day > 31 || month == null) continue;
    let ts = new Date(year, month, day).getTime();
    // Yıl yazılmamışsa ve tarih bugünden çok ilerideyse, bir önceki yıla ait kabul et.
    if (!m[3] && ts > now + 7 * 86_400_000) {
      ts = new Date(year - 1, month, day).getTime();
    }
    found = true;
    if (ts > newest) newest = ts;
  }
  if (!found) return true;
  return newest >= cutoff;
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CarkPetrolBot/1.0)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

// Bir Google Haberler RSS sonucunu ayrıştırır.
function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    let title = tag(b, "title");
    const source = tag(b, "source");
    const pubDate = tag(b, "pubDate");
    // Google başlığı genelde "Haber başlığı - Kaynak" biçiminde; kaynağı ayır.
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (title) items.push({ title, source, pubDate });
  }
  return items;
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

  // Tüm sorguların RSS'ini paralel çek, başlıkları topla.
  const results = await Promise.all(
    NEWS_QUERIES.map((q) =>
      fetchWithTimeout(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=tr&gl=TR&ceid=TR:tr`
      )
        .then((r) => r.text())
        .then(parseRss)
        .catch(() => [] as NewsItem[])
    )
  );

  // Sadece dün (00:00) ve sonrasına ait haberleri al; eski/bayat başlıkları ele.
  const cutoff = yesterdayStart();

  // Tekilleştir (başlığa göre), tarihe göre süz, en yeni önce sırala, en fazla 20 aday.
  const seen = new Set<string>();
  const dated: { item: NewsItem; ts: number }[] = [];
  for (const list of results) {
    for (const it of list) {
      const key = it.title.toLocaleLowerCase("tr");
      if (seen.has(key)) continue;
      const ts = parsePubDate(it.pubDate);
      if (ts == null || ts < cutoff) continue; // tarihsiz ya da eski -> ele
      if (!titleDateOk(it.title, cutoff)) continue; // başlıkta eski tarih -> ele
      seen.add(key);
      dated.push({ item: it, ts });
    }
  }
  dated.sort((a, b) => b.ts - a.ts); // en yeni önce
  const candidates: NewsItem[] = dated.slice(0, 20).map((d) => d.item);

  if (candidates.length === 0) {
    return {
      ok: false,
      text: "📰 Dün için öne çıkan petrol/akaryakıt haberi bulunamadı.",
    };
  }

  // Gemini'den 5 haber seç + kısa Türkçe açıklama yazdır.
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.title}${c.source ? ` (${c.source})` : ""}`)
    .join("\n");

  const system = `Sen bir akaryakıt istasyonu patronu için GÜNLÜK haber bülteni hazırlıyorsun.
Sana verilen başlıklar yalnızca DÜNE ve bugüne ait, en yeni haberlerdir (en yeni önce sıralı).
Bunlardan PETROL (global/Brent fiyatları), TÜRKİYE AKARYAKIT (benzin/motorin/LPG fiyat-zam) ve
bunları etkileyen EKONOMİ konularıyla EN İLGİLİ ve EN GÜNCEL 5 tanesini seç. Eski/genel/bayat
görünen ya da alakasız (magazin, spor, siyaset vb.) başlıkları ELE. Her seçtiğin haber için
patronun işine yarayacak, 1-2 cümlelik, net Türkçe bir açıklama yaz. Açıklamada uydurma rakam
verme; sadece başlıktan çıkarılabilecek bilgiyi ve güncel bağlamı yaz.
Yanıtı SADECE şu JSON biçiminde ver: {"haberler":[{"baslik":"...","aciklama":"..."}]}
Tam olarak 5 öğe olsun (yeterli güncel haber yoksa daha az olabilir).`;

  let parsed: { haberler?: { baslik?: string; aciklama?: string }[] };
  try {
    parsed = await askGeminiJson<{ haberler?: { baslik?: string; aciklama?: string }[] }>(
      system,
      `Dünden bugüne en güncel haber başlıkları (en yeni önce):\n${list}`
    );
  } catch {
    return { ok: false, text: "📰 Haber bülteni üretilemedi (AI yanıtı alınamadı)." };
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

  const text = `📰 <b>${getStationName()} — Günlük Petrol & Akaryakıt Bülteni</b>\n${fmtToday()}\n\n${lines}\n\n<i>Kaynak: Google Haberler · AI özet</i>`;

  writeCache(gun, text);
  return { ok: true, text };
}

function fmtToday(): string {
  const months = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
