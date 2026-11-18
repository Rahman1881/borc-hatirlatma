import getDb from "@/lib/db";

// UTTS fatura taslaklarında "gönderen" (satıcı) olarak yazılan şirket bilgileri.
// Eskiden unvan yerine Uyumsoft web servis kullanıcı adı gidiyordu; taslakta gönderen
// "Ozciftci_WebServis2" görünüyordu. Bilgiler UTTS Ayarları'ndan değiştirilebilir;
// hiç kaydedilmemişse aşağıdaki varsayılanlar (şirketin kestiği e-faturadaki başlık) kullanılır.

export type SellerInfo = {
  title: string;
  address: string;
  district: string;
  city: string;
  taxOffice: string;
  phone: string;
  email: string;
};

export const SELLER_DEFAULTS: SellerInfo = {
  title: "ÖZÇİFTÇİ ÇARK PETROL SAN.VE TİC.LTD.ŞTİ",
  address: "CUMHURİYET MAH. YAZLIK CAD. No:8",
  district: "ADAPAZARI",
  city: "SAKARYA",
  taxOffice: "A.F.CEBESOY",
  phone: "5332599494",
  email: "diyarbekirli54@poasbayi.com.tr",
};

const KEYS: Record<keyof SellerInfo, string> = {
  title: "uyumsoft_seller_title",
  address: "uyumsoft_seller_address",
  district: "uyumsoft_seller_district",
  city: "uyumsoft_seller_city",
  taxOffice: "uyumsoft_seller_tax_office",
  phone: "uyumsoft_seller_phone",
  email: "uyumsoft_seller_email",
};

const FIELDS = Object.keys(KEYS) as (keyof SellerInfo)[];

export function getSellerInfo(): SellerInfo {
  const names = Object.values(KEYS);
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key IN (${names.map(() => "?").join(",")})`)
    .all(...names) as { key: string; value: string }[];
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  const info = { ...SELLER_DEFAULTS };
  // Kaydedilmiş alan boş bile olsa geçerlidir (ör. telefon bilerek silinmiş olabilir);
  // unvan ise hiçbir zaman boş kalmaz.
  for (const f of FIELDS) {
    const v = saved.get(KEYS[f]);
    if (v !== undefined) info[f] = v;
  }
  if (!info.title.trim()) info.title = SELLER_DEFAULTS.title;
  return info;
}

export function saveSellerInfo(input: Record<string, unknown>): SellerInfo {
  const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const next: SellerInfo = {
    title: clean(input.title, 200),
    address: clean(input.address, 300),
    district: clean(input.district, 60),
    city: clean(input.city, 60),
    taxOffice: clean(input.taxOffice, 80),
    phone: clean(input.phone, 30),
    email: clean(input.email, 120),
  };
  if (next.title.length < 3) throw new Error("Şirket unvanı boş bırakılamaz.");
  const upsert = getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  for (const f of FIELDS) upsert.run(KEYS[f], next[f]);
  return getSellerInfo();
}
