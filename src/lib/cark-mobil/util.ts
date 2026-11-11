import type { AppUser, Fuel, LatLng, Phone, Stamp, Stop, Trip, TripStatus, WorkRole } from "./types";

// Mobil uygulamadaki (lib/core/models.dart) biçimlendirme ve doğrulama kurallarının karşılığı.

// Şirket merkezi (ayarlarda depo tanımlı değilse).
export const DEFAULT_DEPOT: LatLng = { lat: 40.7765558, lng: 30.3881702 };

export const FUELS: { key: Fuel; label: string }[] = [
  { key: "diesel", label: "Motorin" },
  { key: "gasoline", label: "Benzin" },
  { key: "adblue", label: "AdBlue" },
];
export function fuelName(f: string | undefined): string {
  return FUELS.find((x) => x.key === f)?.label ?? "Motorin";
}
export const LOADED_FIELD: Record<Fuel, "loadedDieselMl" | "loadedGasolineMl" | "loadedAdBlueMl"> = {
  diesel: "loadedDieselMl",
  gasoline: "loadedGasolineMl",
  adblue: "loadedAdBlueMl",
};

export const STATUS: Record<TripStatus, { label: string; tone: string }> = {
  assigned: { label: "Atandı", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  active: { label: "Yolda", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  returning: { label: "Dönüşte", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  completed: { label: "Tamamlandı", tone: "bg-muted text-muted-foreground" },
  cancelled: { label: "İptal", tone: "bg-red-500/12 text-red-700 dark:text-red-400" },
};

export function newId(): string {
  return crypto.randomUUID();
}

export function epoch(v: Stamp): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  return typeof v.seconds === "number" ? v.seconds * 1000 : 0;
}

export function dateTime(v: Stamp): string {
  const ms = epoch(v);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function clock(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—";
}
// "2026-11-11" -> "11.11.2026"
export function isoDay(iso: string | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "—";
}
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function liters(ml: number | null | undefined): string {
  return ((ml ?? 0) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
}
// "1.250,5" ya da "1250.5" litre -> ml (geçersizse null).
export function parseMl(text: string): number | null {
  let s = text.trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}
export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} dk`;
  return `${Math.floor(min / 60)} sa ${min % 60} dk`;
}
export function km(meters: number | null | undefined): string {
  return meters == null ? "—" : `${(meters / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km`;
}

// Telefon: mobil uygulamayla aynı normalleştirme (+90…).
export function normalizePhone(value: string): string {
  const s = value.trim();
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  if (s.startsWith("+")) return `+${d}`;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.length === 11 && d.startsWith("0")) return `+90${d.slice(1)}`;
  if (d.length === 10) return `+90${d}`;
  return `+${d}`;
}
export function validPhone(value: string): boolean {
  const n = normalizePhone(value);
  return /^\+[1-9]\d{7,14}$/.test(n) && (!n.startsWith("+90") || /^\+90[2-5]\d{9}$/.test(n));
}
export function displayPhone(value: string): string {
  const s = normalizePhone(value);
  if (s.startsWith("+90") && s.length === 13) {
    const d = `0${s.slice(3)}`;
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  }
  return s;
}
export function customerPhones(c: { phones?: Phone[]; phone?: string }): Phone[] {
  if (c.phones?.length) return c.phones;
  return c.phone ? [{ label: "", number: normalizePhone(c.phone) }] : [];
}

export function plannedTotal(stops: Stop[] | undefined, fuel?: Fuel): number {
  return (stops ?? []).filter((s) => !fuel || s.fuel === fuel).reduce((a, s) => a + s.plannedMl, 0);
}
export function loadedTotal(t: Trip): number {
  return (t.loadedDieselMl ?? 0) + (t.loadedGasolineMl ?? 0) + (t.loadedAdBlueMl ?? 0);
}

// Google "encoded polyline" -> [lat, lng][]
export function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

// --- Görevler (roller) -----------------------------------------------------------

export const WORK_ROLES: { key: WorkRole; label: string; short: string }[] = [
  { key: "driver", label: "Şoför", short: "Şoför" },
  { key: "pump", label: "Pompacı", short: "Pompa" },
  { key: "market", label: "Market görevlisi", short: "Market" },
  { key: "wash", label: "Yıkamacı", short: "Yıkama" },
];
export function roleLabel(role: string | undefined): string {
  return WORK_ROLES.find((r) => r.key === role)?.label ?? "";
}
// Kişinin yapabildiği işler: workRoles + (eski kayıtlarda) tek role alanı.
export function duties(u: AppUser | null | undefined): WorkRole[] {
  const set = new Set<string>([...(u?.workRoles ?? []), ...(u?.role && u.role !== "admin" ? [u.role] : [])]);
  return WORK_ROLES.map((r) => r.key).filter((k) => set.has(k));
}
export function hasDuty(u: AppUser | null | undefined, role: WorkRole): boolean {
  return duties(u).includes(role);
}
export function personnelLabel(u: AppUser): string {
  const jobs = duties(u).map(roleLabel).join(" · ");
  return u.role === "admin" ? (jobs ? `Yönetici · ${jobs}` : "Yönetici") : jobs || "—";
}

// --- İstanbul saati (UTC+3, yaz saati yok). Vardiya günleri tarayıcının değil istasyonun saatine göredir. ---

const IST_OFFSET_MS = 3 * 3600000;
// "2026-11-11" gününün İstanbul saatiyle `minutes`. dakikası -> epoch ms (1440'ı aşarsa ertesi gün).
export function istMs(day: string, minutes = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, minutes) - IST_OFFSET_MS;
}
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function istMinute(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function istClock(ms: number | null | undefined): string {
  if (!ms) return "—";
  const m = istMinute(ms);
  return minuteText(m);
}
export function minuteText(m: number): string {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}
// "08:30" -> 510 (geçersizse null)
export function parseMinute(text: string): number | null {
  const m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null;
}
export function addDaysIso(day: string, n: number): string {
  return istDay(istMs(day) + n * 86400000);
}
// Günün ait olduğu haftanın pazartesisi.
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysIso(day, -wd);
}
export const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
export const WEEKDAYS_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
}

// --- Para (kuruş) -----------------------------------------------------------------

export function money(cents: number | null | undefined): string {
  return `${((cents ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}
export function parseMoney(text: string): number | null {
  let s = text.trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
