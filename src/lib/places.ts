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

type LocationBias = {
  circle: { center: { latitude: number; longitude: number }; radius: number };
};

type SearchOptions = {
  textQuery: string;
  pageSize?: number;
  pageToken?: string;
  locationBias?: LocationBias;
};

// Google'ın yer nesnesini (arama sonucu ya da yer ayrıntısı) ortak biçime çevirir.
function toPlaceResult(p: Record<string, unknown>): PlaceResult {
  const displayName = p.displayName as { text?: string } | undefined;
  const primaryType = p.primaryTypeDisplayName as { text?: string } | undefined;
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
    ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
    businessStatus: String(p.businessStatus || ""),
  };
}

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
  if (opts.locationBias) body.locationBias = opts.locationBias;

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
  const places: PlaceResult[] = (data?.places || []).map(toPlaceResult);

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

// Belirli bir koordinatın çevresinde (locationBias dairesi) metin araması yapar.
// Telegram "yakınımdaki müşteriler" özelliği için kullanılır. locationBias yumuşak
// bir ipucudur; kesin yarıçap filtresi çağıran tarafta (haversine) uygulanır.
export async function searchPlacesNear(
  textQuery: string,
  lat: number,
  lng: number,
  radiusMeters = 15000,
  maxResults = 20
): Promise<PlaceResult[]> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    throw new Error(
      "Google Places API anahtarı tanımlı değil. Ayarlar > Yapay Zeka bölümünden anahtarı girin."
    );
  }

  const { places } = await searchTextOnce(apiKey, {
    textQuery,
    pageSize: Math.min(maxResults, 20),
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(Math.max(radiusMeters, 1), 50000),
      },
    },
  });
  return places;
}

// ---------------------------------------------------------------------------
// "Yeni İşletmeler" takibi için: sadece kimlik araması + yeni bulunanın ayrıntısı.
// ---------------------------------------------------------------------------

export type Rect = {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kota / geçici sunucu hatalarında birkaç kez bekleyip tekrar dener.
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let wait = 2000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, init);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(wait);
      wait *= 2;
      continue;
    }
    return res;
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const err = await res.json();
    return err?.error?.message || JSON.stringify(err);
  } catch {
    return res.statusText;
  }
}

// Bir dikdörtgen içinde metin sorgusuna uyan işletmelerin YALNIZ kimliklerini döndürür.
// Alan maskesinde yalnız places.id + nextPageToken olduğu için Google bunu "IDs Only"
// kademesinden, ücretsiz sayar. "Yakında açılacak" işletmeler de dahil edilir.
// Google bir aramada en fazla 60 sonuç verir; 60'a ulaşan alan "doymuş" sayılır ve
// çağıran tarafından daha küçük parçalara bölünmelidir.
export async function searchIdsInRect(
  textQuery: string,
  rect: Rect
): Promise<{ ids: string[]; requests: number; saturated: boolean }> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) throw new Error("Google Places API anahtarı tanımlı değil.");

  const ids: string[] = [];
  let requests = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const body: Record<string, unknown> = {
      textQuery,
      languageCode: "tr",
      regionCode: "TR",
      pageSize: 20,
      locationRestriction: { rectangle: rect },
      includeFutureOpeningBusinesses: true,
    };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,nextPageToken",
      },
      body: JSON.stringify(body),
    });
    requests++;
    if (!res.ok) {
      throw new Error(`Google Places isteği başarısız (${res.status}): ${await errorDetail(res)}`);
    }
    const data = (await res.json()) as { places?: { id?: string }[]; nextPageToken?: string };
    for (const p of data.places ?? []) if (p.id) ids.push(p.id);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    await sleep(300);
  }
  return { ids, requests, saturated: ids.length >= 60 };
}

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "location",
  "primaryTypeDisplayName",
  "googleMapsUri",
  "websiteUri",
  "businessStatus",
  "rating",
  "userRatingCount",
  "openingDate",
].join(",");

export type PlaceDetail = PlaceResult & { openingDate: string };

// Tek bir işletmenin ayrıntısı (ücretli; yalnız yeni bulunan işletmeler için çağrılır).
// openingDate yalnız "yakında açılacak" (FUTURE_OPENING) işletmelerde dolu gelir.
export async function getPlaceDetails(placeId: string): Promise<PlaceDetail> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) throw new Error("Google Places API anahtarı tanımlı değil.");
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=tr&regionCode=TR`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAIL_FIELDS },
  });
  if (!res.ok) {
    throw new Error(`Google Places ayrıntısı alınamadı (${res.status}): ${await errorDetail(res)}`);
  }
  const p = (await res.json()) as Record<string, unknown>;
  const od = p.openingDate as { year?: number; month?: number; day?: number } | undefined;
  const openingDate =
    od?.year && od?.month
      ? `${od.year}-${String(od.month).padStart(2, "0")}-${String(od.day || 1).padStart(2, "0")}`
      : "";
  return { ...toPlaceResult(p), openingDate };
}

