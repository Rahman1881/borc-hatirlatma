import { NextRequest, NextResponse } from "next/server";
import { searchPlaces, isPlacesConfigured, type PlaceResult } from "@/lib/places";
import { askGemini, isGeminiConfigured } from "@/lib/gemini";
import {
  ensureDailyPrices,
  refreshDailyPrices,
  plakaForIl,
  type FuelType,
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
      geminiConfigured: isGeminiConfigured(),
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
        geminiConfigured: isGeminiConfigured(),
        placesError,
      });
    }

    // AI analizi: kendi fiyatın ile çevredeki marka fiyatlarını kıyasla, yorum ver.
    if (action === "analyze") {
      if (!isGeminiConfigured()) {
        return NextResponse.json(
          {
            error:
              "Gemini API anahtarı tanımlı değil. Ayarlar > Yapay Zeka bölümünden anahtarı girin.",
          },
          { status: 400 }
        );
      }
      const plaka = plakaForIl(STATION.il) ?? STATION.plaka;
      const priceInfo = await ensureDailyPrices(plaka, STATION.il, STATION.ilce);

      let stations: Station[] = [];
      if (isPlacesConfigured()) {
        try {
          stations = await findNearbyStations();
        } catch {
          stations = [];
        }
      }

      // Markalara göre fiyatları derle.
      const priceByBrand: Record<string, Partial<Record<FuelType, number>>> = {};
      for (const r of priceInfo.rows) {
        if (!priceByBrand[r.marka]) priceByBrand[r.marka] = {};
        priceByBrand[r.marka][r.yakit] = r.fiyat;
      }

      const nearbyBrands = Array.from(
        new Set(stations.map((s) => s.brand).filter(Boolean))
      );

      const systemPrompt = `Sen Sakarya/Serdivan'da bir Petrol Ofisi akaryakıt istasyonunun rekabet analisti uzmanısın. Sana çevredeki rakip istasyonların markaları ve marka bazlı güncel akaryakıt fiyatları (benzin, motorin, lpg) verilecek. Görevin:
- Bizim istasyonumuz (Petrol Ofisi) ile rakipleri fiyat açısından kıyaslamak.
- Hangi yakıtta pahalı/ucuz olduğumuzu net belirtmek.
- Kısa, uygulanabilir bir fiyat/rekabet önerisi vermek.
Türkçe, kısa ve madde madde yaz. Veride olmayan fiyatı uydurma; eksikse "veri yok" de.`;

      const userText = JSON.stringify({
        istasyonumuz: "Petrol Ofisi",
        bolge: `${STATION.ilce} / ${STATION.il}`,
        tarih: priceInfo.tarih,
        fiyatKaynagi: priceInfo.source,
        markaFiyatlari: priceByBrand,
        cevredekiMarkalar: nearbyBrands,
        yakinIstasyonlar: stations.slice(0, 15).map((s) => ({
          ad: s.name,
          marka: s.brand || "bilinmiyor",
          mesafeKm: s.distanceKm,
        })),
      });

      const analysis = await askGemini(
        [{ role: "user", text: userText }],
        systemPrompt
      );

      return NextResponse.json({
        analysis,
        tarih: priceInfo.tarih,
        priceSource: priceInfo.source,
        prices: priceInfo.rows,
        stations,
      });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "İşlem sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
