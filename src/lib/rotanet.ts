import getDb from "@/lib/db";
import { fleetName, yoGet, yoGetAll, YoApiError, type Paged, type YoPurchase } from "@/lib/yakit-ofisi";
import { YO_FUEL_NAMES, YO_TOLL_FUEL_TYPES } from "@/lib/yo-fuel";

// Yakıt Ofisi → RotaNet yakıt gönderimi.
//
// RotaNet servis şirketlerinin kullandığı ayrı bir panel. Şirket RotaNet'te bir bağlantı anahtarı
// üretip bize verir; biz o şirketin Yakıt Ofisi'ndeki filolarının yakıt/AdBlue alımlarını
// RotaNet'e yollarız. Kurallar:
//  - Yakıt Ofisi'nden yalnız okunur (yoGet), RotaNet'e yalnız aşağıdaki adrese yazılır.
//  - Bir bağlantıdan yalnız o bağlantıya seçilen filoların alımları gider (çekerken FleetID
//    süzgeci + göndermeden önce ikinci kontrol). Başka müşterinin alımı gitmez.
//  - Giden alanlar: id, plate, processDate, liter, amount, kilometer, kind, product, station.
//    Müşteri adı, borç, limit gibi başka hiçbir bilgi gitmez.
//  - Anahtar settings tablosunda durur; tarayıcıya, günlüğe ve hata mesajına yazılmaz.

// RotaNet'in alım adresi. Değişirse yalnız bu satır değişir.
export const ROTANET_URL = "https://europe-west1-rotanet-app.cloudfunctions.net/fuelIngest";

const BATCH = 500; // RotaNet tek istekte en çok 500 alım kabul eder
const WINDOW_DAYS = 3; // otomatik gönderim her turda son 3 günü yeniden yollar (çift kayıt olmaz)
export const HISTORY_MAX_DAYS = 90;
const PREVIEW_DAYS = 30;
const MAX_FLEETS = 20;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const PURCHASE_FIELDS = "id,fleetID,plate,fuelType,purchaseType,liter,totalAmount,totalAmountDiscounted,processDate,kilometer,dealer";

// Yalnız geliştirme ortamında, yerel bir sahte sunucuya yönlendirmek için (canlıda yok sayılır).
function endpoint(): string {
  const test = process.env.ROTANET_TEST_URL;
  if (process.env.NODE_ENV !== "production" && test && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(test)) return test;
  return ROTANET_URL;
}

// ---------------------------------------------------------------- türler

export type RotaFilo = { id: number; ad: string; kod: string };

export type RotaSonuc = {
  at: number;
  tur: "oto" | "elle" | "gecmis";
  from: string; // YYYY-MM-DD, dahil
  to: string; // YYYY-MM-DD, dahil
  dryRun: boolean;
  cekilen: number; // Yakıt Ofisi'nden gelen alım
  gonderilen: number; // RotaNet'e yollanan
  written: number;
  existing: number;
  invalid: number;
  unmatched: string[]; // RotaNet'te araç kartı bulunamayan plakalar
  hgs: number; // HGS geçişi/etiket: gönderilmez
  bozuk: number; // sıfır/eksi litre ya da tutar, plakasız: gönderilmez (iptal/iade olabilir)
  bozukOrnek: number[]; // bu alımların Yakıt Ofisi numaraları (en çok 20)
  tanimsiz: number; // satış türü tanınmayan: gönderilmez
};

export type RotaBaglanti = {
  id: number;
  sirket: string;
  filolar: RotaFilo[];
  etkin: boolean;
  anahtarGecersiz: boolean;
  anahtarIpucu: string; // yalnız son dört hane
  sonGonderim: number | null;
  sonDeneme: number | null;
  sonSonuc: RotaSonuc | null;
  sonHata: string | null;
};

type RotaAlim = {
  id: number;
  plate: string;
  processDate: string;
  liter: number;
  amount: number;
  kilometer: number;
  kind: "fuel" | "adblue";
  product?: string;
  station?: string;
};

type RotaYanit = { company: string; received: number; written: number; existing: number; unmatched: string[]; invalid: number; dryRun: boolean };

export class RotaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RotaError";
    this.status = status;
  }
}

// ---------------------------------------------------------------- kayıtlar

type Row = {
  id: number;
  sirket: string;
  filolar: string;
  etkin: number;
  anahtar_gecersiz: number;
  son_gonderim: number | null;
  son_deneme: number | null;
  son_sonuc: string | null;
  son_hata: string | null;
};

const keySetting = (id: number) => `rotanet_key_${id}`;

function readKey(id: number): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(keySetting(id)) as { value: string } | undefined;
  return row?.value ?? "";
}

function parseJson<T>(s: string | null, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function toView(r: Row): RotaBaglanti {
  const key = readKey(r.id);
  return {
    id: r.id,
    sirket: r.sirket,
    filolar: parseJson<RotaFilo[]>(r.filolar, []),
    etkin: r.etkin === 1,
    anahtarGecersiz: r.anahtar_gecersiz === 1,
    anahtarIpucu: key ? `…${key.slice(-4)}` : "",
    sonGonderim: r.son_gonderim,
    sonDeneme: r.son_deneme,
    sonSonuc: parseJson<RotaSonuc | null>(r.son_sonuc, null),
    sonHata: r.son_hata,
  };
}

const rows = () => getDb().prepare("SELECT * FROM rotanet_baglantilar ORDER BY id").all() as Row[];
const rowOf = (id: number) => getDb().prepare("SELECT * FROM rotanet_baglantilar WHERE id = ?").get(id) as Row | undefined;

export function listConnections(): RotaBaglanti[] {
  return rows().map(toView);
}

function need(id: number): Row {
  const r = Number.isInteger(id) ? rowOf(id) : undefined;
  if (!r) throw new Error("Bağlantı bulunamadı.");
  return r;
}

function cleanKey(input: unknown): string {
  const key = String(input ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!/^rnf_[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error("Anahtar rnf_ ile başlamalı (RotaNet'te üretilen bağlantı anahtarı).");
  return key;
}

// ---------------------------------------------------------------- RotaNet isteği

async function rotaPost(key: string, purchases: RotaAlim[], dryRun = false): Promise<RotaYanit> {
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      redirect: "error", // anahtar başka bir adrese taşınmasın
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(dryRun ? { purchases, dryRun: true } : { purchases }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const neden = e instanceof Error && e.name === "TimeoutError" ? "zaman aşımı" : "bağlantı kurulamadı";
    throw new RotaError(`RotaNet'e ulaşılamadı (${neden}).`, 0);
  }
  if (res.status === 401) throw new RotaError("Anahtar geçersiz ya da iptal edilmiş.", 401);
  if (res.status === 403) throw new RotaError("Şirket RotaNet'te askıda.", 403);
  if (res.status === 429) throw new RotaError("RotaNet çok sayıda hatalı deneme nedeniyle beklemeye aldı; 10 dakika sonra deneyin.", 429);
  if (res.status === 400) throw new RotaError("RotaNet isteği kabul etmedi (400).", 400);
  if (!res.ok) throw new RotaError(`RotaNet tarafında hata (${res.status}).`, res.status);
  let j: Record<string, unknown>;
  try {
    j = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new RotaError("RotaNet'in yanıtı okunamadı.", res.status);
  }
  if (j?.ok !== true) throw new RotaError("RotaNet beklenmeyen bir yanıt verdi.", res.status);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    company: typeof j.company === "string" ? j.company.slice(0, 120) : "",
    received: n(j.received),
    written: n(j.written),
    existing: n(j.existing),
    invalid: n(j.invalid),
    unmatched: Array.isArray(j.unmatched) ? j.unmatched.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 20)) : [],
    dryRun: j.dryRun === true,
  };
}

// Anahtarı boş bir istekle sınar; RotaNet anahtarın ait olduğu şirketin adını döndürür.
export async function testKey(input: unknown): Promise<{ sirket: string }> {
  const r = await rotaPost(cleanKey(input), []);
  return { sirket: r.company };
}

// ---------------------------------------------------------------- filolar

type YoFleetRow = { id: number; code?: string | null; name?: string | null; customName?: string | null; fleetType?: number | string; hidden?: boolean };

// Bağlantıya seçilebilecek filolar: müşteri filoları (Standard, ComplexChild). Ana filo (altında
// bütün müşteriler durur), birleşik ve arşiv filolar seçilemez.
const SELECTABLE_TYPES = new Set<number | string>([0, 2, "Standard", "ComplexChild"]);

export async function selectableFleets(fresh = false): Promise<RotaFilo[]> {
  const list = await yoGetAll<YoFleetRow>("fleets", { Fields: "id,code,name,customName,fleetType,hidden", IncludeTotal: false }, { fresh });
  return list
    .filter((f) => !f.hidden && f.fleetType !== undefined && SELECTABLE_TYPES.has(f.fleetType))
    .map((f) => ({ id: f.id, ad: fleetName(f), kod: f.code ?? "" }))
    .sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
}

async function resolveFleets(input: unknown): Promise<RotaFilo[]> {
  const ids = [...new Set((Array.isArray(input) ? input : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw new Error("En az bir filo seçin.");
  if (ids.length > MAX_FLEETS) throw new Error(`Bir bağlantıya en çok ${MAX_FLEETS} filo seçilebilir.`);
  const all = new Map((await selectableFleets(true)).map((f) => [f.id, f]));
  return ids.map((id) => {
    const f = all.get(id);
    if (!f) throw new Error("Seçilen filolardan biri Yakıt Ofisi'nde bulunamadı ya da seçilemez türde.");
    return f;
  });
}

// ---------------------------------------------------------------- alımları toplama

const trDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Date.now() + offset * 86400_000));
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// Tek filonun alımları. `to` dahil; Yakıt Ofisi'nde bitiş hariç olduğu için bir gün eklenir.
async function fleetPurchases(fleetId: number, from: string, to: string): Promise<YoPurchase[]> {
  const byId = new Map<number, YoPurchase>();
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error("Bu aralıkta çok fazla alım var; tarih aralığını daraltın.");
    const r = await yoGet<Paged<YoPurchase>>(
      "purchases",
      { FleetID: fleetId, From: from, To: addDays(to, 1), Fields: PURCHASE_FIELDS, Page: page, PageSize: PAGE_SIZE, IncludeTotal: false },
      { fresh: true },
    );
    const items = r?.items ?? [];
    // İkinci kontrol: Yakıt Ofisi süzgeci ne döndürürse döndürsün yalnız bu filonun alımı alınır.
    for (const x of items) if (x.fleetID === fleetId) byId.set(x.id, x);
    if (items.length < PAGE_SIZE) break;
  }
  return [...byId.values()];
}

type Neden = "hgs" | "bozuk" | "tanimsiz";

function toAlim(x: YoPurchase): RotaAlim | Neden {
  const pt = x.purchaseType;
  if (pt === 2 || pt === "Toll" || YO_TOLL_FUEL_TYPES.has(String(x.fuelType))) return "hgs";
  const kind = pt === 0 || pt === "Fuel" ? "fuel" : pt === 1 || pt === "AdBlue" ? "adblue" : null;
  if (!kind) return "tanimsiz";
  const plate = String(x.plate ?? "").trim();
  const liter = Number(x.liter);
  const discounted = Number(x.totalAmountDiscounted);
  const amount = discounted > 0 ? discounted : Number(x.totalAmount);
  const date = String(x.processDate ?? "");
  if (!Number.isInteger(x.id) || x.id <= 0 || !plate || !(liter > 0) || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)) return "bozuk";
  const product = YO_FUEL_NAMES[String(x.fuelType)];
  const station = [x.dealer?.name, x.dealer?.city].map((s) => String(s ?? "").trim()).filter(Boolean).join(" - ");
  return {
    id: x.id,
    plate: plate.slice(0, 20),
    processDate: date, // Yakıt Ofisi'nden geldiği gibi (Türkiye saati), çevrilmez
    liter,
    amount,
    kilometer: Number(x.kilometer) > 0 ? Number(x.kilometer) : 0,
    kind,
    ...(product ? { product: product.slice(0, 40) } : {}), // tanınmayan türde ürün adı gönderilmez
    ...(station ? { station: station.slice(0, 120) } : {}),
  };
}

async function collect(filolar: RotaFilo[], from: string, to: string) {
  const izinli = new Set(filolar.map((f) => f.id));
  const alimlar = new Map<number, RotaAlim>();
  const sayac = { cekilen: 0, hgs: 0, bozuk: 0, tanimsiz: 0, bozukOrnek: [] as number[] };
  for (const f of filolar) {
    for (const x of await fleetPurchases(f.id, from, to)) {
      if (!izinli.has(x.fleetID)) continue; // son kontrol
      sayac.cekilen++;
      const a = toAlim(x);
      if (typeof a === "string") {
        sayac[a]++;
        if (a === "bozuk" && sayac.bozukOrnek.length < 20) sayac.bozukOrnek.push(x.id);
      } else {
        alimlar.set(a.id, a);
      }
    }
  }
  return { alimlar: [...alimlar.values()], ...sayac };
}

// Kaydetmeden önce: seçilen filoların son 30 gündeki alım sayısı ve plakaları (yalnız Yakıt Ofisi okunur).
export async function previewFleets(input: unknown) {
  const filolar = await resolveFleets(input);
  const to = trDay();
  const from = addDays(to, -(PREVIEW_DAYS - 1));
  const out: { id: number; ad: string; kod: string; alim: number; plakalar: string[] }[] = [];
  for (const f of filolar) {
    const list = (await fleetPurchases(f.id, from, to)).filter((x) => typeof toAlim(x) !== "string");
    const plakalar = [...new Set(list.map((x) => String(x.plate ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
    out.push({ ...f, alim: list.length, plakalar });
  }
  return { gun: PREVIEW_DAYS, filolar: out };
}

// ---------------------------------------------------------------- gönderim

const g = globalThis as unknown as { __rotanetBusy?: Set<number>; __rotanetTimer?: ReturnType<typeof setInterval> };
const busy = (g.__rotanetBusy ??= new Set<number>());

function setError(id: number, message: string, keyInvalid = false) {
  getDb()
    .prepare("UPDATE rotanet_baglantilar SET son_hata = ?, son_deneme = ?, anahtar_gecersiz = MAX(anahtar_gecersiz, ?) WHERE id = ?")
    .run(message, Date.now(), keyInvalid ? 1 : 0, id);
}

export type SendOptions = { tur: RotaSonuc["tur"]; from?: unknown; to?: unknown; dryRun?: boolean };

export async function sendConnection(id: number, opts: SendOptions): Promise<RotaSonuc> {
  const row = need(id);
  if (row.anahtar_gecersiz) throw new Error("Anahtar geçersiz; yeni anahtar girilene kadar gönderim yapılmaz.");
  const key = readKey(id);
  if (!key) throw new Error("Bu bağlantının anahtarı kayıtlı değil; anahtarı yeniden girin.");
  const filolar = parseJson<RotaFilo[]>(row.filolar, []);
  if (filolar.length === 0) throw new Error("Bu bağlantıya filo seçilmemiş.");

  const today = trDay();
  let from = addDays(today, -WINDOW_DAYS);
  let to = today;
  if (opts.tur === "gecmis") {
    if (!isYmd(opts.from) || !isYmd(opts.to) || opts.to < opts.from) throw new Error("Tarih aralığı geçersiz.");
    if (opts.to > today) throw new Error("Bitiş tarihi bugünden sonra olamaz.");
    const gun = Math.round((Date.parse(opts.to) - Date.parse(opts.from)) / 86400_000) + 1;
    if (gun > HISTORY_MAX_DAYS) throw new Error(`En fazla ${HISTORY_MAX_DAYS} günlük aralık gönderilebilir.`);
    from = opts.from;
    to = opts.to;
  }

  if (busy.has(id)) throw new Error("Bu bağlantı için bir gönderim zaten sürüyor.");
  busy.add(id);
  const dryRun = opts.dryRun === true;
  try {
    const c = await collect(filolar, from, to);
    const sonuc: RotaSonuc = {
      at: Date.now(),
      tur: opts.tur,
      from,
      to,
      dryRun,
      cekilen: c.cekilen,
      gonderilen: c.alimlar.length,
      written: 0,
      existing: 0,
      invalid: 0,
      unmatched: [],
      hgs: c.hgs,
      bozuk: c.bozuk,
      bozukOrnek: c.bozukOrnek,
      tanimsiz: c.tanimsiz,
    };
    const unmatched = new Set<string>();
    for (let i = 0; i < c.alimlar.length; i += BATCH) {
      const r = await rotaPost(key, c.alimlar.slice(i, i + BATCH), dryRun);
      if (dryRun && !r.dryRun) {
        throw new RotaError("RotaNet deneme modunu tanımadı; bu alımlar gerçekten yazılmış olabilir. RotaNet tarafına haber verin.", 200);
      }
      sonuc.written += r.written;
      sonuc.existing += r.existing;
      sonuc.invalid += r.invalid;
      for (const p of r.unmatched) unmatched.add(p);
    }
    sonuc.unmatched = [...unmatched].sort().slice(0, 300);
    if (!dryRun) {
      getDb()
        .prepare("UPDATE rotanet_baglantilar SET son_gonderim = ?, son_deneme = ?, son_sonuc = ?, son_hata = NULL WHERE id = ?")
        .run(sonuc.at, sonuc.at, JSON.stringify(sonuc), id);
    }
    return sonuc;
  } catch (e) {
    const message =
      e instanceof RotaError ? e.message : e instanceof YoApiError ? `Yakıt Ofisi: ${e.message}` : e instanceof Error ? e.message : "Gönderilemedi.";
    setError(id, message, e instanceof RotaError && e.status === 401);
    throw new Error(message);
  } finally {
    busy.delete(id);
  }
}

// ---------------------------------------------------------------- bağlantı yönetimi

export async function createConnection(input: { anahtar?: unknown; filoIds?: unknown }): Promise<number> {
  const key = cleanKey(input.anahtar);
  const filolar = await resolveFleets(input.filoIds);
  const { company } = await rotaPost(key, []);
  const db = getDb();
  return db.transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO rotanet_baglantilar (sirket, filolar, created_at) VALUES (?, ?, ?)").run(company, JSON.stringify(filolar), Date.now())
        .lastInsertRowid,
    );
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(keySetting(id), key);
    return id;
  })();
}

// Anahtar ve/veya filoları değiştirir. Yeni anahtar girilirse sınanır ve "anahtar geçersiz" işareti kalkar.
export async function updateConnection(id: number, input: { anahtar?: unknown; filoIds?: unknown }): Promise<void> {
  need(id);
  const db = getDb();
  const filolar = input.filoIds !== undefined ? await resolveFleets(input.filoIds) : null;
  if (typeof input.anahtar === "string" && input.anahtar.trim()) {
    const key = cleanKey(input.anahtar);
    const { company } = await rotaPost(key, []);
    db.transaction(() => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(keySetting(id), key);
      db.prepare("UPDATE rotanet_baglantilar SET sirket = ?, anahtar_gecersiz = 0, son_hata = NULL WHERE id = ?").run(company, id);
    })();
  }
  if (filolar) db.prepare("UPDATE rotanet_baglantilar SET filolar = ? WHERE id = ?").run(JSON.stringify(filolar), id);
}

// Kayıtlı anahtarı yeniden sınar (düzenleme ekranındaki önizleme için).
export async function testStoredKey(id: number): Promise<{ sirket: string }> {
  need(id);
  const key = readKey(id);
  if (!key) throw new Error("Bu bağlantının anahtarı kayıtlı değil; anahtarı yeniden girin.");
  try {
    return { sirket: (await rotaPost(key, [])).company };
  } catch (e) {
    if (e instanceof RotaError) setError(id, e.message, e.status === 401);
    throw e;
  }
}

export function setConnectionActive(id: number, etkin: boolean): void {
  need(id);
  getDb().prepare("UPDATE rotanet_baglantilar SET etkin = ? WHERE id = ?").run(etkin ? 1 : 0, id);
}

export function deleteConnection(id: number): void {
  need(id);
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM rotanet_baglantilar WHERE id = ?").run(id);
    db.prepare("DELETE FROM settings WHERE key = ?").run(keySetting(id));
  })();
}

// ---------------------------------------------------------------- zamanlayıcı

// 15 dakikada bir, her etkin bağlantı için son 3 günün alımlarını yollar. Son günlerin her turda
// yeniden gitmesi bilerek: bilgisayar kapalı kaldıysa eksikler kendiliğinden tamamlanır.
// "Anahtar geçersiz" işaretli bağlantıya yeni anahtar girilene kadar istek atılmaz.
export function startRotaNetScheduler(): void {
  if (g.__rotanetTimer) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const r of rows()) {
        if (!r.etkin || r.anahtar_gecersiz) continue;
        try {
          await sendConnection(r.id, { tur: "oto" });
        } catch (e) {
          // Hata bağlantının "son hata" alanına yazıldı; bir sonraki turda yeniden denenir.
          console.error(`[rotanet] bağlantı ${r.id}:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      running = false;
    }
  };
  setTimeout(run, 120_000);
  g.__rotanetTimer = setInterval(run, 15 * 60_000);
}
