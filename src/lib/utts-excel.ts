// UTTS montaj kayıtlarını (installation-progresses) Excel'e aktarır. Tarayıcıda çalışır;
// xlsx kütüphanesi yalnızca "Excel'e Aktar"a basılınca yüklenir.
//
// UTTS'nin döndürdüğü bütün alanlar sütun olur. Bilinen alanlar Türkçe başlıkla ve
// anlamlı sırayla gelir; ileride UTTS yeni bir alan eklerse o da kendi adıyla en sona eklenir.

type Row = Record<string, unknown>;
type Tur = "metin" | "tarih" | "tarihSaat" | "para" | "sayi" | "evetHayir";

const SUTUNLAR: { alan: string; baslik: string; tur?: Tur; genislik?: number }[] = [
  { alan: "installationCode", baslik: "Montaj Kodu", genislik: 14 },
  { alan: "licensePlate", baslik: "Plaka", genislik: 11 },
  { alan: "vehicleOrderInstallationStatus", baslik: "Durum", genislik: 24 },
  { alan: "activationDateString", baslik: "Aktivasyon Tarihi", tur: "tarih", genislik: 12 },
  { alan: "activationHourString", baslik: "Aktivasyon Saati", genislik: 9 },
  { alan: "installmentDateString", baslik: "Montaj Tarihi", tur: "tarih", genislik: 12 },
  { alan: "installmentHourString", baslik: "Montaj Saati", genislik: 9 },
  { alan: "vehicleCompanyName", baslik: "Araç Firması", genislik: 28 },
  { alan: "vehicleCompanyPhoneNumber", baslik: "Firma Telefonu", genislik: 14 },
  { alan: "driverPhoneNumber", baslik: "Sürücü Telefonu", genislik: 14 },
  { alan: "driverEmail", baslik: "Sürücü E-posta", genislik: 28 },
  { alan: "companyName", baslik: "Fatura Ünvanı", genislik: 36 },
  { alan: "companyTypeStr", baslik: "Firma Tipi", genislik: 14 },
  { alan: "taxInfoNumber", baslik: "Vergi / TC No", genislik: 13 },
  { alan: "taxInfoOffice", baslik: "Vergi Dairesi", genislik: 16 },
  { alan: "isTaxInfoVerified", baslik: "Vergi Bilgisi Doğrulandı", tur: "evetHayir", genislik: 10 },
  { alan: "identificationNumberForInvoice", baslik: "Fatura Kimlik No", genislik: 13 },
  { alan: "address", baslik: "Adres", genislik: 40 },
  { alan: "district", baslik: "İlçe", genislik: 14 },
  { alan: "city", baslik: "İl", genislik: 12 },
  { alan: "productName", baslik: "Ürün", genislik: 16 },
  { alan: "salePriceString", baslik: "Tutar (KDV Dahil)", tur: "para", genislik: 13 },
  { alan: "netSalePriceString", baslik: "Tutar (KDV Hariç)", tur: "para", genislik: 13 },
  { alan: "technicianFullName", baslik: "Teknisyen", genislik: 20 },
  { alan: "ttbServiceName", baslik: "Servis", genislik: 24 },
  { alan: "ttbServiceReferenceNumber", baslik: "Servis Referans No", genislik: 12 },
  { alan: "firstActivationDate", baslik: "İlk Aktivasyon", tur: "tarihSaat", genislik: 16 },
  { alan: "lastActivationDate", baslik: "Son Aktivasyon", tur: "tarihSaat", genislik: 16 },
  { alan: "totalActivationCount", baslik: "Aktivasyon Sayısı", tur: "sayi", genislik: 9 },
  { alan: "daysBetweenActivations", baslik: "Aktivasyonlar Arası Gün", genislik: 10 },
  { alan: "hasReceiptInfo", baslik: "Fiş Bilgisi Var", tur: "evetHayir", genislik: 9 },
  { alan: "hasDifferentCompanyInstallation", baslik: "Farklı Firma Montajı", genislik: 10 },
  { alan: "vehicleOrderInstallationStatusId", baslik: "Durum Kodu", genislik: 8 },
  { alan: "lastModified", baslik: "Son Değişiklik", tur: "tarihSaat", genislik: 16 },
  { alan: "vehicleOrderInstallationId", baslik: "UTTS Kayıt No", genislik: 38 },
];

function bos(v: unknown) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// "25.11.2026" → yerel tarih (Excel'de gün olarak görünür, sıralanabilir).
function gunTarihi(v: unknown): Date | null {
  const m = String(v).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/) || String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [g, a, y] = m[1].length === 4 ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]];
  const d = new Date(Number(y), Number(a) - 1, Number(g));
  return Number.isNaN(d.getTime()) ? null : d;
}

// "2026-11-25T21:01:55.15+03:00" → Türkiye saatiyle tarih-saat. Excel saat dilimi tutmaz;
// tarayıcının saat dilimine bakmadan Türkiye saatini (UTC+3) yazarız.
function tarihSaat(v: unknown): Date | null {
  const t = Date.parse(String(v));
  if (!Number.isFinite(t)) return null;
  const tr = new Date(t + 3 * 3600 * 1000);
  return new Date(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate(), tr.getUTCHours(), tr.getUTCMinutes(), tr.getUTCSeconds());
}

// "2.724,00 TL" → 2724
function para(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = String(v).replace(/TL/gi, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function hucre(v: unknown, tur: Tur | undefined): unknown {
  if (bos(v)) return "";
  switch (tur) {
    case "tarih":
      return gunTarihi(v) ?? String(v);
    case "tarihSaat":
      return tarihSaat(v) ?? String(v);
    case "para":
      return para(v) ?? String(v);
    case "sayi":
      return typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : String(v);
    case "evetHayir":
      return v === true || v === "true" ? "Evet" : v === false || v === "false" ? "Hayır" : String(v);
    default:
      // Telefon, vergi no gibi alanlar metin kalır (baştaki 0 kaybolmasın).
      return typeof v === "object" ? JSON.stringify(v) : String(v).trim();
  }
}

const FORMAT: Partial<Record<Tur, string>> = {
  tarih: "dd.mm.yyyy",
  tarihSaat: "dd.mm.yyyy hh:mm",
  para: "#,##0.00",
};

export async function exportUttsRowsToExcel(rows: Row[], dosyaAdi: string) {
  const XLSX = await import("xlsx");

  // Bilinen sütunlar + UTTS'nin döndürüp bizim tanımadığımız alanlar.
  const bilinen = new Set(SUTUNLAR.map((s) => s.alan));
  const ekAlanlar: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!bilinen.has(k) && !ekAlanlar.includes(k)) ekAlanlar.push(k);
  const sutunlar = [...SUTUNLAR, ...ekAlanlar.map((alan) => ({ alan, baslik: alan, tur: undefined as Tur | undefined, genislik: 16 }))];

  const aoa: unknown[][] = [sutunlar.map((s) => s.baslik)];
  for (const r of rows) aoa.push(sutunlar.map((s) => hucre(r[s.alan], s.tur)));

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  // Sayı biçimleri (tarih, para) ve metin hücreleri
  sutunlar.forEach((s, c) => {
    const fmt = s.tur ? FORMAT[s.tur] : undefined;
    for (let i = 1; i < aoa.length; i++) {
      const cell = ws[XLSX.utils.encode_cell({ r: i, c })];
      if (!cell) continue;
      if (fmt && (cell.t === "d" || cell.t === "n")) cell.z = fmt;
    }
  });
  ws["!cols"] = sutunlar.map((s) => ({ wch: s.genislik ?? 16 }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: sutunlar.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Montajlar");
  XLSX.writeFile(wb, dosyaAdi, { compression: true, cellDates: true });
}
