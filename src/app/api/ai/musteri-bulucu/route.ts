import { NextRequest, NextResponse } from "next/server";
import { searchPlaces, isPlacesConfigured, type PlaceResult } from "@/lib/places";
import { PROFILE_GROUPS, PROFILE_QUERIES } from "@/lib/prospect-profiles";

export const maxDuration = 60;

export type Lead = PlaceResult & {
  profile: string;
  sector: string;
};

function normName(s: string): string {
  return s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

// Türkçe karakterleri ascii'ye indirger; ilçe adı ile adres eşlemesi için.
function asciiNorm(s: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i", â: "a", î: "i", û: "u",
  };
  return s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüİâîû]/g, (c) => map[c] || c)
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    if (!isPlacesConfigured()) {
      return NextResponse.json(
        {
          error:
            "Google Places API anahtarı tanımlı değil. Gerçek işletme verisi (ad, adres, telefon) için Ayarlar > Google Places bölümünden anahtarı girin.",
          needsPlacesKey: true,
        },
        { status: 400 }
      );
    }

    const body = await req.json();
    const il = String(body.il || "").trim();
    const ilce = String(body.ilce || "").trim();
    const profiles: string[] = Array.isArray(body.profiles) ? body.profiles : [];
    const excludeIds = new Set<string>(
      Array.isArray(body.excludeIds) ? body.excludeIds.map(String) : []
    );
    const excludeNames = new Set<string>(
      (Array.isArray(body.excludeNames) ? body.excludeNames : []).map((n: string) =>
        normName(String(n))
      )
    );

    if (!il || profiles.length === 0) {
      return NextResponse.json(
        { error: "İl ve en az bir işletme profili seçin." },
        { status: 400 }
      );
    }

    const hasIlce = !!ilce && ilce !== "Tümü";
    const region = hasIlce ? `${ilce} ${il}` : il;
    // İlçe seçiliyse, Google'ın komşu ilçelere taşan sonuçlarını adrese göre ele.
    const ilceNorm = hasIlce ? asciiNorm(ilce) : "";

    // Her profil için ayrı sorgu; sonuçları topla.
    const collected: (PlaceResult & { profile: string })[] = [];
    const seen = new Set<string>();

    for (const profile of profiles) {
      const keyword = PROFILE_QUERIES[profile] || profile;
      const query = `${keyword} ${region}`;
      const places = await searchPlaces(query, 40);
      for (const p of places) {
        const key = p.id || normName(p.name);
        if (seen.has(key)) continue;
        if (excludeIds.has(p.id)) continue;
        if (excludeNames.has(normName(p.name))) continue;
        // Adreste seçilen ilçe geçmiyorsa atla (komşu ilçe sızıntısını önler).
        if (hasIlce && !asciiNorm(p.address).includes(ilceNorm)) continue;
        seen.add(key);
        collected.push({ ...p, profile });
      }
    }

    const leads: Lead[] = collected.map((c) => ({
      ...c,
      sector: c.category || c.profile,
    }));

    return NextResponse.json({
      leads,
      count: leads.length,
      region,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Müşteri taraması sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    profiles: Object.keys(PROFILE_QUERIES),
    groups: PROFILE_GROUPS.map((g) => ({
      group: g.group,
      profiles: Object.keys(g.profiles),
    })),
  });
}
