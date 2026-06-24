import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initDb(db);
  }
  return db;
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      filo_code TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      total_debt REAL NOT NULL DEFAULT 0,
      overdue_debt REAL NOT NULL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      city TEXT,
      district TEXT,
      email TEXT,
      fuel_access TEXT,
      filo_group TEXT,
      ozel_kod TEXT,
      toplam_alacak REAL DEFAULT 0,
      tarihli_bakiye REAL DEFAULT 0,
      son_durum REAL DEFAULT 0,
      toplam_risk REAL DEFAULT 0,
      source TEXT DEFAULT 'yakit',
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      template_id INTEGER,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      twilio_sid TEXT,
      error TEXT,
      sent_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Günlük akaryakıt fiyatları (marka x il x yakıt). Her gün otomatik tazelenir.
    CREATE TABLE IF NOT EXISTS fuel_prices (
      tarih TEXT NOT NULL,        -- YYYY-MM-DD
      il TEXT NOT NULL,           -- ör. Sakarya
      plaka INTEGER NOT NULL,     -- ör. 54
      marka TEXT NOT NULL,        -- ör. Petrol Ofisi
      yakit TEXT NOT NULL,        -- benzin | motorin | lpg
      fiyat REAL NOT NULL,
      kaynak TEXT NOT NULL DEFAULT 'manuel', -- epdk | manuel
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (tarih, plaka, marka, yakit)
    );

    -- Telegram bot aboneleri: bota yazan herkesin chat'i burada tutulur.
    -- Otomatik raporlar enabled=1 olan tüm chat'lere gönderilir.
    CREATE TABLE IF NOT EXISTS telegram_chats (
      chat_id TEXT PRIMARY KEY,
      name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT DEFAULT (datetime('now','localtime')),
      last_seen TEXT DEFAULT (datetime('now','localtime'))
    );

    -- AI Asistan sohbet geçmişi (eski "Eski Sohbetler" bölümü).
    -- Önceden tarayıcı localStorage'ında tutuluyordu; 7/24 açık sunucuya
    -- geçtiğimiz için artık veritabanında saklanır (cihazdan bağımsız, kalıcı).
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'Yeni Sohbet',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,                 -- 'user' | 'ai'
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    -- Müşteri Bulucu: kaydedilen müşteriler ve geçmiş taramalar.
    -- Önceden tarayıcı localStorage'ında tutuluyordu; 7/24 açık sunucuya geçince
    -- veritabanına alındı. Tam nesne JSON olarak data sütununda saklanır;
    -- diğer sütunlar sıralama/güncelleme içindir.
    CREATE TABLE IF NOT EXISTS musteri_saved (
      id TEXT PRIMARY KEY,              -- işletme (lead) id'si
      saved_at INTEGER NOT NULL,        -- ms cinsinden zaman damgası
      data TEXT NOT NULL                -- SavedCustomer JSON
    );

    CREATE TABLE IF NOT EXISTS musteri_history (
      id TEXT PRIMARY KEY,
      scanned_at INTEGER NOT NULL,      -- ms cinsinden zaman damgası
      data TEXT NOT NULL                -- ScanHistoryEntry JSON
    );

    -- Telegram "yakınımdaki müşteriler": bir konum paylaşıldığında bulunan tüm
    -- sonuçlar burada saklanır. "devam" denince aynıları tekrar gönderilmesin diye
    -- kaç tanesinin gönderildiği (sent) tutulur. Her chat için tek kayıt.
    CREATE TABLE IF NOT EXISTS telegram_nearby_cache (
      chat_id TEXT PRIMARY KEY,
      leads TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Telegram vardiya raporu: VRD klasörüne yeni vardiya dosyası düşünce o vardiya
    -- raporlanıp abonelere gönderilir. Aynı dosya iki kez gönderilmesin diye
    -- gönderilen her dosya burada işaretlenir. İlk açılışta mevcut dosyalar toplu
    -- olarak işaretlenir (geçmiş için spam atılmaz).
    CREATE TABLE IF NOT EXISTS telegram_reported_shifts (
      file TEXT PRIMARY KEY,
      reported_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Günlük haber bülteni önbelleği: aynı gün için haberler bir kez üretilir
    -- (Google Haberler RSS + Gemini açıklaması), tekrar istenirse önbellekten döner.
    CREATE TABLE IF NOT EXISTS telegram_news_cache (
      gun TEXT PRIMARY KEY,           -- YYYY-MM-DD
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoice_buyer_overrides (
      source_tax_number TEXT PRIMARY KEY,
      tax_number TEXT NOT NULL,
      buyer_type TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_surname TEXT DEFAULT '',
      tax_office TEXT DEFAULT '',
      city TEXT DEFAULT '',
      district TEXT DEFAULT '',
      address TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // Add Siber Excel columns if they don't exist (migration)
  const columns = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  const columnNames = columns.map((c) => c.name);
  if (!columnNames.includes("ozel_kod")) {
    db.exec("ALTER TABLE customers ADD COLUMN ozel_kod TEXT");
  }
  if (!columnNames.includes("toplam_alacak")) {
    db.exec("ALTER TABLE customers ADD COLUMN toplam_alacak REAL DEFAULT 0");
  }
  if (!columnNames.includes("tarihli_bakiye")) {
    db.exec("ALTER TABLE customers ADD COLUMN tarihli_bakiye REAL DEFAULT 0");
  }
  if (!columnNames.includes("son_durum")) {
    db.exec("ALTER TABLE customers ADD COLUMN son_durum REAL DEFAULT 0");
  }
  if (!columnNames.includes("toplam_risk")) {
    db.exec("ALTER TABLE customers ADD COLUMN toplam_risk REAL DEFAULT 0");
  }
  if (!columnNames.includes("source")) {
    db.exec("ALTER TABLE customers ADD COLUMN source TEXT DEFAULT 'yakit'");
  }
  if (!columnNames.includes("raw_data")) {
    db.exec("ALTER TABLE customers ADD COLUMN raw_data TEXT");
  }

  // Default template
  const templateCount = db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number };
  if (templateCount.count === 0) {
    db.prepare(
      "INSERT INTO templates (name, body) VALUES (?, ?)"
    ).run(
      "Borç Hatırlatma",
      "Sayın {isim}, {tutar} TL tutarında ödenmemiş borcunuz bulunmaktadır. Ödemenizi en kısa sürede yapmanızı rica ederiz. İyi günler."
    );
    db.prepare(
      "INSERT INTO templates (name, body) VALUES (?, ?)"
    ).run(
      "Vadesi Geçmiş Borç",
      "Sayın {isim}, vadesi geçmiş {vadeli_borc} TL tutarında borcunuz bulunmaktadır. Toplam borcunuz: {tutar} TL. Lütfen en kısa sürede ödemenizi yapınız."
    );
    db.prepare(
      "INSERT INTO templates (name, body) VALUES (?, ?)"
    ).run(
      "Yakıtta İndirim Fırsatı",
      "Sayın {isim}, değerli müşterimiz olarak sizlere özel yakıt alımlarınızda indirim fırsatı sunuyoruz! Kampanya detayları ve avantajlı fiyatlar için istasyonumuza bekleriz. İyi günler."
    );
    db.prepare(
      "INSERT INTO templates (name, body) VALUES (?, ?)"
    ).run(
      "Zam Öncesi Hatırlatma",
      "Sayın {isim}, önümüzdeki günlerde yakıt fiyatlarına zam gelmesi beklenmektedir. Zam öncesi avantajlı fiyatlardan yararlanmak için istasyonumuza bekleriz. İyi günler."
    );
  }
}

export default getDb;
