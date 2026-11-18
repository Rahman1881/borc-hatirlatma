import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import getDb from "@/lib/db";
import { isTelegramConfigured, listChats, sendMessage } from "@/lib/telegram";
import { HATIRLAT_VARSAYILAN, kalanGun, tarihYaz, type BelgeKapsam } from "@/lib/belge-turleri";

// Şirket ve Özlük Belgeleri: şirkete, araçlara ve personele ait belgeler; bitiş tarihi olanlar
// için süresi dolmadan Telegram hatırlatması. Kayıtlar portalın veritabanında, dosyalar sunucu
// diskinde (data/belgeler/<belge>/…) tutulur; depoya girmez.
//
// Yenilenen belgenin eski kaydı silinmez, "arşiv" olur (geçmiş görülebilsin).

export type Kapsam = BelgeKapsam;

export type Varlik = {
  id: number;
  tur: "arac" | "personel";
  ad: string; // plaka ya da ad soyad
  aciklama: string; // marka/model ya da görev
  aktif: number;
};

export type Dosya = { id: number; belge_id: number; ad: string; tip: string; boyut: number };

export type Belge = {
  id: number;
  kapsam: Kapsam;
  varlik_id: number | null;
  tur: string;
  belge_no: string;
  kurum: string;
  baslangic: string | null; // YYYY-MM-DD
  bitis: string | null; // null: süresiz
  hatirlat: string; // "30,15,7,1" (kaç gün kala)
  notlar: string;
  durum: "gecerli" | "arsiv";
  onceki_id: number | null;
  dosyalar: Dosya[];
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "doc", "docx", "xls", "xlsx"]);
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const ROOT = path.join(process.cwd(), "data", "belgeler");

function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// --- Okuma ---------------------------------------------------------------------

export function listVarliklar(): Varlik[] {
  return getDb().prepare("SELECT id, tur, ad, aciklama, aktif FROM belge_varliklar ORDER BY aktif DESC, ad COLLATE NOCASE").all() as Varlik[];
}

export function listBelgeler(): Belge[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, kapsam, varlik_id, tur, belge_no, kurum, baslangic, bitis, hatirlat, notlar, durum, onceki_id
       FROM belgeler ORDER BY (bitis IS NULL), bitis, tur COLLATE NOCASE`
    )
    .all() as Omit<Belge, "dosyalar">[];
  const files = db.prepare("SELECT id, belge_id, ad, tip, boyut FROM belge_dosyalar ORDER BY id").all() as Dosya[];
  return rows.map((b) => ({ ...b, dosyalar: files.filter((f) => f.belge_id === b.id) }));
}

// --- Yazma ---------------------------------------------------------------------

export function saveVarlik(input: Record<string, unknown>): number {
  const db = getDb();
  const tur = input.tur === "personel" ? "personel" : "arac";
  const ad = text(input.ad, 120);
  if (ad.length < 2) throw new Error(tur === "arac" ? "Plakayı girin." : "Ad soyadı girin.");
  const aciklama = text(input.aciklama, 200);
  const aktif = input.aktif === false || input.aktif === 0 ? 0 : 1;
  const id = Number(input.id) || 0;
  if (id) {
    db.prepare("UPDATE belge_varliklar SET ad = ?, aciklama = ?, aktif = ? WHERE id = ?").run(ad, aciklama, aktif, id);
    return id;
  }
  return Number(
    db.prepare("INSERT INTO belge_varliklar (tur, ad, aciklama, aktif, created_at) VALUES (?, ?, ?, ?, ?)").run(tur, ad, aciklama, aktif, Date.now())
      .lastInsertRowid
  );
}

// Belgesi olan araç/personel silinmez (pasife alınır); belgesiz kayıt silinebilir.
export function deleteVarlik(id: number): void {
  const db = getDb();
  const n = (db.prepare("SELECT COUNT(*) AS n FROM belgeler WHERE varlik_id = ?").get(id) as { n: number }).n;
  if (n > 0) throw new Error("Bu kayda bağlı belgeler var. Önce belgeleri silin ya da kaydı pasife alın.");
  db.prepare("DELETE FROM belge_varliklar WHERE id = ?").run(id);
}

function cleanHatirlat(v: unknown): string {
  const days = String(v ?? HATIRLAT_VARSAYILAN)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  return [...new Set(days)].sort((a, b) => b - a).join(",");
}

// Yeni belge ya da düzenleme. `yenile` verilirse o belge arşive alınır ve yenisi ona bağlanır.
export function saveBelge(input: Record<string, unknown>): number {
  const db = getDb();
  const kapsam: Kapsam = input.kapsam === "arac" ? "arac" : input.kapsam === "personel" ? "personel" : "sirket";
  const varlikId = kapsam === "sirket" ? null : Number(input.varlik_id) || 0;
  if (kapsam !== "sirket") {
    const v = db.prepare("SELECT tur FROM belge_varliklar WHERE id = ?").get(varlikId) as { tur: string } | undefined;
    if (!v || v.tur !== kapsam) throw new Error(kapsam === "arac" ? "Araç seçin." : "Personel seçin.");
  }
  const tur = text(input.tur, 120);
  if (tur.length < 2) throw new Error("Belge türünü seçin ya da yazın.");
  const baslangic = isIso(input.baslangic) ? input.baslangic : null;
  const bitis = isIso(input.bitis) ? input.bitis : null;
  if (baslangic && bitis && bitis < baslangic) throw new Error("Bitiş tarihi başlangıçtan önce olamaz.");
  const fields = [tur, text(input.belge_no, 80), text(input.kurum, 120), baslangic, bitis, cleanHatirlat(input.hatirlat), text(input.notlar, 2000)];

  const id = Number(input.id) || 0;
  if (id) {
    db.prepare(
      "UPDATE belgeler SET tur = ?, belge_no = ?, kurum = ?, baslangic = ?, bitis = ?, hatirlat = ?, notlar = ?, updated_at = ? WHERE id = ?"
    ).run(...fields, Date.now(), id);
    return id;
  }
  const yenile = Number(input.yenile) || 0;
  const create = db.transaction(() => {
    if (yenile) db.prepare("UPDATE belgeler SET durum = 'arsiv', updated_at = ? WHERE id = ?").run(Date.now(), yenile);
    return Number(
      db
        .prepare(
          `INSERT INTO belgeler (kapsam, varlik_id, tur, belge_no, kurum, baslangic, bitis, hatirlat, notlar, durum, onceki_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'gecerli', ?, ?, ?)`
        )
        .run(kapsam, varlikId, ...fields, yenile || null, Date.now(), Date.now()).lastInsertRowid
    );
  });
  return create();
}

export function deleteBelge(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE belgeler SET onceki_id = NULL WHERE onceki_id = ?").run(id);
    db.prepare("DELETE FROM belge_dosyalar WHERE belge_id = ?").run(id);
    db.prepare("DELETE FROM belge_hatirlatma WHERE belge_id = ?").run(id);
    db.prepare("DELETE FROM belgeler WHERE id = ?").run(id);
  })();
  fs.rmSync(path.join(ROOT, String(id)), { recursive: true, force: true });
}

// --- Dosyalar ------------------------------------------------------------------

export async function addDosya(belgeId: number, file: File): Promise<Dosya> {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM belgeler WHERE id = ?").get(belgeId)) throw new Error("Belge bulunamadı.");
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`"${file.name}": yalnız PDF, resim, Word ve Excel dosyaları yüklenebilir.`);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}": dosya en çok 20 MB olabilir.`);
  const dir = path.join(ROOT, String(belgeId));
  fs.mkdirSync(dir, { recursive: true });
  // Diskteki ad rastgeledir; kullanıcının verdiği ad yalnız veritabanında tutulur.
  const yol = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, yol), Buffer.from(await file.arrayBuffer()));
  const ad = file.name.replace(/[\\/]/g, "_").slice(0, 200);
  const id = Number(
    db.prepare("INSERT INTO belge_dosyalar (belge_id, ad, yol, tip, boyut, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      belgeId,
      ad,
      yol,
      MIME[ext],
      file.size,
      Date.now()
    ).lastInsertRowid
  );
  return { id, belge_id: belgeId, ad, tip: MIME[ext], boyut: file.size };
}

export function readDosya(id: number): { ad: string; tip: string; data: Buffer } | null {
  const row = getDb().prepare("SELECT belge_id, ad, yol, tip FROM belge_dosyalar WHERE id = ?").get(id) as
    | { belge_id: number; ad: string; yol: string; tip: string }
    | undefined;
  if (!row) return null;
  const file = path.join(ROOT, String(row.belge_id), path.basename(row.yol));
  if (!fs.existsSync(file)) return null;
  return { ad: row.ad, tip: row.tip, data: fs.readFileSync(file) };
}

export function deleteDosya(id: number): void {
  const db = getDb();
  const row = db.prepare("SELECT belge_id, yol FROM belge_dosyalar WHERE id = ?").get(id) as { belge_id: number; yol: string } | undefined;
  if (!row) return;
  db.prepare("DELETE FROM belge_dosyalar WHERE id = ?").run(id);
  fs.rmSync(path.join(ROOT, String(row.belge_id), path.basename(row.yol)), { force: true });
}

// --- Hatırlatma ----------------------------------------------------------------

export type HatirlatmaAyar = { enabled: boolean; saat: number };
export function getHatirlatmaAyar(): HatirlatmaAyar {
  const saat = Number(getSetting("belge_hatirlatma_saat") ?? 9);
  return { enabled: getSetting("belge_hatirlatma") !== "0", saat: Number.isInteger(saat) && saat >= 0 && saat <= 23 ? saat : 9 };
}
export function saveHatirlatmaAyar(input: Record<string, unknown>): HatirlatmaAyar {
  if (typeof input.enabled === "boolean") setSetting("belge_hatirlatma", input.enabled ? "1" : "0");
  const saat = Number(input.saat);
  if (Number.isInteger(saat) && saat >= 0 && saat <= 23) setSetting("belge_hatirlatma_saat", String(saat));
  return getHatirlatmaAyar();
}

type Due = { belge: Belge; sahip: string; kalan: number; anahtarlar: string[] };

// Bugün hatırlatılması gereken belgeler. Her eşik (ör. 30 gün kala) bir kez bildirilir; belge
// eşik geçtikten sonra eklendiyse geçmiş eşikler tek bildirimde toplanır. Süresi geçen belge
// yenilenene kadar haftada bir hatırlatılır.
export function dueReminders(today = todayIso()): Due[] {
  const db = getDb();
  const varlik = new Map(listVarliklar().map((v) => [v.id, v]));
  const sent = new Set(
    (db.prepare("SELECT belge_id, anahtar FROM belge_hatirlatma").all() as { belge_id: number; anahtar: string }[]).map(
      (r) => `${r.belge_id}|${r.anahtar}`
    )
  );
  const out: Due[] = [];
  for (const b of listBelgeler()) {
    if (b.durum !== "gecerli" || !b.bitis) continue;
    const owner = b.varlik_id ? varlik.get(b.varlik_id) : null;
    if (owner && !owner.aktif) continue; // pasif araç/personel için hatırlatma yok
    const kalan = kalanGun(b.bitis, today);
    let anahtarlar: string[];
    if (kalan < 0) {
      const hafta = Math.floor(-kalan / 7);
      anahtarlar = [`${b.bitis}|gecti|${hafta}`];
    } else {
      anahtarlar = b.hatirlat
        .split(",")
        .map(Number)
        .filter((t) => Number.isInteger(t) && kalan <= t)
        .map((t) => `${b.bitis}|${t}`);
    }
    const yeni = anahtarlar.filter((a) => !sent.has(`${b.id}|${a}`));
    if (yeni.length === 0) continue;
    out.push({ belge: b, sahip: owner ? owner.ad : "Şirket", kalan, anahtarlar: yeni });
  }
  return out.sort((a, b) => a.kalan - b.kalan);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reminderText(due: Due[]): string {
  const lines = due.map((d) => {
    const when = d.kalan < 0 ? `<b>${-d.kalan} gün önce doldu</b>` : d.kalan === 0 ? "<b>bugün doluyor</b>" : `<b>${d.kalan} gün kaldı</b>`;
    return `${d.kalan < 0 ? "🔴" : d.kalan <= 7 ? "🟠" : "🟡"} ${esc(d.sahip)} · ${esc(d.belge.tur)} — ${when} (${tarihYaz(d.belge.bitis)})`;
  });
  return `📁 <b>Belge hatırlatması</b>\n${lines.join("\n")}\n\nYenilenen belgeyi portalda Şirket ve Özlük Belgeleri bölümünden güncelleyin.`;
}

// Günde bir kez (ayarlanan saatten sonra) hatırlatmaları gönderir. Gönderilen sayısını döndürür.
export async function sendReminders(now = new Date()): Promise<number> {
  const ayar = getHatirlatmaAyar();
  if (!ayar.enabled || !isTelegramConfigured()) return 0;
  const due = dueReminders(todayIso(now));
  if (due.length === 0) return 0;
  const chats = listChats().filter((c) => c.allowed && c.enabled);
  let sent = 0;
  for (const c of chats) {
    try {
      await sendMessage(c.chatId, reminderText(due));
      sent++;
    } catch (e) {
      console.error("[belgeler] hatırlatma gönderilemedi:", e instanceof Error ? e.message : e);
    }
  }
  // Kimseye ulaşmadıysa işaretlenmez; ertesi gün yeniden denenir.
  if (sent > 0) {
    const mark = getDb().prepare("INSERT OR IGNORE INTO belge_hatirlatma (belge_id, anahtar, sent_at) VALUES (?, ?, ?)");
    for (const d of due) for (const a of d.anahtarlar) mark.run(d.belge.id, a, Date.now());
  }
  return sent;
}

const g = globalThis as unknown as { __belgeTimer?: ReturnType<typeof setInterval> };

export function startBelgeScheduler(): void {
  if (g.__belgeTimer) return;
  let busy = false;
  const run = () => {
    const now = new Date();
    const today = todayIso(now);
    if (busy || now.getHours() < getHatirlatmaAyar().saat || getSetting("belge_hatirlatma_gun") === today) return;
    busy = true;
    setSetting("belge_hatirlatma_gun", today);
    sendReminders(now)
      .catch((e) => console.error("[belgeler]", e instanceof Error ? e.message : e))
      .finally(() => {
        busy = false;
      });
  };
  setTimeout(run, 150_000);
  g.__belgeTimer = setInterval(run, 15 * 60_000);
}
