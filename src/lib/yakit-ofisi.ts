import getDb from "@/lib/db";

// Yakıt Ofisi (ozciftci.yakitofisi.com) API istemcisi — YALNIZ OKUMA.
// API'nin PUT uçları gönderilmeyen alanları siliyor, POST/DELETE uçları fatura kesiyor,
// cihaz iptal ediyor; bu modül bilerek yalnız GET yapar.

export const YO_DEFAULT_BASE_URL = "https://ozciftci.yakitofisi.com";
const KEY_SETTING = "yo_api_key";
const BASE_SETTING = "yo_base_url";
const TEST_SETTING = "yo_last_test";
const CACHE_MS = 5 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

export class YoApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YoApiError";
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export type Paged<T> = { items: T[]; totalCount?: number; totalPages?: number };

function readSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

function writeSetting(key: string, value: string) {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getYoBaseUrl(): string {
  return (readSetting(BASE_SETTING) || YO_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getYoKey(): string {
  return readSetting(KEY_SETTING).trim();
}

export type YoLastTest = { at: number; ok: boolean; message: string; accountType?: string; userName?: string };

export function getYoSettings() {
  const key = getYoKey();
  let lastTest: YoLastTest | null = null;
  try {
    lastTest = JSON.parse(readSetting(TEST_SETTING) || "null");
  } catch {
    lastTest = null;
  }
  return {
    baseUrl: getYoBaseUrl(),
    hasKey: Boolean(key),
    // Anahtarın tamamı hiçbir zaman tarayıcıya geri gönderilmez.
    keyHint: key ? `${key.slice(0, 12)}…${key.slice(-4)}` : "",
    lastTest,
  };
}

export function saveYoSettings(input: { apiKey?: unknown; baseUrl?: unknown }) {
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const key = input.apiKey.trim().replace(/^Bearer\s+/i, "");
    if (!/^pk_[a-z]+_[A-Za-z0-9_-]{20,}$/.test(key)) {
      throw new Error("Anahtar pk_live_ ile başlamalı (Yakıt Ofisi → API Anahtarları).");
    }
    writeSetting(KEY_SETTING, key);
  }
  if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    let url: URL;
    try {
      url = new URL(input.baseUrl.trim());
    } catch {
      throw new Error("Panel adresi geçersiz.");
    }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".yakitofisi.com")) {
      throw new Error("Panel adresi https://….yakitofisi.com olmalı.");
    }
    writeSetting(BASE_SETTING, url.origin);
  }
  cache.clear();
}

export function deleteYoKey() {
  getDb().prepare("DELETE FROM settings WHERE key IN (?, ?)").run(KEY_SETTING, TEST_SETTING);
  cache.clear();
}

const cache = new Map<string, { at: number; data: unknown }>();

// İzin verilen okuma uçları. Listede olmayan bir yola istek atılamaz; yeni bir okuma ekranı
// eklenirken uç buraya bilerek yazılır.
const READ_ONLY_PATHS = new Set([
  "profile",
  "fleets",
  "distributor-dashboard/limit-runway",
  "churn-risk",
  "rejected-fuel-attempts",
  "limits",
  "analytics/sales-summary",
  "purchases",
  "reports/all-sales-by-fleet",
]);
// Tek müşterinin detayı ve fatura adresi (yalnız sayısal kimlikle).
const READ_ONLY_PATTERNS = [/^fleets\/\d+$/, /^fleets\/\d+\/address$/];

function buildUrl(path: string, query?: Query) {
  const clean = path.replace(/^\/+/, "");
  if (!READ_ONLY_PATHS.has(clean) && !READ_ONLY_PATTERNS.some((re) => re.test(clean))) {
    throw new YoApiError(`İzin verilmeyen Yakıt Ofisi ucu: ${clean}`, 0);
  }
  const url = new URL(`/api/1.0/${clean}`, getYoBaseUrl());
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

function errorText(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    detail = String(j.detail || j.title || j.message || j.error || "");
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401) return "Anahtar geçersiz ya da iptal edilmiş (401).";
  if (status === 403) return "Bu anahtarın kullanıcısının bu veriye yetkisi yok (403).";
  if (status === 429) return "Çok sık istek; biraz sonra tekrar deneyin (429).";
  return `Yakıt Ofisi ${status}${detail ? `: ${detail}` : ""}`;
}

// Yakıt Ofisi kısa sürede çok istek gelince 429 veriyor: istekler tek sıradan, aralıklı gider;
// aynı adrese o anda giden bir istek varsa yenisi atılmaz, onun sonucu beklenir.
const MIN_GAP_MS = 350;
const MAX_RETRIES = 3;
let queue: Promise<unknown> = Promise.resolve();
let lastSentAt = 0;
const inflight = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastSentAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSentAt = Date.now();
    return job();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function fetchJson<T>(url: URL, key: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await enqueue(() =>
      fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      }),
    );
    const text = await res.text();
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new YoApiError(errorText(res.status, text), res.status);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export async function yoGet<T>(path: string, query?: Query, opts: { fresh?: boolean } = {}): Promise<T> {
  const key = getYoKey();
  if (!key) throw new YoApiError("Yakıt Ofisi API anahtarı girilmemiş (Ayarlar).", 0);
  const url = buildUrl(path, query);
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  const pending = inflight.get(cacheKey);
  if (pending) return pending as Promise<T>;
  const p = fetchJson<T>(url, key)
    .then((data) => {
      cache.set(cacheKey, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

// Sayfalı uçların bütün sayfalarını toplar (en fazla MAX_PAGES × PAGE_SIZE kayıt).
export async function yoGetAll<T>(path: string, query?: Query, opts: { fresh?: boolean } = {}): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await yoGet<Paged<T>>(path, { ...query, Page: page, PageSize: PAGE_SIZE }, opts);
    const items = r?.items ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (r.totalPages && page >= r.totalPages) break;
  }
  return all;
}

export async function testYoConnection(): Promise<YoLastTest> {
  let result: YoLastTest;
  try {
    const p = await yoGet<{ userName?: string; accountType?: number | string }>("profile", undefined, { fresh: true });
    const types: Record<string, string> = { "0": "Distribütör", "1": "Filo", "2": "Kök" };
    const accountType = types[String(p?.accountType)] ?? String(p?.accountType ?? "");
    result = { at: Date.now(), ok: true, message: "Bağlantı başarılı.", accountType, userName: p?.userName };
  } catch (err) {
    result = { at: Date.now(), ok: false, message: err instanceof Error ? err.message : "Bağlantı kurulamadı." };
  }
  writeSetting(TEST_SETTING, JSON.stringify(result));
  return result;
}

// --- Ekranlar için hazır sorgular ---

export type YoFleet = {
  id: number;
  name?: string | null;
  customName?: string | null;
  code?: string | null;
  codeName?: string | null;
  petrolType?: number | string;
  totalDebtDiscounted?: number;
  totalDebtDiscountedReadyToPay?: number;
  totalDebtDiscountedDueBeforeToday?: number;
  totalDebtDiscountedPastDue?: number;
  totalDebtDiscountedOverdue?: number;
  totalLimit?: number;
  remainingLimit?: number;
  lastFuelPurchaseDate?: string | null;
  addressPhone?: string | null;
  addressEmail?: string | null;
  termDay?: number | null;
  termType?: number | string;
  fuelAllowance?: boolean;
  isOverdue?: boolean;
};

export const fleetName = (f: { customName?: string | null; name?: string | null; code?: string | null }) =>
  f.customName || f.name || f.code || "—";

const DEBT_FIELDS = [
  "id", "code", "codeName", "name", "customName", "fuelAllowance", "openState", "termDay", "termType",
  "totalDebtDiscounted", "totalDebtDiscountedReadyToPay", "totalDebtDiscountedDueBeforeToday",
  "totalDebtDiscountedPastDue", "totalDebtDiscountedOverdue", "totalLimit", "remainingLimit",
  "lastFuelPurchaseDate", "addressPhone", "city", "district",
].join(",");

// Borç taşıyan bütün müşteri hesapları (vadesi gelen ve geçen ekranı ikisi de buradan ayrılır).
export async function listDebtHolders(fresh = false): Promise<YoFleet[]> {
  return yoGetAll<YoFleet>(
    "fleets",
    { DebtHoldersOnly: true, Sort: "DebtDesc", Fields: DEBT_FIELDS, IncludeTotal: false },
    { fresh },
  );
}

// Vadesi geçmiş borcu olan müşteri hesapları, en borçlusu önde.
export async function listOverdueFleets(fresh = false): Promise<YoFleet[]> {
  return yoGetAll<YoFleet>(
    "fleets",
    { DebtHoldersOnly: true, DueBeforeTodayOnly: true, Sort: "DueBeforeTodayDesc", Fields: DEBT_FIELDS, IncludeTotal: false },
    { fresh },
  );
}

export type YoFleetName = { id: number; code?: string | null; name?: string | null; customName?: string | null };

// Kart hatası ve reddedilen alım listeleri yalnız filo kimliği taşıyor; adları buradan eşleşir.
export async function fleetNameMap(fresh = false): Promise<Map<number, YoFleetName>> {
  const list = await yoGetAll<YoFleetName>(
    "fleets",
    { Fields: "id,code,name,customName", IncludeTotal: false },
    { fresh },
  );
  return new Map(list.map((f) => [f.id, f]));
}

// Müşteri penceresi: filo detayı + fatura adresi. Adres yetkisi yoksa yalnız detay döner.
export async function getFleetDetail(id: number, fresh = false) {
  const fleet = await yoGet<Record<string, unknown>>(`fleets/${id}`, undefined, { fresh });
  let address: Record<string, unknown> | null = null;
  try {
    address = await yoGet<Record<string, unknown>>(`fleets/${id}/address`, undefined, { fresh });
  } catch {
    address = null;
  }
  return { fleet, address };
}

export type YoLimitRunwayFleet = {
  fleetId: number;
  fleetName?: string | null;
  cariCode?: string | null;
  remainingLimit: number;
  totalLimit: number;
  dailySpend: number;
  runwayDays: number;
  critical: boolean;
};

export async function listLimitRunway(fresh = false) {
  const r = await yoGet<{ criticalCount: number; fleetCount: number; fleets: Paged<YoLimitRunwayFleet> }>(
    "distributor-dashboard/limit-runway",
    { PageSize: PAGE_SIZE },
    { fresh },
  );
  return { criticalCount: r?.criticalCount ?? 0, fleets: r?.fleets?.items ?? [] };
}

export type YoChurn = {
  fleetId: number;
  fleetName?: string | null;
  cariCode?: string | null;
  level: number | string;
  pattern: number | string;
  blocker: number | string;
  reason?: string | null;
  lastPurchaseDate?: string | null;
  silenceDays: number;
  baselineLiter: number;
  recentLiter: number;
};

export async function listChurnRisk(fresh = false) {
  return yoGetAll<YoChurn>("churn-risk", { IncludeTotal: false }, { fresh });
}

export type YoRejected = {
  id: number;
  requestDate: string;
  fleetID: number;
  customerCode?: string | null;
  plate?: string | null;
  reason?: string | null;
  stationName?: string | null;
  cityName?: string | null;
  productName?: string | null;
};

export async function listRejectedAttempts(days = 3, fresh = false) {
  const from = new Date(Date.now() - days * 86400_000);
  const ymd = from.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  return yoGetAll<YoRejected>("rejected-fuel-attempts", { From: ymd, IncludeTotal: false }, { fresh });
}

export type YoLimit = {
  id: number;
  fleetID: number;
  amount: number;
  lastErrorMessage?: string | null;
  lastError?: string;
  errorCount: number;
};

export async function listCardErrorLimits(fresh = false) {
  return yoGetAll<YoLimit>("limits", { Status: "CreditCardError", IncludeTotal: false }, { fresh });
}

// Sayı olarak ya da adıyla gelebilen enum'ları ada çevirir.
export function enumName(value: unknown, names: string[]): string {
  if (typeof value === "number") return names[value] ?? String(value);
  return String(value ?? "");
}

// --- Satışlar ---

export type YoSalesRow = {
  dimensionID?: number | null;
  dimensionName?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  count: number;
  quantity: number;
  amount?: number | null;
  amountDiscounted: number;
  previousCount?: number | null;
  previousQuantity?: number | null;
  previousAmountDiscounted?: number | null;
  quantityChange?: number | null;
  amountDiscountedChange?: number | null;
};

export type SalesQuery = {
  from: string; // YYYY-MM-DD, dahil
  to: string; // YYYY-MM-DD, hariç
  groupBy?: string;
  timeBucket?: string;
  purchaseType?: string;
  compareFrom?: string;
  compareTo?: string;
};

export async function salesSummary(q: SalesQuery, fresh = false) {
  return yoGet<YoSalesRow[]>(
    "analytics/sales-summary",
    {
      From: q.from,
      To: q.to,
      GroupBy: q.groupBy ?? "None",
      TimeBucket: q.timeBucket ?? "None",
      PurchaseType: q.purchaseType,
      CompareFrom: q.compareFrom,
      CompareTo: q.compareTo,
      Top: 5000,
    },
    { fresh },
  );
}

export type YoPurchase = {
  id: number;
  fleetID: number;
  fleetCode?: string | null;
  plate?: string | null;
  fuelType?: number | string;
  purchaseType?: number | string;
  liter?: number;
  unitPrice?: number;
  totalAmount?: number;
  totalAmountDiscounted?: number;
  processDate: string;
  kilometer?: number | null;
  dealer?: { name?: string | null; city?: string | null } | null;
};

export const PURCHASE_LIMIT = MAX_PAGES * PAGE_SIZE;

// Tarih aralığındaki satış hareketleri. Aralıkta PURCHASE_LIMIT'ten çok işlem varsa hepsini
// çekmeyiz (Yakıt Ofisi'ni yormamak için); toplam sayı döner, ekran aralığı daraltmayı ister.
export async function listPurchases(from: string, to: string, fresh = false) {
  const fields = "id,fleetID,fleetCode,plate,fuelType,purchaseType,liter,unitPrice,totalAmount,totalAmountDiscounted,processDate,kilometer,dealer";
  const first = await yoGet<Paged<YoPurchase>>(
    "purchases",
    { From: from, To: to, Fields: fields, Page: 1, PageSize: PAGE_SIZE, IncludeTotal: true },
    { fresh },
  );
  const total = first?.totalCount ?? first?.items?.length ?? 0;
  if (total > PURCHASE_LIMIT) return { total, items: null };
  const items = [...(first?.items ?? [])];
  const pages = Math.ceil(total / PAGE_SIZE);
  for (let page = 2; page <= pages; page++) {
    const r = await yoGet<Paged<YoPurchase>>(
      "purchases",
      { From: from, To: to, Fields: fields, Page: page, PageSize: PAGE_SIZE, IncludeTotal: false },
      { fresh },
    );
    items.push(...(r?.items ?? []));
  }
  return { total, items };
}

// --- Filo grupları ---

const GROUP_CACHE_MS = 30 * 60 * 1000;
let groupCache: { at: number; map: Map<number, string[]> } | null = null;

// Filo → grup adları. Filo listesinde grup alanı yok; filo bazında satış raporu her filonun
// gruplarını taşıyor (AllFleets=true ile satışı olmayanlar da gelir). Gruplar seyrek değiştiği için
// 30 dk saklanır.
export async function fleetGroupMap(fresh = false): Promise<Map<number, string[]>> {
  if (!fresh && groupCache && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache.map;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const rows = await yoGet<{ fleetID: number; fleetGroups?: string[] | null }[]>(
    "reports/all-sales-by-fleet",
    { PetrolType: "PetrolOfisi", From: today, To: today, AllFleets: true, Fields: "fleetID,fleetGroups" },
    { fresh },
  );
  const map = new Map<number, string[]>();
  for (const r of rows ?? []) {
    const groups = (r.fleetGroups ?? []).map((g) => g.trim()).filter(Boolean);
    if (groups.length) map.set(r.fleetID, groups);
  }
  groupCache = { at: Date.now(), map };
  return map;
}

// Satırlara `groups` alanını ekler. Grup eşlemesi alınamazsa (ör. rapor yetkisi yok) satırlar
// olduğu gibi döner; ekranda grup filtresi o zaman görünmez.
export async function withGroups<T>(rows: T[] | null | undefined, idOf: (r: T) => number | null | undefined, fresh = false) {
  if (!rows) return rows;
  let map: Map<number, string[]>;
  try {
    map = await fleetGroupMap(fresh);
  } catch {
    return rows;
  }
  return rows.map((r) => {
    const id = idOf(r);
    return { ...r, groups: (id != null && map.get(id)) || [] };
  });
}
