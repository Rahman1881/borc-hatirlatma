import fs from "node:fs";
import path from "node:path";
import getDb from "@/lib/db";
import {
  getVrdDir,
  parseVrdXml,
  normalizeFuel,
  classifyCustomer,
  FUEL_LABELS,
  type FuelKind,
} from "@/lib/vrd-sales";

// ————————————————————————————————————————————————————————————————
// VRD → SQLite aktarım katmanı (Müşteri Analitiği modülünün veri temeli).
//
// Neden: Arşiv 2022'ye kadar gidiyor (~4000+ XML, ~800k satış). Her sayfa
// açılışında tüm dosyaları taramak dakikalar sürerdi. Bunun yerine dosyalar
// bir kez SQLite'a aktarılır; sonrasında sorgular indeksli tablodan anında döner.
//
// Artımlı senkron: her dosyanın (boyut + mtime) parmak izi `vrd_ingest_state`de
// tutulur. Değişmemiş dosya atlanır, sadece yeni/değişmiş vardiya dosyası okunur.
// İşlem idempotenttir — istediğin kadar çalıştırılabilir.
//
// İskonto tanımı: VRD'de indirim alanı YOK. Liste fiyatı = aynı vardiya (dosya)
// içinde o yakıt ürünü için görülen EN YÜKSEK FYT. İskonto = (liste − FYT) × LITRE.
// Bu "liste fiyatından vazgeçilen ciro"dur (maliyet bilinmediği için kâr kaybı değil).
// Liste fiyatı ham yakıt adına (ör. EuroDiesel vs Motorin ayrı) göre gruplanır.
// ————————————————————————————————————————————————————————————————

export function ensureVrdTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS vrd_ingest_state (
      file TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      rows INTEGER NOT NULL DEFAULT 0,
      ingested_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS vrd_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      iso TEXT NOT NULL,            -- YYYY-MM-DD
      saat TEXT,                    -- HH:MM:SS
      hour INTEGER,                 -- 0-23
      plaka TEXT,                   -- kimlik anahtarı: normalize edilmiş gerçek plaka (PLAKA2)
      plaka_display TEXT,           -- görüntüleme için ham plaka
      temsilci TEXT,                -- peşin satışta PLAKA alanı = pompacı adı
      kodu TEXT,
      musteri TEXT,                 -- istasyon | acik_hesap | filo | diger
      is_pesin INTEGER NOT NULL DEFAULT 0, -- 1 = bireysel peşin + geçerli plaka
      yakit TEXT,                   -- normalize (motorin|benzin|lpg|adblue|diger)
      yakit_raw TEXT,
      litre REAL NOT NULL DEFAULT 0,
      fiyat REAL NOT NULL DEFAULT 0,
      tutar REAL NOT NULL DEFAULT 0,
      liste_fiyat REAL NOT NULL DEFAULT 0,
      iskonto REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_vrd_sales_iso ON vrd_sales(iso);
    CREATE INDEX IF NOT EXISTS idx_vrd_sales_plaka ON vrd_sales(plaka);
    CREATE INDEX IF NOT EXISTS idx_vrd_sales_file ON vrd_sales(file);
    CREATE INDEX IF NOT EXISTS idx_vrd_sales_pesin ON vrd_sales(is_pesin);
  `);
}

// 'GG/AA/YYYY' -> 'YYYY-AA-GG'
function isoFromTarih(tarih: string): string {
  const m = (tarih || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

// Plakayı gruplama anahtarına indirger: boşluksuz, büyük harf, yalnız [0-9A-Z].
export function normalizePlate(raw: string): string {
  return (raw || "")
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/[^0-9A-Z]/g, "");
}

// Gerçek Türk plakası formatına benziyor mu? (34ABC123 → 2 il + harf + rakam)
export function isValidPlate(normalized: string): boolean {
  return /^\d{2}[A-Z]{1,4}\d{1,5}$/.test(normalized);
}

export type SyncProgress = {
  processed: number; // okunan (yeni/değişmiş) dosya
  skipped: number; // değişmemiş, atlanan dosya
  total: number; // klasördeki toplam xml
  inserted: number; // eklenen satış satırı
  file?: string; // en son işlenen dosya
};

export type SyncResult = SyncProgress & { done: true; durationMs: number };

// VRD klasörünü DB ile senkronlar. onProgress her dosya sonrası çağrılır ve
// Promise dönebilir — çağıran taraf araya `setImmediate` koyup NDJSON akışını
// istemciye flush edebilir. better-sqlite3 senkron olduğundan, arada event
// loop'a dönmek büyük backfill sırasında hem akışı canlı tutar hem UI'ı bloklamaz.
export async function syncVrd(
  onProgress?: (p: SyncProgress) => void | Promise<void>
): Promise<SyncResult> {
  const started = Date.now();
  ensureVrdTables();
  const db = getDb();
  const dir = getVrdDir();

  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xml"));
  } catch {
    files = [];
  }

  const stateRows = db
    .prepare("SELECT file, size, mtime FROM vrd_ingest_state")
    .all() as { file: string; size: number; mtime: number }[];
  const stateMap = new Map(stateRows.map((r) => [r.file, r]));

  const deleteFileSales = db.prepare("DELETE FROM vrd_sales WHERE file = ?");
  const insertSale = db.prepare(`
    INSERT INTO vrd_sales
      (file, iso, saat, hour, plaka, plaka_display, temsilci, kodu, musteri,
       is_pesin, yakit, yakit_raw, litre, fiyat, tutar, liste_fiyat, iskonto)
    VALUES
      (@file, @iso, @saat, @hour, @plaka, @plaka_display, @temsilci, @kodu, @musteri,
       @is_pesin, @yakit, @yakit_raw, @litre, @fiyat, @tutar, @liste_fiyat, @iskonto)
  `);
  const upsertState = db.prepare(`
    INSERT INTO vrd_ingest_state (file, size, mtime, rows, ingested_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(file) DO UPDATE SET
      size = excluded.size, mtime = excluded.mtime,
      rows = excluded.rows, ingested_at = excluded.ingested_at
  `);

  // Bir dosyanın tüm satışlarını tek transaction'da yeniden yaz (idempotent).
  const ingestFile = db.transaction((file: string, size: number, mtime: number) => {
    const full = path.join(dir, file);
    const parsed = parseVrdXml(fs.readFileSync(full, "utf8"));
    const iso = isoFromTarih(parsed.tarih || parsed.sales[0]?.tarih || "");

    // Vardiya içinde ham yakıt adı bazında liste fiyatı = en yüksek FYT.
    const listByFuel = new Map<string, number>();
    for (const s of parsed.sales) {
      const cur = listByFuel.get(s.yakitRaw) ?? 0;
      if (s.fiyat > cur) listByFuel.set(s.yakitRaw, s.fiyat);
    }

    deleteFileSales.run(file);

    let rows = 0;
    for (const s of parsed.sales) {
      const liste = listByFuel.get(s.yakitRaw) ?? s.fiyat;
      const iskonto = Math.max(0, (liste - s.fiyat) * s.litre);
      const musteri = classifyCustomer(s.kodu, s.filoAdi);
      const plakaNorm = normalizePlate(s.plaka2);
      const isPesin = musteri === "istasyon" && isValidPlate(plakaNorm) ? 1 : 0;
      const hour = parseInt((s.saat || "").slice(0, 2), 10);

      insertSale.run({
        file,
        iso,
        saat: s.saat || "",
        hour: Number.isFinite(hour) ? hour : null,
        plaka: isPesin ? plakaNorm : null,
        plaka_display: isPesin ? s.plaka2.trim().toUpperCase() : null,
        temsilci: (s.plaka || "").trim(),
        kodu: s.kodu || "",
        musteri,
        is_pesin: isPesin,
        yakit: s.yakit,
        yakit_raw: s.yakitRaw || "",
        litre: s.litre,
        fiyat: s.fiyat,
        tutar: s.tutar,
        liste_fiyat: liste,
        iskonto: Math.round(iskonto * 100) / 100,
      });
      rows++;
    }

    upsertState.run(file, size, mtime, rows);
    return rows;
  });

  const prog: SyncProgress = { processed: 0, skipped: 0, total: files.length, inserted: 0 };
  const alive = new Set(files);

  for (const file of files) {
    const full = path.join(dir, file);
    let size: number;
    let mtime: number;
    try {
      const st = fs.statSync(full);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      continue;
    }

    const prev = stateMap.get(file);
    if (prev && prev.size === size && prev.mtime === mtime) {
      prog.skipped++;
      continue;
    }

    try {
      const rows = ingestFile(file, size, mtime);
      prog.inserted += rows;
    } catch {
      // bozuk/okunamayan dosya: atla, senkronu bozma
    }
    prog.processed++;
    prog.file = file;
    await onProgress?.({ ...prog });
  }

  // Klasörden silinmiş dosyaların kayıtlarını temizle.
  const orphanClean = db.transaction(() => {
    for (const r of stateRows) {
      if (!alive.has(r.file)) {
        deleteFileSales.run(r.file);
        db.prepare("DELETE FROM vrd_ingest_state WHERE file = ?").run(r.file);
      }
    }
  });
  orphanClean();

  return { ...prog, done: true, durationMs: Date.now() - started };
}

// DB'de hiç aktarılmış satış var mı? (ilk açılış senkron ekranı için)
export function hasIngestedData(): boolean {
  ensureVrdTables();
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM vrd_sales").get() as { c: number };
  return row.c > 0;
}

export function fuelLabel(k: string): string {
  return FUEL_LABELS[k as FuelKind] || "Diğer";
}
