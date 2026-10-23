import getDb from "@/lib/db";
import {
  getPlaceDetails,
  isPlacesConfigured,
  searchIdsInRect,
  type PlaceDetail,
  type Rect,
} from "@/lib/places";
import { PROFILE_QUERIES } from "@/lib/prospect-profiles";
import { broadcast, isTelegramConfigured } from "@/lib/telegram";

// Müşteri Bulucu → "Yeni İşletmeler".
//
// Seçilen ilin haritası karelere bölünür; her karede seçili işletme türleri Google'da
// aranır ama YALNIZ kimlikler istenir (Google "IDs Only" kademesi — ücretsiz). Google
// bir aramada en fazla 60 sonuç verdiği için 60'a ulaşan kare dörde bölünüp tekrar
// aranır; böylece yoğun bölgelerde de kimse atlanmaz.
//
// Birden çok il takip edilebilir; her ilin kendi tür listesi, temel listesi ve haftalık
// taraması vardır. Bir il eklemek ya da takipten çıkarmak diğerlerinin sonuçlarını silmez.
//
// İlk tarama temel listeyi çıkarır. Sonraki taramalarda temel listede olmayan kimlik
// "yeni" sayılır; yalnız onların ayrıntısı (ad, telefon, adres — ücretli) çekilir.
// Google "yakında açılacak" işletmeleri de döndürür; bunlar ayrıca listelenir.
//
// Tarama arka planda, tek tek istekle ilerler; sunucuyu meşgul etmez. Haftalık
// zamanlayıcı (startProspectScheduler) son taramadan 7 gün geçince yenisini başlatır.

const DAY = 24 * 60 * 60 * 1000;
// Google kuralı: işletme ayrıntıları en fazla 30 gün saklanabilir (kimlikler süresiz).
const DETAILS_KEEP_MS = 30 * DAY;
const DETAILS_REFRESH_MS = 25 * DAY;
const INITIAL_GRID = 4; // il dikdörtgeni 4x4 kareyle başlar
const MAX_DEPTH = 5; // doymuş kare en fazla 5 kez bölünür (~1 km'ye kadar)
const MAX_DETAILS_PER_SCAN = 200; // beklenmedik bir taşmada maliyeti sınırlar

// İllerin dikdörtgen sınırları (biraz geniş tutuldu; komşu ile taşan işletmeler
// ayrıntı aşamasında adresteki il adına göre elenir).
export const PROVINCE_RECTS: Record<string, Rect> = {
  Sakarya: { low: { latitude: 40.25, longitude: 30.0 }, high: { latitude: 41.22, longitude: 30.98 } },
  Kocaeli: { low: { latitude: 40.5, longitude: 29.25 }, high: { latitude: 41.25, longitude: 30.4 } },
  Düzce: { low: { latitude: 40.55, longitude: 30.85 }, high: { latitude: 41.15, longitude: 31.7 } },
};

// Filosu olma ihtimali yüksek türler (varsayılan takip listesi).
export const DEFAULT_WATCH_PROFILES = [
  "Nakliye & Lojistik",
  "Kargo & Dağıtım",
  "Servis Taşımacılığı",
  "Otobüs & Turizm Taşıma",
  "Oto Kiralama / Filo",
  "Tır & Ağır Vasıta",
  "Evden Eve Nakliyat",
  "İnşaat & Hafriyat",
  "Beton Santrali",
  "Madencilik & Ocak",
  "Asfalt & Yol Yapım",
  "Tarım / Traktör",
  "Hayvancılık & Çiftlik",
  "Gıda Dağıtım / Soğuk Zincir",
  "Depo & Antrepo",
];

export type IlWatch = { il: string; profiles: string[] };
// enabled: takip edilen bütün illerin haftalık otomatik taraması.
export type WatchConfig = { watches: IlWatch[]; enabled: boolean };

const WATCH_KEY = "prospect_watch";

function cleanProfiles(profiles: unknown): string[] {
  return Array.isArray(profiles) ? profiles.map(String).filter((p) => PROFILE_QUERIES[p]) : [];
}

export function getWatchConfig(): WatchConfig {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(WATCH_KEY) as
    | { value: string }
    | undefined;
  try {
    const v = row
      ? (JSON.parse(row.value) as Partial<WatchConfig> & { il?: string; profiles?: string[] })
      : {};
    // Eski kayıt tek il tutuyordu ({ il, profiles }); yeni yapıya aktarılır.
    const raw: IlWatch[] = Array.isArray(v.watches)
      ? v.watches
      : v.il
        ? [{ il: v.il, profiles: v.profiles ?? DEFAULT_WATCH_PROFILES }]
        : [];
    const watches = raw
      .filter((w) => PROVINCE_RECTS[w.il])
      .map((w) => ({ il: w.il, profiles: cleanProfiles(w.profiles) }))
      .filter((w) => w.profiles.length > 0);
    return { watches, enabled: v.enabled === true };
  } catch {
    return { watches: [], enabled: false };
  }
}

function writeWatchConfig(cfg: WatchConfig): WatchConfig {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(WATCH_KEY, JSON.stringify(cfg));
  return cfg;
}

// Bir ili takibe ekler ya da türlerini günceller; diğer iller olduğu gibi kalır.
export function saveIlWatch(il: string, profiles: string[]): WatchConfig {
  if (!PROVINCE_RECTS[il]) throw new Error("Bu il desteklenmiyor.");
  const clean = cleanProfiles(profiles);
  if (clean.length === 0) throw new Error("En az bir işletme türü seçin.");
  const cfg = getWatchConfig();
  const watches = cfg.watches.some((w) => w.il === il)
    ? cfg.watches.map((w) => (w.il === il ? { il, profiles: clean } : w))
    : [...cfg.watches, { il, profiles: clean }];
  return writeWatchConfig({ ...cfg, watches });
}

// İli takipten çıkarır: haftalık taraması durur, bulunmuş işletmeler listede kalır.
export function removeIlWatch(il: string): WatchConfig {
  const cfg = getWatchConfig();
  return writeWatchConfig({ ...cfg, watches: cfg.watches.filter((w) => w.il !== il) });
}

export function setWatchEnabled(enabled: boolean): WatchConfig {
  return writeWatchConfig({ ...getWatchConfig(), enabled });
}

// --- Izgara ---

function gridRects(r: Rect, n: number): Rect[] {
  const dLat = (r.high.latitude - r.low.latitude) / n;
  const dLng = (r.high.longitude - r.low.longitude) / n;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push({
        low: { latitude: r.low.latitude + i * dLat, longitude: r.low.longitude + j * dLng },
        high: { latitude: r.low.latitude + (i + 1) * dLat, longitude: r.low.longitude + (j + 1) * dLng },
      });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Bir karedeki tüm kimlikler; doymuşsa (60) kareyi dörde bölüp devam eder.
async function scanArea(
  query: string,
  rect: Rect,
  depth: number,
  counter: { requests: number }
): Promise<string[]> {
  const res = await searchIdsInRect(query, rect);
  counter.requests += res.requests;
  await sleep(150);
  if (!res.saturated || depth >= MAX_DEPTH) return res.ids;
  const out = new Set(res.ids);
  for (const sub of gridRects(rect, 2)) {
    for (const id of await scanArea(query, sub, depth + 1, counter)) out.add(id);
  }
  return [...out];
}

// --- Tarama ---

type ScanLock = { running: boolean; il?: string };
const g = globalThis as unknown as { __prospectScan?: ScanLock; __prospectScheduler?: boolean };
const lock: ScanLock = g.__prospectScan ?? (g.__prospectScan = { running: false });

function asciiNorm(s: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => map[c] || c);
}

function toLead(d: PlaceDetail, profile: string) {
  return {
    id: d.id,
    name: d.name,
    address: d.address,
    phone: d.phone,
    mapsUrl: d.mapsUrl,
    website: d.website,
    category: d.category,
    rating: d.rating,
    ratingCount: d.ratingCount,
    lat: d.lat,
    lng: d.lng,
    businessStatus: d.businessStatus,
    profile,
    sector: d.category || profile,
  };
}

// Sunucu tarama sürerken kapandıysa "çalışıyor" kalan kayıtları kapatır.
function closeInterrupted(): void {
  if (lock.running) return;
  getDb()
    .prepare(
      "UPDATE prospect_scans SET status = 'error', finished_at = ?, error = 'Tarama yarıda kaldı (sunucu yeniden başladı).' WHERE status = 'running'"
    )
    .run(Date.now());
}

export function startScan(il: string, startedBy: "manual" | "schedule"): { started: boolean; reason?: string } {
  if (lock.running) return { started: false, reason: `Bir tarama zaten sürüyor (${lock.il}).` };
  if (!isPlacesConfigured()) return { started: false, reason: "Google Places API anahtarı tanımlı değil." };
  const watch = getWatchConfig().watches.find((w) => w.il === il);
  if (!watch) return { started: false, reason: `${il} takip listesinde değil.` };
  closeInterrupted();
  const r = getDb()
    .prepare("INSERT INTO prospect_scans (il, started_by, started_at, status) VALUES (?, ?, ?, 'running')")
    .run(il, startedBy, Date.now());
  lock.running = true;
  lock.il = il;
  void runScan(Number(r.lastInsertRowid), watch).finally(() => {
    lock.running = false;
    lock.il = undefined;
  });
  return { started: true };
}

async function runScan(scanId: number, cfg: IlWatch): Promise<void> {
  const db = getDb();
  const setProgress = db.prepare("UPDATE prospect_scans SET progress = ?, requests = ? WHERE id = ?");
  const counter = { requests: 0 };
  try {
    const rect = PROVINCE_RECTS[cfg.il];
    const seenBefore = new Set(
      (db.prepare("SELECT place_id FROM prospect_seen WHERE il = ?").all(cfg.il) as { place_id: string }[]).map(
        (r) => r.place_id
      )
    );
    const baselined = new Set(
      (db.prepare("SELECT profile FROM prospect_baselines WHERE il = ?").all(cfg.il) as { profile: string }[]).map(
        (r) => r.profile
      )
    );
    const isBaseline = baselined.size === 0;

    // 1) Kimlikleri topla (ücretsiz). id -> onu bulan türler
    const found = new Map<string, Set<string>>();
    const cells = gridRects(rect, INITIAL_GRID);
    const total = cfg.profiles.length * cells.length;
    let done = 0;
    for (const profile of cfg.profiles) {
      const query = PROFILE_QUERIES[profile] || profile;
      for (const cell of cells) {
        for (const id of await scanArea(query, cell, 0, counter)) {
          const s = found.get(id) ?? new Set<string>();
          s.add(profile);
          found.set(id, s);
        }
        done++;
        setProgress.run((done / total) * 0.9, counter.requests, scanId);
      }
    }

    // 2) Yeni adaylar: daha önce görülmemiş VE temel listesi çıkarılmış bir türün bulduğu.
    const candidates = [...found.entries()].filter(
      ([id, profs]) => !seenBefore.has(id) && [...profs].some((p) => baselined.has(p))
    );

    // 3) Kimlikleri kaydet; bu taramada taranan türlerin temel listesi artık var.
    const now = Date.now();
    const upsertSeen = db.prepare(
      `INSERT INTO prospect_seen (place_id, il, first_seen, last_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT(place_id, il) DO UPDATE SET last_seen = excluded.last_seen`
    );
    const markBaseline = db.prepare(
      "INSERT OR IGNORE INTO prospect_baselines (il, profile, done_at) VALUES (?, ?, ?)"
    );
    db.transaction(() => {
      for (const id of found.keys()) upsertSeen.run(id, cfg.il, now, now);
      for (const p of cfg.profiles) markBaseline.run(cfg.il, p, now);
    })();

    // 4) Yalnız yeniler için ayrıntı (ücretli). İl dışına taşanlar ve kapananlar elenir.
    const insertNew = db.prepare(
      `INSERT OR IGNORE INTO prospect_new
         (place_id, il, scan_id, first_seen, profile, business_status, opening_date, details, details_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const ilNorm = asciiNorm(cfg.il);
    let newCount = 0;
    let futureCount = 0;
    const list = candidates.slice(0, MAX_DETAILS_PER_SCAN);
    for (let i = 0; i < list.length; i++) {
      const [id, profs] = list[i];
      try {
        const d = await getPlaceDetails(id);
        counter.requests++;
        if (d.businessStatus === "CLOSED_PERMANENTLY") continue;
        if (!asciiNorm(d.address).includes(ilNorm)) continue;
        const profile = [...profs][0];
        insertNew.run(
          id,
          cfg.il,
          scanId,
          now,
          profile,
          d.businessStatus,
          d.openingDate,
          JSON.stringify(toLead(d, profile)),
          now
        );
        if (d.businessStatus === "FUTURE_OPENING") futureCount++;
        else newCount++;
      } catch (err) {
        console.error("[yeni-isletmeler] ayrıntı alınamadı:", id, err instanceof Error ? err.message : err);
      }
      setProgress.run(0.9 + ((i + 1) / list.length) * 0.1, counter.requests, scanId);
    }

    await refreshAndClean(cfg.il, counter);

    db.prepare(
      `UPDATE prospect_scans SET status = 'done', finished_at = ?, progress = 1, requests = ?, found = ?,
         new_count = ?, future_count = ?, baseline = ? WHERE id = ?`
    ).run(Date.now(), counter.requests, found.size, newCount, futureCount, isBaseline ? 1 : 0, scanId);

    if (!isBaseline && newCount + futureCount > 0) await notifyTelegram(cfg.il, scanId, newCount, futureCount);
  } catch (err) {
    db.prepare("UPDATE prospect_scans SET status = 'error', finished_at = ?, requests = ?, error = ? WHERE id = ?").run(
      Date.now(),
      counter.requests,
      err instanceof Error ? err.message : String(err),
      scanId
    );
  }
}

// 30 günden eski "yeni" kayıtları siler (artık yeni değiller; Google'ın ayrıntı saklama
// süresi de doluyor). Yakında açılacaklar açılış tarihine kadar tutulur; ayrıntıları
// 25 günü geçince Google'dan tazelenir.
async function refreshAndClean(il: string, counter: { requests: number }): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  // Silme bütün illerde yapılır; takipten çıkarılan ilin kayıtları da süresi dolunca gider.
  db.prepare(
    `DELETE FROM prospect_new WHERE first_seen < ?
       AND (business_status != 'FUTURE_OPENING' OR opening_date = '' OR opening_date < ?)`
  ).run(now - DETAILS_KEEP_MS, today);

  const stale = db
    .prepare(
      "SELECT place_id, profile FROM prospect_new WHERE il = ? AND business_status = 'FUTURE_OPENING' AND details_at < ?"
    )
    .all(il, now - DETAILS_REFRESH_MS) as { place_id: string; profile: string }[];
  const update = db.prepare(
    "UPDATE prospect_new SET business_status = ?, opening_date = ?, details = ?, details_at = ? WHERE place_id = ? AND il = ?"
  );
  for (const s of stale) {
    try {
      const d = await getPlaceDetails(s.place_id);
      counter.requests++;
      update.run(d.businessStatus, d.openingDate, JSON.stringify(toLead(d, s.profile)), Date.now(), s.place_id, il);
    } catch {
      /* bir sonraki taramada tekrar denenir */
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyTelegram(il: string, scanId: number, newCount: number, futureCount: number): Promise<void> {
  if (!isTelegramConfigured()) return;
  const rows = getDb()
    .prepare("SELECT details, business_status, opening_date FROM prospect_new WHERE scan_id = ? ORDER BY business_status")
    .all(scanId) as { details: string; business_status: string; opening_date: string }[];
  const lines = rows.slice(0, 10).map((r) => {
    const l = JSON.parse(r.details) as { name: string; phone: string; sector: string };
    const tag = r.business_status === "FUTURE_OPENING" ? `🔜 ${r.opening_date || "yakında"}` : "🆕";
    return `${tag} ${esc(l.name)} · ${esc(l.sector)}${l.phone ? ` · ${esc(l.phone)}` : ""}`;
  });
  const parts = [
    `🆕 <b>Yeni İşletmeler · ${esc(il)}</b>`,
    `Bu hafta Google Haritalar'da <b>${newCount}</b> yeni işletme görüldü` +
      (futureCount ? `, <b>${futureCount}</b> işletme yakında açılıyor.` : "."),
    "",
    ...lines,
    rows.length > 10 ? `… ve ${rows.length - 10} işletme daha.` : "",
    "",
    "Ayrıntılar: Müşteri Bulucu → Yeni İşletmeler",
  ].filter((x, i, a) => !(x === "" && a[i - 1] === ""));
  try {
    await broadcast(parts.join("\n"));
  } catch (err) {
    console.error("[yeni-isletmeler] Telegram bildirimi gönderilemedi:", err instanceof Error ? err.message : err);
  }
}

// --- Durum ve liste ---

type ScanRow = {
  id: number;
  il: string;
  started_by: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  progress: number;
  requests: number;
  found: number;
  new_count: number;
  future_count: number;
  baseline: number;
  error: string | null;
};

function ilStatus(w: IlWatch, enabled: boolean) {
  const db = getDb();
  const last = db.prepare("SELECT * FROM prospect_scans WHERE il = ? ORDER BY id DESC LIMIT 1").get(w.il) as
    | ScanRow
    | undefined;
  const lastDone = db
    .prepare("SELECT * FROM prospect_scans WHERE il = ? AND status = 'done' ORDER BY id DESC LIMIT 1")
    .get(w.il) as ScanRow | undefined;
  const seen = db.prepare("SELECT COUNT(*) AS n FROM prospect_seen WHERE il = ?").get(w.il) as { n: number };
  return {
    ...w,
    last: last ?? null,
    lastDone: lastDone ?? null,
    seenCount: seen.n,
    nextAt: lastDone && enabled ? lastDone.started_at + 7 * DAY : null,
  };
}

export function getWatchStatus() {
  closeInterrupted();
  const cfg = getWatchConfig();
  return {
    enabled: cfg.enabled,
    placesConfigured: isPlacesConfigured(),
    running: lock.running,
    runningIl: lock.running ? lock.il ?? null : null,
    watches: cfg.watches.map((w) => ilStatus(w, cfg.enabled)),
    iller: Object.keys(PROVINCE_RECTS),
    defaultProfiles: DEFAULT_WATCH_PROFILES,
  };
}

// Bütün illerin yeni ve yakında açılacak işletmeleri (ekranda il ve türe göre süzülür).
export function getWatchItems() {
  const rows = getDb()
    .prepare(
      "SELECT il, details, first_seen, business_status, opening_date FROM prospect_new WHERE details IS NOT NULL"
    )
    .all() as { il: string; details: string; first_seen: number; business_status: string; opening_date: string }[];
  type Item = { il: string; firstSeen: number; openingDate: string };
  const future: Item[] = [];
  const recent: Item[] = [];
  for (const r of rows) {
    const lead = { ...JSON.parse(r.details), il: r.il, firstSeen: r.first_seen, openingDate: r.opening_date } as Item;
    if (r.business_status === "FUTURE_OPENING") future.push(lead);
    else recent.push(lead);
  }
  future.sort((a, b) => String(a.openingDate).localeCompare(String(b.openingDate)));
  recent.sort((a, b) => b.firstSeen - a.firstSeen);
  return { future, recent };
}

// --- Haftalık zamanlayıcı (src/instrumentation.ts'den, yalnız canlıda) ---

// Takip edilen her il için: son başarılı taramadan 7 gün geçtiyse ve saat 07:00–21:00
// arasıysa yeni tarama başlatır. Aynı anda tek tarama çalışır; sıradaki il bir sonraki
// turda başlar. İlk (temel) taramayı kullanıcı "Takibi başlat" ile kendisi başlatır.
export function startProspectScheduler(): void {
  if (g.__prospectScheduler) return;
  g.__prospectScheduler = true;
  closeInterrupted();
  const tick = () => {
    try {
      const s = getWatchStatus();
      if (!s.enabled || s.running) return;
      const hour = new Date().getHours();
      if (hour < 7 || hour >= 21) return;
      const due = s.watches.find(
        (w) => w.lastDone && Date.now() - w.lastDone.started_at >= 7 * DAY - 60 * 60 * 1000
      );
      if (due) startScan(due.il, "schedule");
    } catch (err) {
      console.error("[yeni-isletmeler] zamanlayıcı hatası:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 30 * 60 * 1000);
}
