import type { Shift } from "./types";
import { addDaysIso, istMs } from "./util";

// Pompa vardiya düzeni — mobil uygulamadaki haftalık planlayıcının (lib/core/week_plan.dart,
// PumpRoster) aynısı; iki taraf aynı haftayı aynı şekilde üretsin ve birbirinin kaydını okusun.
//
// İstasyonun kuralı:
//  • Sabahçı çifti (08–16) ile akşamcı çifti (16–24) her hafta yer değiştirir.
//  • Gececi (24–08) ile yedek her hafta yer değiştirir: bu haftanın gececisi gelecek hafta yedektir.
//  • Sabahçılardan biri salı, diğeri çarşamba; gececi perşembe gecesi; akşamcılardan biri
//    cumartesi, diğeri pazar izinlidir. İzinlinin yerine yedek bakar.

export type SlotKey = "morning" | "evening" | "night";
export const PUMP_SLOTS: { key: SlotKey; name: string; start: number; end: number; minPeople: number }[] = [
  { key: "morning", name: "Sabah 08–16", start: 8, end: 16, minPeople: 2 },
  { key: "evening", name: "Akşam 16–24", start: 16, end: 24, minPeople: 2 },
  { key: "night", name: "Gece 24–08", start: 24, end: 32, minPeople: 1 },
];

export type PumpRoster = {
  day: string[]; // sabahçılar
  evening: string[]; // akşamcılar
  night: string | null; // gececi
  floater: string | null; // yedek (izinlilerin yerine bakan)
  off: Record<string, number>; // kişinin haftalık izin günü (0 = Pazartesi)
};

export const EMPTY_ROSTER: PumpRoster = { day: [], evening: [], night: null, floater: null, off: {} };

const DAY_OFF = [1, 2]; // salı, çarşamba
const EVENING_OFF = [5, 6]; // cumartesi, pazar
const NIGHT_OFF = 3; // perşembe
// Çiftler yer değiştirince izin günü de ilerler: Cmt → Sal, Paz → Çar (akşamdan sabaha),
// Sal → Paz, Çar → Cmt (sabahtan akşama). Dört haftada herkes bu günlerin her birinde bir kez izinli olur.
const NEXT_OFF: Record<number, number> = { 5: 1, 6: 2, 1: 6, 2: 5 };

// Vardiyada olmayanların iznini siler; yeni gelene vardiyasının boştaki olağan izin gününü verir.
export function fixOffs(r: PumpRoster): PumpRoster {
  const working = new Set([...r.day, ...r.evening, ...(r.night ? [r.night] : [])]);
  const off: Record<string, number> = {};
  for (const [u, d] of Object.entries(r.off)) if (working.has(u)) off[u] = d;
  const fill = (pair: string[], usual: number[]) => {
    for (const u of pair) {
      if (off[u] != null) continue;
      const taken = new Set(pair.filter((p) => p !== u).map((p) => off[p]));
      const free = usual.find((d) => !taken.has(d));
      if (free != null) off[u] = free;
    }
  };
  fill(r.day, DAY_OFF);
  fill(r.evening, EVENING_OFF);
  if (r.night && off[r.night] == null) off[r.night] = NIGHT_OFF;
  return { ...r, off };
}

// Bir sonraki haftanın düzeni: çiftler yer değiştirir, gececi ile yedek yer değiştirir.
export function rotated(r: PumpRoster): PumpRoster {
  const off: Record<string, number> = {};
  for (const u of [...r.day, ...r.evening]) {
    const next = NEXT_OFF[r.off[u]];
    if (next != null) off[u] = next;
  }
  return fixOffs({ day: [...r.evening], evening: [...r.day], night: r.floater, floater: r.night, off });
}

export type Cell = {
  day: number; // 0 = Pazartesi
  slot: SlotKey;
  memberIds: string[];
  leaves: { absent: string; cover: string | null }[];
};

// Düzenin ürettiği hafta: her gün ekipler; izinlinin yerine (o gün başka birinin yerine
// bakmıyorsa) yedek yazılır.
export function buildWeek(roster: PumpRoster): Cell[] {
  const r = fixOffs(roster);
  const team: Record<SlotKey, string[]> = { morning: r.day, evening: r.evening, night: r.night ? [r.night] : [] };
  const leaves = new Map<string, { absent: string; cover: string | null }[]>();
  const covering = new Set<number>();
  for (const s of PUMP_SLOTS) {
    for (const u of team[s.key]) {
      const d = r.off[u];
      if (d == null) continue;
      const free = r.floater != null && !covering.has(d);
      if (free) covering.add(d);
      const key = `${d}|${s.key}`;
      leaves.set(key, [...(leaves.get(key) ?? []), { absent: u, cover: free ? r.floater : null }]);
    }
  }
  const cells: Cell[] = [];
  for (let day = 0; day < 7; day++) {
    for (const s of PUMP_SLOTS) {
      const l = leaves.get(`${day}|${s.key}`) ?? [];
      const absent = new Set(l.map((x) => x.absent));
      const memberIds = [...team[s.key].filter((u) => !absent.has(u)), ...l.flatMap((x) => (x.cover ? [x.cover] : []))];
      cells.push({ day, slot: s.key, memberIds, leaves: l });
    }
  }
  return cells;
}

// Vardiya notu (mobil uygulamayla aynı biçim): "İzinli: Kenan → İbrahim"
export function cellNote(cell: Cell, name: (uid: string) => string): string {
  if (cell.leaves.length === 0) return "";
  return `İzinli: ${cell.leaves.map((l) => (l.cover ? `${name(l.absent)} → ${name(l.cover)}` : `${name(l.absent)} (yerine kimse yok)`)).join(", ")}`;
}

export function slotTimes(week: string, day: number, slot: SlotKey): { startsAtMs: number; endsAtMs: number } {
  const s = PUMP_SLOTS.find((x) => x.key === slot)!;
  const d = addDaysIso(week, day);
  return { startsAtMs: istMs(d, s.start * 60), endsAtMs: istMs(d, s.end * 60) };
}

// Haftanın kayıtlı pompa vardiyaları: hücre ("gün|vardiya") -> vardiya. Saatleri birebir tutanlar eşleşir.
export function existingCells(week: string, shifts: Shift[]): Map<string, Shift> {
  const byTime = new Map<string, Shift>();
  for (const s of shifts) if (s.workRole === "pump" && s.status !== "cancelled") byTime.set(`${s.startsAtMs}-${s.endsAtMs}`, s);
  const out = new Map<string, Shift>();
  for (let day = 0; day < 7; day++) {
    for (const s of PUMP_SLOTS) {
      const t = slotTimes(week, day, s.key);
      const found = byTime.get(`${t.startsAtMs}-${t.endsAtMs}`);
      if (found) out.set(`${day}|${s.key}`, found);
    }
  }
  return out;
}

// Kayıtlı bir haftadan düzeni geri okur: bir vardiyanın ekibi, o vardiyada günlerin yarısından
// fazlasında çalışanlardır; ekipte olmayıp en çok yer dolduran kişi yedektir.
export function rosterFromShifts(week: string, shifts: Shift[]): PumpRoster | null {
  const found = existingCells(week, shifts);
  if (found.size === 0) return null;
  const team: Record<SlotKey, string[]> = { morning: [], evening: [], night: [] };
  const off: Record<string, number> = {};
  const covered = new Map<string, number>();
  for (const s of PUMP_SLOTS) {
    const runDays = Array.from({ length: 7 }, (_, d) => d).filter((d) => found.has(`${d}|${s.key}`));
    const on = (d: number) => found.get(`${d}|${s.key}`)!.memberIds ?? [];
    const count = new Map<string, number>();
    for (const d of runDays) for (const u of on(d)) count.set(u, (count.get(u) ?? 0) + 1);
    const base = [...count.entries()].filter(([, n]) => n * 2 > runDays.length).map(([u]) => u);
    team[s.key] = base;
    for (const d of runDays) {
      const people = on(d);
      for (const u of base.filter((b) => !people.includes(b))) if (off[u] == null) off[u] = d;
      for (const u of people.filter((p) => !base.includes(p))) covered.set(u, (covered.get(u) ?? 0) + 1);
    }
  }
  const members = new Set([...team.morning, ...team.evening, ...team.night]);
  const floater =
    [...covered.entries()].filter(([u]) => !members.has(u)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return fixOffs({ day: team.morning, evening: team.evening, night: team.night[0] ?? null, floater, off });
}

// Vardiyanın ait olduğu gün: tam gece yarısı başlayan vardiya bir önceki günün gecesidir (pompa 24–08).
export function serviceDay(startsAtMs: number): string {
  const day = new Date(startsAtMs + 3 * 3600000).toISOString().slice(0, 10);
  return istMs(day) === startsAtMs ? addDaysIso(day, -1) : day;
}
