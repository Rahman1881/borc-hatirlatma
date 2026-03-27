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

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now','localtime'))
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
