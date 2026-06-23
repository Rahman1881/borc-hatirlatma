import getDb from "@/lib/db";
import { fetchBrandPrices } from "@/lib/brand-prices";

// Akaryakıt fiyatları: günlük, marka x il bazında. DB'de tarihli önbellek tutulur,
// böylece her gün yalnızca bir kez kaynaktan çekilir (otomatik tazeleme).

export type FuelType = "benzin" | "motorin" | "lpg";

export type PriceRow = {
  tarih: string; // YYYY-MM-DD
  il: string;
  plaka: number;
  marka: string;
  yakit: FuelType;
  fiyat: number;
  kaynak: "marka" | "manuel";
};

// Sık kullanılan iller -> plaka (trafik) kodu. Gerekince genişletilir.
export const IL_PLAKA: Record<string, number> = {
  Sakarya: 54,
  Kocaeli: 41,
  İstanbul: 34,
  Bursa: 16,
  Yalova: 77,
  Düzce: 81,
  Bolu: 14,
};

export function plakaForIl(il: string): number | null {
  return IL_PLAKA[il] ?? null;
}

export function todayStr(): string {
  // Yerel (TR) tarih, YYYY-MM-DD
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

export function getCachedPrices(plaka: number, tarih: string): PriceRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT tarih, il, plaka, marka, yakit, fiyat, kaynak FROM fuel_prices WHERE plaka = ? AND tarih = ? ORDER BY marka, yakit"
    )
    .all(plaka, tarih) as PriceRow[];
  return rows;
}

// O gün için kaydın en son ne zaman güncellendiğini (yerel tarih-saat) döner.
export function getLastUpdated(plaka: number, tarih: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT MAX(updated_at) AS u FROM fuel_prices WHERE plaka = ? AND tarih = ?"
    )
    .get(plaka, tarih) as { u: string | null } | undefined;
  return row?.u ?? null;
}

export function savePrices(rows: PriceRow[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO fuel_prices (tarih, il, plaka, marka, yakit, fiyat, kaynak, updated_at)
     VALUES (@tarih, @il, @plaka, @marka, @yakit, @fiyat, @kaynak, datetime('now','localtime'))
     ON CONFLICT(tarih, plaka, marka, yakit)
     DO UPDATE SET fiyat = excluded.fiyat, kaynak = excluded.kaynak, il = excluded.il,
                   updated_at = datetime('now','localtime')`
  );
  const tx = db.transaction((items: PriceRow[]) => {
    for (const r of items) stmt.run(r);
  });
  tx(rows);
}

// Bugünün marka (otomatik) fiyat kayıtlarını siler — manuel yeniden çekim için.
export function clearTodayBrandPrices(plaka: number, tarih: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM fuel_prices WHERE plaka = ? AND tarih = ? AND kaynak = 'marka'"
  ).run(plaka, tarih);
}

// Manuel tetikleme: önbelleği yok say, kaynaktan yeniden çek ve kaydet.
export async function refreshDailyPrices(
  plaka: number,
  il: string,
  ilce: string
): Promise<{
  rows: PriceRow[];
  tarih: string;
  source: "marka" | "none";
  updatedAt: string | null;
}> {
  const tarih = todayStr();
  clearTodayBrandPrices(plaka, tarih);
  try {
    const fetched = await fetchBrandPrices(plaka, il, ilce, tarih);
    if (fetched.length > 0) {
      savePrices(fetched);
      return {
        rows: getCachedPrices(plaka, tarih),
        tarih,
        source: "marka",
        updatedAt: getLastUpdated(plaka, tarih),
      };
    }
  } catch (err) {
    console.error("[fuel-prices] refreshDailyPrices çekim hatası:", err);
  }
  return { rows: getCachedPrices(plaka, tarih), tarih, source: "none", updatedAt: getLastUpdated(plaka, tarih) };
}

// O günün fiyatları önbellekte yoksa marka sitelerinden çekip kaydeder (günlük otomatik).
// Marka dağıtıcı siteleri captcha'sız ve resmi olduğundan kaynak budur. Manuel girilen
// fiyatlar, o gün marka verisi gelene kadar korunur.
export async function ensureDailyPrices(
  plaka: number,
  il: string,
  ilce: string
): Promise<{
  rows: PriceRow[];
  tarih: string;
  source: "cache" | "marka" | "none";
  updatedAt: string | null;
}> {
  const tarih = todayStr();
  const cached = getCachedPrices(plaka, tarih);
  if (cached.length > 0)
    return { rows: cached, tarih, source: "cache", updatedAt: getLastUpdated(plaka, tarih) };

  try {
    const fetched = await fetchBrandPrices(plaka, il, ilce, tarih);
    if (fetched.length > 0) {
      savePrices(fetched);
      return {
        rows: fetched,
        tarih,
        source: "marka",
        updatedAt: getLastUpdated(plaka, tarih),
      };
    }
  } catch (err) {
    console.error("[fuel-prices] ensureDailyPrices çekim hatası:", err);
  }

  return { rows: [], tarih, source: "none", updatedAt: null };
}
