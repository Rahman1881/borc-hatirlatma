// Hazır belge türleri. Listede olmayan belge formda "Diğer" seçilerek elle yazılır.
// Bu dosya tarayıcıda da kullanılır; sunucuya özel bir şey içe aktarmaz.

export type BelgeKapsam = "sirket" | "arac" | "personel";

export const KAPSAM_AD: Record<BelgeKapsam, string> = {
  sirket: "Şirket",
  arac: "Araç",
  personel: "Personel",
};

export const HAZIR_TURLER: Record<BelgeKapsam, { grup: string; turler: string[] }[]> = {
  sirket: [
    {
      grup: "Lisans ve ruhsat",
      turler: [
        "EPDK Bayilik Lisansı",
        "İşyeri Açma ve Çalışma Ruhsatı",
        "Bayilik Sözleşmesi",
        "Çevre İzin ve Lisans Belgesi",
        "Tehlikeli Madde Faaliyet Belgesi (TMFB)",
        "TMGD Hizmet Sözleşmesi",
        "Kapasite Raporu",
      ],
    },
    {
      grup: "Resmî evrak",
      turler: [
        "Vergi Levhası",
        "Ticaret Sicil Gazetesi",
        "Faaliyet Belgesi (Oda Sicil Kaydı)",
        "İmza Sirküleri",
        "Vekâletname",
        "Marka Tescil Belgesi",
        "KEP Adresi",
        "E-İmza / Mali Mühür",
      ],
    },
    {
      grup: "Sigorta",
      turler: [
        "İşyeri Sigortası",
        "Yangın Sigortası",
        "Tehlikeli Maddeler Zorunlu Sorumluluk Sigortası",
        "İşveren Mali Sorumluluk Sigortası",
        "Üçüncü Şahıs Mali Sorumluluk Sigortası",
      ],
    },
    {
      grup: "Kontrol ve ölçüm",
      turler: [
        "Pompa Ölçü Ayar Muayenesi (Damga)",
        "Tank Sızdırmazlık Raporu",
        "Elektrik Tesisatı Periyodik Kontrolü",
        "Topraklama Ölçüm Raporu",
        "Paratoner Periyodik Kontrolü",
        "Yangın Tüpü Kontrolü",
        "Yangın Tesisatı Periyodik Kontrolü",
        "Kompresör / Basınçlı Kap Periyodik Kontrolü",
        "Jeneratör Bakımı",
        "Yazar Kasa / ÖKC Bakımı",
        "Risk Değerlendirme Raporu",
        "Acil Durum Eylem Planı",
        "İSG Hizmet Sözleşmesi (OSGB)",
      ],
    },
    {
      grup: "Sözleşme",
      turler: ["Kira Sözleşmesi", "Tedarik Sözleşmesi", "Bakım Sözleşmesi", "Banka Teminat Mektubu"],
    },
  ],
  arac: [
    {
      grup: "Zorunlu",
      turler: [
        "Ruhsat",
        "Zorunlu Trafik Sigortası",
        "Araç Muayenesi",
        "Egzoz Emisyon Ölçümü",
        "Motorlu Taşıtlar Vergisi",
      ],
    },
    {
      grup: "Sigorta",
      turler: ["Kasko", "Tehlikeli Maddeler Zorunlu Sorumluluk Sigortası", "Koltuk Ferdi Kaza Sigortası"],
    },
    {
      grup: "Taşımacılık",
      turler: [
        "ADR Uygunluk Belgesi (Taşıt)",
        "Tank Periyodik Muayenesi",
        "Tank Kalibrasyon Cetveli",
        "Takograf Muayenesi",
        "Yetki Belgesi (K/C)",
        "Taşıt Kartı",
        "UTTS Montaj Belgesi",
      ],
    },
    {
      grup: "Diğer",
      turler: ["Yangın Tüpü Kontrolü", "Periyodik Bakım", "HGS / OGS", "Araç Kiralama Sözleşmesi"],
    },
  ],
  personel: [
    {
      grup: "Özlük",
      turler: [
        "Kimlik Fotokopisi",
        "İş Sözleşmesi",
        "SGK İşe Giriş Bildirgesi",
        "İkametgâh Belgesi",
        "Adli Sicil Kaydı",
        "Diploma",
        "Askerlik Durum Belgesi",
        "Nüfus Kayıt Örneği",
        "Banka Hesap Bilgisi",
        "KVKK Aydınlatma ve Açık Rıza",
        "Zimmet Tutanağı",
      ],
    },
    {
      grup: "Sağlık ve İSG",
      turler: [
        "İşe Giriş / Periyodik Sağlık Raporu",
        "İSG Eğitim Belgesi",
        "Mesleki Yeterlilik Belgesi (MYK)",
        "Yangın Eğitimi Belgesi",
        "İlk Yardım Sertifikası",
        "Hijyen Eğitimi Belgesi",
      ],
    },
    {
      grup: "Sürücü",
      turler: [
        "Sürücü Belgesi (Ehliyet)",
        "SRC Belgesi",
        "SRC 5 (ADR Sürücü Eğitim Sertifikası)",
        "Psikoteknik Belgesi",
        "Sürücü Kartı (Takograf)",
      ],
    },
  ],
};

export const HATIRLAT_SECENEK = [90, 60, 30, 15, 7, 3, 1, 0];
export const HATIRLAT_VARSAYILAN = "30,15,7,1";

export function hazirMi(kapsam: BelgeKapsam, tur: string): boolean {
  return HAZIR_TURLER[kapsam].some((g) => g.turler.includes(tur));
}

// Bitişe kalan gün (bugün biterse 0, geçtiyse eksi). Tarihler YYYY-MM-DD.
export function kalanGun(bitis: string, bugun: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(bitis) - ms(bugun)) / 86400000);
}

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export function tarihYaz(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${AYLAR[m - 1]} ${y}`;
}
