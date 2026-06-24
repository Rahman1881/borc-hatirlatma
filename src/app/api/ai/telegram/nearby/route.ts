import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { searchPlacesNear, isPlacesConfigured, type PlaceResult } from "@/lib/places";

export const maxDuration = 60;

// Telegram'dan paylaşılan konuma en yakın potansiyel akaryakıt müşterilerini bulur.
// İlk istek (lat/lng) tüm sonuçları bulup önbelleğe alır ve ilk 10'u döndürür.
// { more: true } isteği aynıları tekrar göndermeden sonraki 10'u verir.
//
// POST { chatId, lat, lng, keyword? }  -> ilk 10
// POST { chatId, more: true }          -> sonraki 10

const BATCH = 10;
const RADIUS_M = 15000;

// Yüksek yakıt/filo potansiyelli işletme sorguları (varsayılan set).
const NEARBY_QUERIES = [
  "nakliye lojistik firması",
  "kargo dağıtım şubesi",
  "personel servis taşımacılığı",
  "inşaat hafriyat firması",
  "fabrika sanayi üretim",
  "oto kiralama filo",
  "tarım kooperatifi traktör bayi",
];

type CachedLead = {
  id: string;
  name: string;
  phone: string;
  address: string;
  mapsUrl: string;
  lat: number | null;
  lng: number | null;
  dist: number; // metre
};

function normName(s: string): string {
  return s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

// İki koordinat arası mesafe (metre) — haversine.
function distMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function mapsLink(l: CachedLead): string {
  if (l.mapsUrl) return l.mapsUrl;
  if (l.lat != null && l.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
  }
  return "";
}

// Bir grup sonucu numaralı, telefon ve harita linkli düz metne çevirir.
function formatBatch(batch: CachedLead[], startIndex: number): string {
  const lines = batch.map((l, i) => {
    const n = startIndex + i + 1;
    const phone = l.phone ? `📞 ${l.phone}` : "📞 telefon yok";
    const map = mapsLink(l);
    const parts = [`${n}. ${l.name} — ${fmtDist(l.dist)}`, `   ${phone}`];
    if (map) parts.push(`   🗺 ${map}`);
    return parts.join("\n");
  });
  return lines.join("\n\n");
}

// Kayıtlı müşterileri (tekrar önerilmesin diye) id ve isimleriyle getirir.
function getSavedExclusions(): { ids: Set<string>; names: Set<string> } {
  const db = getDb();
  const rows = db.prepare("SELECT data FROM musteri_saved").all() as {
    data: string;
  }[];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const r of rows) {
    try {
      const c = JSON.parse(r.data) as { id?: string; name?: string };
      if (c.id) ids.add(c.id);
      if (c.name) names.add(normName(c.name));
    } catch {
      // bozuk kayıt — atla
    }
  }
  return { ids, names };
}

function readCache(chatId: string): { leads: CachedLead[]; sent: number } | null {
  const db = getDb();
  const row = db
    .prepare("SELECT leads, sent FROM telegram_nearby_cache WHERE chat_id = ?")
    .get(chatId) as { leads: string; sent: number } | undefined;
  if (!row) return null;
  try {
    return { leads: JSON.parse(row.leads) as CachedLead[], sent: row.sent };
  } catch {
    return null;
  }
}

function writeCache(chatId: string, leads: CachedLead[], sent: number) {
  getDb()
    .prepare(
      `INSERT INTO telegram_nearby_cache (chat_id, leads, sent, created_at)
       VALUES (?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(chat_id) DO UPDATE SET
         leads = excluded.leads, sent = excluded.sent, created_at = excluded.created_at`
    )
    .run(chatId, JSON.stringify(leads), sent);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const chatId = String(body?.chatId ?? "");
    if (!chatId) {
      return NextResponse.json({ error: "chatId gerekli." }, { status: 400 });
    }

    // --- "devam": önbellekten sonraki partiyi gönder ---
    if (body?.more) {
      const cache = readCache(chatId);
      if (!cache || cache.leads.length === 0) {
        return NextResponse.json({
          text: "Önce konumunu paylaş, sana en yakın müşterileri bulayım. /yakin",
          hasMore: false,
        });
      }
      const batch = cache.leads.slice(cache.sent, cache.sent + BATCH);
      if (batch.length === 0) {
        return NextResponse.json({
          text: "Bu konum için başka yakın müşteri kalmadı.",
          hasMore: false,
        });
      }
      const newSent = cache.sent + batch.length;
      writeCache(chatId, cache.leads, newSent);
      const hasMore = newSent < cache.leads.length;
      const text =
        `📍 Sonraki ${batch.length} müşteri:\n\n` +
        formatBatch(batch, cache.sent) +
        (hasMore ? `\n\nDaha fazlası için "devam" yaz.` : "");
      return NextResponse.json({ text, hasMore });
    }

    // --- Yeni konum: ara, sırala, önbelleğe al, ilk partiyi gönder ---
    if (!isPlacesConfigured()) {
      return NextResponse.json({
        text:
          "Google Places API anahtarı tanımlı değil. Ayarlar > Google Places bölümünden anahtarı girin.",
        hasMore: false,
      });
    }

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "Geçersiz konum." }, { status: 400 });
    }

    const keyword =
      typeof body?.keyword === "string" && body.keyword.trim()
        ? body.keyword.trim()
        : "";
    const queries = keyword ? [keyword] : NEARBY_QUERIES;

    // Tüm sorguları paralel çalıştır.
    const results = await Promise.all(
      queries.map((q) =>
        searchPlacesNear(q, lat, lng, RADIUS_M, 20).catch(
          () => [] as PlaceResult[]
        )
      )
    );

    const { ids: savedIds, names: savedNames } = getSavedExclusions();
    const seen = new Set<string>();
    const leads: CachedLead[] = [];

    for (const list of results) {
      for (const p of list) {
        if (p.lat == null || p.lng == null) continue;
        const key = p.id || normName(p.name);
        if (seen.has(key)) continue;
        if (savedIds.has(p.id)) continue;
        if (savedNames.has(normName(p.name))) continue;
        const dist = distMeters(lat, lng, p.lat, p.lng);
        if (dist > RADIUS_M) continue; // yarıçap dışını ele
        seen.add(key);
        leads.push({
          id: p.id,
          name: p.name,
          phone: p.phone,
          address: p.address,
          mapsUrl: p.mapsUrl,
          lat: p.lat,
          lng: p.lng,
          dist,
        });
      }
    }

    leads.sort((a, b) => a.dist - b.dist);

    if (leads.length === 0) {
      writeCache(chatId, [], 0);
      return NextResponse.json({
        text: "Bu çevrede (15 km) potansiyel müşteri bulunamadı.",
        hasMore: false,
      });
    }

    const batch = leads.slice(0, BATCH);
    writeCache(chatId, leads, batch.length);
    const hasMore = leads.length > batch.length;
    const text =
      `📍 Sana en yakın ${batch.length} potansiyel müşteri:\n\n` +
      formatBatch(batch, 0) +
      (hasMore ? `\n\nDaha fazlası için "devam" yaz.` : "");
    return NextResponse.json({ text, hasMore, total: leads.length });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Yakın müşteri araması başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
