// Örnek (mock) veriler — gerçek entegrasyonlar (SiberPet, Uyumsoft) bağlanınca değişecek.

export const kpis = [
  {
    key: "fuel",
    label: "Günlük Yakıt Cirosu",
    value: "₺487.250",
    change: "+%8,4",
    positive: true,
    sub: "Dün: ₺449.500",
  },
  {
    key: "market",
    label: "Market Cirosu",
    value: "₺62.180",
    change: "+%3,1",
    positive: true,
    sub: "Dün: ₺60.300",
  },
  {
    key: "liters",
    label: "Satılan Yakıt",
    value: "14.920 L",
    change: "-%2,2",
    positive: false,
    sub: "Dün: 15.250 L",
  },
  {
    key: "customers",
    label: "Müşteri Sayısı",
    value: "1.284",
    change: "+%5,7",
    positive: true,
    sub: "Dün: 1.215",
  },
];

export const weeklySales = [
  { gun: "Pzt", motorin: 195, benzin: 92, lpg: 64, market: 48 },
  { gun: "Sal", motorin: 210, benzin: 88, lpg: 70, market: 52 },
  { gun: "Çar", motorin: 188, benzin: 95, lpg: 61, market: 49 },
  { gun: "Per", motorin: 232, benzin: 101, lpg: 73, market: 58 },
  { gun: "Cum", motorin: 268, benzin: 118, lpg: 80, market: 64 },
  { gun: "Cmt", motorin: 305, benzin: 134, lpg: 88, market: 71 },
  { gun: "Paz", motorin: 240, benzin: 109, lpg: 76, market: 55 },
];

export const fuelMix = [
  { name: "Motorin", value: 58, color: "#2563eb" },
  { name: "Benzin", value: 24, color: "#f97316" },
  { name: "LPG", value: 18, color: "#22c55e" },
];

export const alerts = [
  {
    title: "LPG satışı düşüşte",
    detail: "Son 3 günde LPG litresi %12 azaldı. Rakip fiyat kontrolü öneriliyor.",
    tone: "warning" as const,
    time: "10 dk önce",
  },
  {
    title: "Motorin tank seviyesi %22",
    detail: "Tank 2 kritik eşiğin altında. Tedarik planlaması gerekli.",
    tone: "negative" as const,
    time: "1 saat önce",
  },
  {
    title: "Hafta sonu hedefi aşıldı",
    detail: "Cumartesi yakıt cirosu haftalık ortalamanın %18 üzerinde.",
    tone: "positive" as const,
    time: "Dün",
  },
];

export const shifts = [
  { name: "Sabah (06-14)", ciro: "₺178.400", litre: "5.420 L", musteri: 486 },
  { name: "Akşam (14-22)", ciro: "₺214.900", litre: "6.310 L", musteri: 562 },
  { name: "Gece (22-06)", ciro: "₺93.950", litre: "3.190 L", musteri: 236 },
];

// Müşteri Bulucu örnek sonuçları
export type Lead = {
  name: string;
  type: "Kurumsal" | "Filo" | "Bireysel";
  sector: string;
  location: string;
  fleet: string;
  potential: "Yüksek" | "Orta" | "Düşük";
  phone: string;
};

export const leads: Lead[] = [
  {
    name: "Yıldız Lojistik A.Ş.",
    type: "Filo",
    sector: "Nakliye & Lojistik",
    location: "Kocaeli / Gebze",
    fleet: "42 araç",
    potential: "Yüksek",
    phone: "0262 *** ** **",
  },
  {
    name: "Marmara İnşaat Ltd.",
    type: "Kurumsal",
    sector: "İnşaat",
    location: "Kocaeli / İzmit",
    fleet: "18 iş makinesi",
    potential: "Yüksek",
    phone: "0262 *** ** **",
  },
  {
    name: "Ege Soğuk Zincir",
    type: "Filo",
    sector: "Gıda Dağıtım",
    location: "Kocaeli / Çayırova",
    fleet: "27 frigorifik",
    potential: "Orta",
    phone: "0262 *** ** **",
  },
  {
    name: "Akın Turizm Seyahat",
    type: "Filo",
    sector: "Yolcu Taşıma",
    location: "Kocaeli / Gebze",
    fleet: "12 otobüs",
    potential: "Orta",
    phone: "0262 *** ** **",
  },
  {
    name: "Demir Tarım Koop.",
    type: "Kurumsal",
    sector: "Tarım",
    location: "Kocaeli / Kandıra",
    fleet: "9 traktör",
    potential: "Düşük",
    phone: "0262 *** ** **",
  },
];

export type Tender = {
  title: string;
  org: string;
  location: string;
  deadline: string;
  amount: string;
  tag: string;
};

export const tenders: Tender[] = [
  {
    title: "Belediye Araç Filosu Akaryakıt Alımı",
    org: "Gebze Belediyesi",
    location: "Kocaeli",
    deadline: "18 Haz 2026",
    amount: "≈ ₺4.2M",
    tag: "Kamu İhalesi",
  },
  {
    title: "Okul Servisleri Yıllık Yakıt Tedariki",
    org: "İl Milli Eğitim Müd.",
    location: "Kocaeli",
    deadline: "25 Haz 2026",
    amount: "≈ ₺1.8M",
    tag: "Kamu İhalesi",
  },
  {
    title: "Şantiye Jeneratör Yakıt Anlaşması",
    org: "Marmara İnşaat Ltd.",
    location: "İzmit",
    deadline: "30 Haz 2026",
    amount: "≈ ₺950K",
    tag: "Özel Sektör",
  },
];

export const reportSchedules = [
  {
    title: "Günlük Kapanış Raporu",
    time: "Her gün 23:30",
    content: "Yakıt + market cirosu, vardiya özeti, anormallikler",
    active: true,
  },
  {
    title: "Sabah Brifingi",
    time: "Her gün 08:00",
    content: "Dünün özeti, bugünün hedefi, tank seviyeleri",
    active: true,
  },
  {
    title: "Haftalık Performans",
    time: "Pazartesi 09:00",
    content: "Haftalık trend, geçen haftayla karşılaştırma",
    active: false,
  },
  {
    title: "İhale & Müşteri Bülteni",
    time: "Çarşamba 10:00",
    content: "Yeni ihaleler ve potansiyel filo müşterileri",
    active: true,
  },
];
