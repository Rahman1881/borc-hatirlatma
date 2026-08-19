// Şahıs (gerçek kişi) alıcıların ad/soyad ayrıştırması.
//
// Kaynak sorunu: UTTS/Excel'den gelen alıcı ünvanı çoğu zaman tek parça bir metin
// ("MEHMET YILMAZ") ya da ticari unvanla birleşik ("MEHMET YILMAZ - YILMAZ PETROL",
// "MEHMET YILMAZ AKARYAKIT") geliyor. E-fatura XML'i ise gerçek kişilerde
// FirstName/FamilyName alanlarını ayrı ayrı istiyor.
//
// En güvenilir kaynak GİB e-fatura sicilindeki resmi unvandır (Uyumsoft
// GetUserAliasses -> Definition.Title). Bu modül o unvandaki ticari ekleri ayıklayıp
// geriye kalan son kelimeyi soyad kabul eder.

// Ticari unvanlarda geçen, kişi adının parçası olmayan kelimeler. Ünvanın SONUNDAN
// başlayarak ayıklanır; baştaki ad/soyad korunur.
const COMPANY_WORDS = new Set([
  // şirket türleri
  "LTD", "LIMITED", "LİMİTED", "STI", "ŞTI", "ŞTİ", "SIRKETI", "ŞIRKETI", "ŞİRKETİ",
  "AS", "AŞ", "ANONIM", "ANONİM", "KOLLEKTIF", "KOLLEKTİF", "KOMANDIT", "KOMANDİT",
  "ORTAKLARI", "ORTAKLIGI", "ORTAKLIĞI", "ORT", "VE",
  // sektör / faaliyet
  "AKARYAKIT", "PETROL", "PETROLCULUK", "PETROLCÜLÜK", "NAKLIYAT", "NAKLİYAT",
  "NAKLIYE", "NAKLİYE", "TASIMACILIK", "TAŞIMACILIK", "LOJISTIK", "LOJİSTİK",
  "TICARET", "TİCARET", "TIC", "TİC", "TICARETI", "TİCARETİ",
  "SANAYI", "SANAYİ", "SAN", "SANAYII", "SANAYİİ",
  "INSAAT", "İNŞAAT", "INS", "İNŞ", "TAAHHUT", "TAAHHÜT",
  "GIDA", "OTOMOTIV", "OTOMOTİV", "OTO", "YEDEK", "PARCA", "PARÇA",
  "TURIZM", "TURİZM", "TARIM", "HAYVANCILIK", "TEKSTIL", "TEKSTİL",
  "PAZARLAMA", "ITHALAT", "İTHALAT", "IHRACAT", "İHRACAT", "DIS", "DIŞ",
  "MUHENDISLIK", "MÜHENDİSLİK", "MUH", "MÜH", "MIMARLIK", "MİMARLIK",
  "ELEKTRIK", "ELEKTRİK", "ELEKTRONIK", "ELEKTRONİK", "MAKINA", "MAKİNA",
  "MAKINE", "MAKİNE", "MADENCILIK", "MADENCİLİK", "ORMAN", "URUNLERI", "ÜRÜNLERİ",
  "HIZMETLERI", "HİZMETLERİ", "HIZMET", "HİZMET", "SERVIS", "SERVİS",
  "ISLETMECILIGI", "İŞLETMECİLİĞİ", "ISLETMESI", "İŞLETMESİ", "ISLETME", "İŞLETME",
  "MARKET", "MARKETCILIK", "MARKETÇİLİK", "KIRTASIYE", "KIRTASİYE", "MOBILYA",
  "MOBİLYA", "PLASTIK", "PLASTİK",
  "AMBALAJ", "KIMYA", "KİMYA", "ENERJI", "ENERJİ", "ILETISIM", "İLETİŞİM",
  "BILISIM", "BİLİŞİM", "YAZILIM", "REKLAM", "ORGANIZASYON", "ORGANİZASYON",
  "TEMIZLIK", "TEMİZLİK", "GUVENLIK", "GÜVENLİK", "SAGLIK", "SAĞLIK",
  "EGITIM", "EĞİTİM", "EMLAK", "GAYRIMENKUL", "GAYRİMENKUL", "KUYUMCULUK",
]);

// Bilerek listeye ALINMAYAN kelimeler: DEMİR, ÇELİK, ŞAHİN, AYDIN, ÖZ, KAYA gibi
// hem sektör hem de çok yaygın soyad olan sözcükler. Bunları ayıklarsak
// "FATMA NUR ÇELİK OTOMOTİV" gibi ünvanlarda gerçek soyadı silmiş oluruz.

function normalizeWord(word: string) {
  return word.replace(/[.,;:]/g, "").toLocaleUpperCase("tr");
}

function isCompanyWord(word: string) {
  return COMPANY_WORDS.has(normalizeWord(word));
}

export interface PersonName {
  name: string;
  surname: string;
}

// Tek parça bir kişi ünvanını ad + soyad olarak ayırır.
// "MEHMET YILMAZ"                -> { MEHMET, YILMAZ }
// "AHMET CAN ÖZTÜRK"             -> { AHMET CAN, ÖZTÜRK }
// "MEHMET YILMAZ - YILMAZ PETROL"-> { MEHMET, YILMAZ }
// "MEHMET YILMAZ AKARYAKIT"      -> { MEHMET, YILMAZ }
// "MEHMET"                       -> { MEHMET, "" }
export function splitPersonName(rawTitle: string): PersonName {
  let text = (rawTitle || "").replace(/[\s\u00A0]+/g, " ").trim();
  if (!text) return { name: "", surname: "" };

  // "AD SOYAD - TİCARİ UNVAN" veya "AD SOYAD (TİCARİ UNVAN)": ayırıcıdan
  // öncesi kişi adıdır.
  const separator = text.match(/\s[-–—/|]\s|\s*[([]/);
  if (separator?.index !== undefined && separator.index > 0) {
    text = text.slice(0, separator.index).trim();
  }

  const parts = text.split(" ").filter(Boolean);

  // Sondaki ticari kelimeleri ayıkla. Geriye tek kelime kalsa bile ayıklarız:
  // "YILMAZ PETROL" için soyadı "PETROL" uydurmaktansa soyadı boş bırakıp kaydı
  // "soyadı eksik" uyarısıyla elle kontrole düşürmek daha doğru.
  while (parts.length > 1 && isCompanyWord(parts[parts.length - 1])) {
    parts.pop();
  }

  if (parts.length === 0) return { name: "", surname: "" };
  if (parts.length === 1) return { name: parts[0], surname: "" };

  return {
    name: parts.slice(0, -1).join(" "),
    surname: parts[parts.length - 1],
  };
}

// Bir ünvanın gerçekten ad/soyad olarak ayrılabildiğini (soyadı çıktığını) söyler.
export function hasSurname(rawTitle: string): boolean {
  return Boolean(splitPersonName(rawTitle).surname);
}
