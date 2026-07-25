import { NextRequest, NextResponse } from "next/server";
import { searchPlaces, isPlacesConfigured, type PlaceResult } from "@/lib/places";
import {
  ensureDailyPrices,
  refreshDailyPrices,
  plakaForIl,
} from "@/lib/fuel-prices";

export const maxDuration = 60;

// İstasyonun konumu: Sakarya / Serdivan (plaka 54). Yakın rakip taraması bu merkezden yapılır.
const STATION = {
  il: "Sakarya",
  ilce: "Serdivan",
  plaka: 54,
  lat: 40.7726,
  lng: 30.3636,
};

// Bilinen akaryakıt markaları — istasyon adından marka çıkarımı için.
const KNOWN_BRANDS = [
  "Petrol Ofisi",
  "Shell",
  "BP",
  "Opet",
  "Total",
  "TotalEnergies",
  "Aytemiz",
  "Lukoil",
  "Alpet",
  "Moil",
  "Sunpet",
  "Termopet",
  "Kadoil",
  "Türkiye Petrolleri",
  "TP",
  "Belgin",
];

function detectBrand(name: string): string {
  const n = name.toLocaleLowerCase("tr");
  for (const b of KNOWN_BRANDS) {
    if (n.includes(b.toLocaleLowerCase("tr"))) {
      if (b === "TotalEnergies") return "Total";
      if (b === "TP") return "Türkiye Petrolleri";
      return b;
    }
  }
  return "";
}

// İki koordinat arası mesafe (km) — haversine.
function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type Station = PlaceResult & {
  brand: string;
  distanceKm: number | null;
};

async function findNearbyStations(): Promise<Station[]> {
  const region = `${STATION.ilce} ${STATION.il}`;
  const places = await searchPlaces(`akaryakıt istasyonu petrol ${region}`, 40);
  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const p of places) {
    const key = p.id || p.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const dist =
      p.lat != null && p.lng != null
        ? distanceKm(STATION.lat, STATION.lng, p.lat, p.lng)
        : null;
    stations.push({
      ...p,
      brand: detectBrand(p.name),
      distanceKm: dist != null ? Math.round(dist * 10) / 10 : null,
    });
  }
  stations.sort((a, b) => {
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
  return stations;
}

// GET: yakın istasyonlar + bugünün önbellekteki fiyatları + yapılandırma durumu.
export async function GET() {
  try {
    const plaka = plakaForIl(STATION.il) ?? STATION.plaka;
    const priceInfo = await ensureDailyPrices(plaka, STATION.il, STATION.ilce);

    let stations: Station[] = [];
    let placesError = "";
    if (isPlacesConfigured()) {
      try {
        stations = await findNearbyStations();
      } catch (e) {
        placesError = e instanceof Error ? e.message : "İstasyonlar alınamadı.";
      }
    }

    return NextResponse.json({
      station: STATION,
      tarih: priceInfo.tarih,
      priceSource: priceInfo.source,
      updatedAt: priceInfo.updatedAt,
      prices: priceInfo.rows,
      stations,
      placesConfigured: isPlacesConfigured(),
      placesError,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Rekabet verisi alınamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "");

    // Manuel çekim: önbelleği yok say, fiyatları kaynaktan yeniden çek.
    if (action === "refresh") {
      const plaka = plakaForIl(STATION.il) ?? STATION.plaka;
      const priceInfo = await refreshDailyPrices(plaka, STATION.il, STATION.ilce);

      let stations: Station[] = [];
      let placesError = "";
      if (isPlacesConfigured()) {
        try {
          stations = await findNearbyStations();
        } catch (e) {
          placesError = e instanceof Error ? e.message : "İstasyonlar alınamadı.";
        }
      }

      return NextResponse.json({
        station: STATION,
        tarih: priceInfo.tarih,
        priceSource: priceInfo.source,
        updatedAt: priceInfo.updatedAt,
        prices: priceInfo.rows,
        stations,
        placesConfigured: isPlacesConfigured(),
        placesError,
      });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "İşlem sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
