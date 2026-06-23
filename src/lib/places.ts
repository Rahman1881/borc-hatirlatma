import getDb from "@/lib/db";

// Google Places API (New) — gerçek işletme verisi (ad, adres, telefon, harita).
// Anahtar Ayarlar'dan (settings tablosu) ya da ortam değişkeninden gelir.

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const REQUEST_TIMEOUT_MS = 15_000;

// fetch'i bir zaman aşımı ile sarmalar; süre dolarsa isteği iptal eder.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Google Places isteği zaman aşımına uğradı (${timeoutMs / 1000}sn).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.location",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
].join(",");

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  phone: string;
  mapsUrl: string;
  website: string;
  category: string;
  rating: number | null;
  ratingCount: number | null;
  lat: number | null;
  lng: number | null;
  businessStatus: string;
};

export function getPlacesApiKey(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("google_places_api_key") as { value: string } | undefined;
  return (row?.value || process.env.GOOGLE_PLACES_API_KEY || "").trim();
}

export function isPlacesConfigured(): boolean {
  return getPlacesApiKey().length > 0;
}

type SearchOptions = {
  textQuery: string;
  pageSize?: number;
  pageToken?: string;
};

async function searchTextOnce(
  apiKey: string,
  opts: SearchOptions
): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  const body: Record<string, unknown> = {
    textQuery: opts.textQuery,
    languageCode: "tr",
    regionCode: "TR",
    pageSize: opts.pageSize ?? 20,
  };
  if (opts.pageToken) body.pageToken = opts.pageToken;

  const res = await fetchWithTimeout(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": `${FIELD_MASK},nextPageToken`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Google Places isteği başarısız (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const places: PlaceResult[] = (data?.places || []).map(
    (p: Record<string, unknown>) => {
      const displayName = p.displayName as { text?: string } | undefined;
      const primaryType = p.primaryTypeDisplayName as
        | { text?: string }
        | undefined;
      const loc = p.location as { latitude?: number; longitude?: number } | undefined;
      return {
        id: String(p.id || ""),
        name: displayName?.text || "İsimsiz işletme",
        address: String(p.formattedAddress || ""),
        phone: String(p.nationalPhoneNumber || p.internationalPhoneNumber || ""),
        mapsUrl: String(p.googleMapsUri || ""),
        website: String(p.websiteUri || ""),
        category: primaryType?.text || "",
        rating: typeof p.rating === "number" ? p.rating : null,
        ratingCount:
          typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        lat: loc?.latitude ?? null,
        lng: loc?.longitude ?? null,
        businessStatus: String(p.businessStatus || ""),
      } as PlaceResult;
    }
  );

  return { places, nextPageToken: data?.nextPageToken };
}

// Bir metin sorgusu için birden çok sayfayı (maxPages) toplar.
export async function searchPlaces(
  textQuery: string,
  maxResults = 40
): Promise<PlaceResult[]> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    throw new Error(
      "Google Places API anahtarı tanımlı değil. Ayarlar > Yapay Zeka bölümünden anahtarı girin."
    );
  }

  const out: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let i = 0; i < 3 && out.length < maxResults; i++) {
    const { places, nextPageToken } = await searchTextOnce(apiKey, {
      textQuery,
      pageSize: 20,
      pageToken,
    });
    out.push(...places);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  return out.slice(0, maxResults);
}
