"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import { Calendar, CalendarDays, CalendarRange } from "lucide-react";

// Pompa satış (VRD) sayfalarının ortak dönem seçicisi: gün (vardiya seçimli),
// hafta, ay veya tarih aralığı seçtirip vardiya dosyalarına çevirir.

export type CalendarDay = {
  iso: string;
  tarih: string;
  vardiyalar: {
    no: string;
    file: string;
    toplamTutar: number;
    toplamLitre: number;
    fisAdedi: number;
  }[];
};

export type VrdSelection = { files: string[]; label: string };

type Mode = "gun" | "hafta" | "ay" | "aralik";

const MODES: { key: Mode; label: string; icon: typeof Calendar }[] = [
  { key: "gun", label: "Gün", icon: Calendar },
  { key: "hafta", label: "Hafta", icon: CalendarDays },
  { key: "ay", label: "Ay", icon: CalendarDays },
  { key: "aralik", label: "Tarih Aralığı", icon: CalendarRange },
];

export const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export function tl(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function lt(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function toIso(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function mondayOf(iso: string): string {
  const dt = isoToDate(iso);
  const dow = (dt.getDay() + 6) % 7; // Pazartesi = 0
  dt.setDate(dt.getDate() - dow);
  return toIso(dt);
}
export function fmtDay(iso: string): string {
  const dt = isoToDate(iso);
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtDayShort(iso: string): string {
  const dt = isoToDate(iso);
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]}`;
}

export function VrdPeriodPicker({
  calendar,
  onChange,
}: {
  calendar: CalendarDay[];
  onChange: (selection: VrdSelection) => void;
}) {
  const [mode, setMode] = useState<Mode>("gun");
  const [selDay, setSelDay] = useState<string>(""); // iso
  const [dayFiles, setDayFiles] = useState<Set<string>>(new Set());
  const [selWeek, setSelWeek] = useState<string>(""); // pazartesi iso
  const [selMonth, setSelMonth] = useState<string>(""); // YYYY-MM
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  // Haftalar (pazartesi başlangıçlı) ve aylar mevcut günlerden türetilir.
  const weeks = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of calendar) {
      const mon = mondayOf(d.iso);
      const arr = map.get(mon) || [];
      arr.push(d.iso);
      map.set(mon, arr);
    }
    return Array.from(map.entries())
      .map(([monday, days]) => ({ monday, days }))
      .sort((a, b) => (a.monday < b.monday ? 1 : -1));
  }, [calendar]);

  const months = useMemo(() => {
    const set = new Set(calendar.map((d) => d.iso.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [calendar]);

  // Takvim yüklenince varsayılan seçimleri kur (en yeni gün, tüm vardiyaları).
  useEffect(() => {
    if (calendar.length === 0) return;
    const latest = calendar[0];
    setSelDay(latest.iso);
    setDayFiles(new Set(latest.vardiyalar.map((v) => v.file)));
    setSelWeek(weeks[0]?.monday ?? "");
    setSelMonth(months[0] ?? "");
    setRangeFrom(calendar[calendar.length - 1].iso);
    setRangeTo(calendar[0].iso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar]);

  // Gün değişince o günün tüm vardiyaları seçili gelsin.
  function pickDay(iso: string) {
    setSelDay(iso);
    const day = calendar.find((d) => d.iso === iso);
    setDayFiles(new Set(day?.vardiyalar.map((v) => v.file) ?? []));
  }

  function toggleShift(file: string) {
    setDayFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  // Aktif seçimi dosya listesine ve etikete çevir.
  const selection = useMemo<{ files: string[]; label: string }>(() => {
    if (mode === "gun") {
      const day = calendar.find((d) => d.iso === selDay);
      if (!day) return { files: [], label: "" };
      const chosen = day.vardiyalar.filter((v) => dayFiles.has(v.file));
      const all = chosen.length === day.vardiyalar.length;
      const shiftPart = all
        ? "Tüm vardiyalar"
        : chosen.map((v) => `${v.no}. Vardiya`).join(", ");
      return {
        files: chosen.map((v) => v.file),
        label: `${fmtDay(day.iso)} · ${shiftPart || "Vardiya seçilmedi"}`,
      };
    }
    if (mode === "hafta") {
      const w = weeks.find((x) => x.monday === selWeek);
      if (!w) return { files: [], label: "" };
      const days = calendar.filter((d) => w.days.includes(d.iso));
      const sunday = toIso(
        new Date(isoToDate(w.monday).getTime() + 6 * 86400000)
      );
      return {
        files: days.flatMap((d) => d.vardiyalar.map((v) => v.file)),
        label: `Hafta · ${fmtDayShort(w.monday)} – ${fmtDay(sunday)}`,
      };
    }
    if (mode === "ay") {
      const days = calendar.filter((d) => d.iso.slice(0, 7) === selMonth);
      const [y, m] = selMonth.split("-").map(Number);
      const lbl = selMonth ? `${TR_MONTHS[m - 1]} ${y}` : "";
      return {
        files: days.flatMap((d) => d.vardiyalar.map((v) => v.file)),
        label: lbl ? `Ay · ${lbl}` : "",
      };
    }
    // aralik
    if (!rangeFrom || !rangeTo) return { files: [], label: "" };
    const lo = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const hi = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    const days = calendar.filter((d) => d.iso >= lo && d.iso <= hi);
    return {
      files: days.flatMap((d) => d.vardiyalar.map((v) => v.file)),
      label: `${fmtDay(lo)} – ${fmtDay(hi)}`,
    };
  }, [mode, calendar, selDay, dayFiles, weeks, selWeek, selMonth, rangeFrom, rangeTo]);

  useEffect(() => {
    onChange(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const dayObj = calendar.find((d) => d.iso === selDay);

  return (
    <Panel>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => {
          const on = m.key === mode;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                on
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {m.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t pt-4">
        {mode === "gun" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Tarih
              </label>
              <select
                value={selDay}
                onChange={(e) => pickDay(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm sm:w-72"
              >
                {calendar.map((d) => (
                  <option key={d.iso} value={d.iso}>
                    {fmtDay(d.iso)}
                  </option>
                ))}
              </select>
            </div>
            {dayObj && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Vardiyalar (tıklayarak seç/kaldır)
                </label>
                <div className="flex flex-wrap gap-2">
                  {dayObj.vardiyalar.map((v) => {
                    const on = dayFiles.has(v.file);
                    return (
                      <button
                        key={v.file}
                        onClick={() => toggleShift(v.file)}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          on
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {v.no}. Vardiya
                        <span className="ml-1.5 text-xs opacity-70">
                          ₺{tl(v.toplamTutar)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "hafta" && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Hafta
            </label>
            <select
              value={selWeek}
              onChange={(e) => setSelWeek(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm sm:w-72"
            >
              {weeks.map((w) => {
                const sunday = toIso(
                  new Date(isoToDate(w.monday).getTime() + 6 * 86400000)
                );
                return (
                  <option key={w.monday} value={w.monday}>
                    {fmtDayShort(w.monday)} – {fmtDay(sunday)}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {mode === "ay" && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Ay
            </label>
            <select
              value={selMonth}
              onChange={(e) => setSelMonth(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm sm:w-72"
            >
              {months.map((mo) => {
                const [y, m] = mo.split("-").map(Number);
                return (
                  <option key={mo} value={mo}>
                    {TR_MONTHS[m - 1]} {y}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {mode === "aralik" && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Başlangıç
              </label>
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Bitiş
              </label>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {selection.label && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Pill tone="primary">{selection.label}</Pill>
          {selection.files.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {selection.files.length} vardiya
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
