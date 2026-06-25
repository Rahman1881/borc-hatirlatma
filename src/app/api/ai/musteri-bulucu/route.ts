import { NextRequest, NextResponse } from "next/server";
import { searchPlaces, isPlacesConfigured, type PlaceResult } from "@/lib/places";
import { askGeminiJson, isGeminiConfigured } from "@/lib/gemini";

export const maxDuration = 60;

// İşletme profilleri gruplara ayrılmış halde. Her profil -> Google Places metin sorgusu.
const PROFILE_GROUPS: { group: string; profiles: Record<string, string> }[] = [
  {
    group: "En Çok Kullanılanlar",
    profiles: {
      "Beyaz Eşya Yetkili Servisleri": "beyaz eşya yetkili servisi",
      "Doğalgaz Teknik Servisleri": "doğalgaz kombi servisi",
      "Ekmek Fırınları": "ekmek fırını",
      "Elektrik ve Su Tesisatçıları": "su elektrik tesisatçısı",
      "Güneş Enerji Sistemleri": "güneş enerjisi sistemleri firması",
      "Halı Yıkamacıları": "halı yıkama fabrikası",
      Haritacılar: "harita mühendislik bürosu",
      "İlaçlama Şirketleri": "ilaçlama firması",
      Kargocular: "kargo şubesi",
      "Kömür Dağıtıcıları": "kömür bayi satış",
      "Mermerci ve Doğal Taşçılar": "mermer doğaltaş firması",
      Pazarcılar: "halk pazarı",
      "Sürücü Kursları": "sürücü kursu",
      "Toptan Gıdacılar": "toptan gıda deposu",
      "Yapı Denetimciler": "yapı denetim firması",
    },
  },
  {
    group: "Nakliye, Lojistik & Filo",
    profiles: {
      "Nakliye & Lojistik": "nakliye lojistik firması",
      "Kargo & Dağıtım": "kargo şubesi dağıtım",
      "Servis Taşımacılığı": "personel servis taşımacılığı",
      "Otobüs & Turizm Taşıma": "turizm seyahat otobüs firması",
      "Oto Kiralama / Filo": "oto kiralama filo",
      "Taksi & Transfer": "taksi durağı transfer",
      "Tır & Ağır Vasıta": "tır garajı uluslararası nakliyat",
      "Evden Eve Nakliyat": "evden eve nakliyat",
    },
  },
  {
    group: "İnşaat & Sanayi",
    profiles: {
      "İnşaat & Hafriyat": "inşaat hafriyat firması",
      "Beton Santrali": "hazır beton santrali",
      "Fabrika / Üretim": "fabrika sanayi üretim",
      "Madencilik & Ocak": "maden ocağı taş ocağı",
      "Demir-Çelik & Metal": "demir çelik metal sanayi",
      "Makine & İmalat": "makine imalat sanayi",
      "Geri Dönüşüm & Hurda": "geri dönüşüm tesisi hurda",
      "Asfalt & Yol Yapım": "asfalt yol yapım firması",
    },
  },
  {
    group: "Tarım & Hayvancılık",
    profiles: {
      "Tarım / Traktör": "tarım kooperatifi traktör",
      "Hayvancılık & Çiftlik": "hayvan çiftliği besi",
      "Sera & Bahçecilik": "sera bahçe fidan",
      "Zirai İlaç & Gübre": "zirai ilaç gübre bayi",
      "Yem & Un Fabrikası": "yem fabrikası un değirmeni",
    },
  },
  {
    group: "Gıda & Yeme-İçme",
    profiles: {
      "Gıda Dağıtım / Soğuk Zincir": "gıda dağıtım deposu",
      "Toptan Gıda": "toptan gıda satışı",
      "Market & Süpermarket": "market süpermarket",
      "Restoran & Lokanta": "restoran lokanta",
      "Cafe & Fırın": "cafe fırın pastane",
      "Et & Tavuk Ürünleri": "et tavuk entegre tesisi",
    },
  },
  {
    group: "Otomotiv",
    profiles: {
      "Oto Servis & Tamir": "oto servis tamir",
      "Oto Galeri": "oto galeri ikinci el araç",
      "Lastik & Jant": "lastikçi oto lastik",
      "Yedek Parça": "oto yedek parça",
      "Oto Yıkama": "oto yıkama",
      "Akü & Egzoz": "akü egzoz servisi",
    },
  },
  {
    group: "Mağaza & Perakende",
    profiles: {
      Mobilya: "mobilya mağazası",
      "Beyaz Eşya & Elektronik": "beyaz eşya elektronik mağaza",
      "Yapı Market & Hırdavat": "yapı market hırdavat",
      "Tekstil & Giyim": "tekstil giyim mağazası",
      "Nalbur & İnşaat Malzeme": "nalbur inşaat malzemeleri",
      "AVM & Alışveriş Merkezi": "alışveriş merkezi avm",
    },
  },
  {
    group: "Turizm & Konaklama",
    profiles: {
      "Otel & Konaklama": "otel konaklama",
      "Tatil Köyü & Resort": "tatil köyü resort",
      "Seyahat Acentesi": "seyahat acentesi",
      "Düğün & Organizasyon": "düğün salonu organizasyon",
    },
  },
  {
    group: "Kamu & Kurumsal",
    profiles: {
      "Belediye & Kamu": "belediye kamu kurumu",
      "Okul & Üniversite": "okul üniversite",
      "Hastane & Sağlık": "hastane sağlık merkezi",
      "Organize Sanayi (OSB)": "organize sanayi bölgesi",
      "İş Merkezi & Plaza": "iş merkezi plaza",
    },
  },
  {
    group: "Hizmet & Diğer",
    profiles: {
      "Akaryakıt & Petrol": "akaryakıt istasyonu petrol",
      "Temizlik Firması": "temizlik firması",
      "Güvenlik Firması": "güvenlik şirketi",
      "Soğuk Hava Deposu": "soğuk hava deposu",
      "Depo & Antrepo": "depo antrepo lojistik merkezi",
    },
  },
];

// Hızlı arama için düz profil -> sorgu eşlemesi.
const PROFILE_QUERIES: Record<string, string> = Object.fromEntries(
  PROFILE_GROUPS.flatMap((g) => Object.entries(g.profiles))
);

export type Lead = PlaceResult & {
  profile: string;
  potential: "Yüksek" | "Orta" | "Düşük";
  sector: string;
  reason: string;
};

type ScoreItem = {
  id: string;
  potential: "Yüksek" | "Orta" | "Düşük";
  sector: string;
  reason: string;
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

async function scoreLeads(
  raw: (PlaceResult & { profile: string })[]
): Promise<Map<string, ScoreItem>> {
  const result = new Map<string, ScoreItem>();
  if (!isGeminiConfigured() || raw.length === 0) return result;

  const systemPrompt = `Sen bir Petrol Ofisi akaryakıt istasyonunun kurumsal satış uzmanısın. Sana bir işletme listesi verilecek. Her işletmeyi, istasyona POTANSİYEL AKARYAKIT/FİLO MÜŞTERİSİ olma açısından değerlendir.

Kurallar:
- "potential": yakıt tüketimi yüksek olabilecek (çok araçlı/filolu, nakliye, inşaat, dağıtım, otobüs vb.) işletmeler "Yüksek"; orta ölçekli "Orta"; yakıt ihtiyacı düşük olanlar "Düşük".
- "sector": işletmenin kısa Türkçe sektör etiketi.
- "reason": neden iyi/zayıf bir akaryakıt müşterisi olabileceğine dair TEK kısa cümle (Türkçe).
- SADECE verilen işletmeler için, verilen id ile cevap ver. Bilgi uydurma.

Cevabı şu JSON şemasıyla ver: {"items":[{"id":"...","potential":"Yüksek|Orta|Düşük","sector":"...","reason":"..."}]}`;

  const compact = raw.map((r) => ({
    id: r.id,
    isim: r.name,
    kategori: r.category || r.profile,
    adres: r.address,
  }));

  try {
    const data = await askGeminiJson<{ items: ScoreItem[] }>(
      systemPrompt,
      JSON.stringify({ isletmeler: compact })
    );
    for (const it of data.items || []) {
      if (it && it.id) result.set(it.id, it);
    }
  } catch {
    // puanlama başarısız olursa ham veriyle devam (best-effort)
  }
  return result;
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

    // Gemini ile potansiyel puanlama (best-effort).
    const scores = await scoreLeads(collected);

    const leads: Lead[] = collected.map((c) => {
      const s = scores.get(c.id);
      return {
        ...c,
        potential: s?.potential || "Orta",
        sector: s?.sector || c.category || c.profile,
        reason: s?.reason || "",
      };
    });

    // Yüksek potansiyel önce gelsin.
    const order = { Yüksek: 0, Orta: 1, Düşük: 2 } as const;
    leads.sort((a, b) => order[a.potential] - order[b.potential]);

    return NextResponse.json({
      leads,
      count: leads.length,
      region,
      scored: scores.size > 0,
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
