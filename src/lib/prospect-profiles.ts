// Müşteri Bulucu işletme profilleri: her profil -> Google Places metin sorgusu.
// Hem anlık tarama (/api/ai/musteri-bulucu) hem haftalık "Yeni İşletmeler" takibi kullanır.

// İşletme profilleri gruplara ayrılmış halde. Her profil -> Google Places metin sorgusu.
export const PROFILE_GROUPS: { group: string; profiles: Record<string, string> }[] = [
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
export const PROFILE_QUERIES: Record<string, string> = Object.fromEntries(
  PROFILE_GROUPS.flatMap((g) => Object.entries(g.profiles))
);
