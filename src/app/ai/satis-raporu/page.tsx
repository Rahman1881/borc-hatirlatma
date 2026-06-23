"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import {
  BarChart3,
  RefreshCw,
  Fuel,
  Receipt,
  Droplet,
  Clock,
  Users,
  Truck,
  Sparkles,
  FolderOpen,
  Calendar,
  CalendarDays,
  CalendarRange,
} from "lucide-react";

type FuelKind = "motorin" | "benzin" | "lpg" | "adblue" | "diger";
type CustomerKind = "istasyon" | "acik_hesap" | "filo" | "diger";

type Aggregation = {
  toplamTutar: number;
  toplamLitre: number;
  fisAdedi: number;
  yakitlar: { yakit: FuelKind; label: string; litre: number; tutar: number; adet: number }[];
  pompalar: { pompa: string; litre: number; tutar: number; adet: number }[];
  saatler: { saat: number; tutar: number; adet: number }[];
  musteriTipi: { tip: CustomerKind; label: string; tutar: number; adet: number }[];
  topFilolar: { ad: string; tutar: number; litre: number; adet: number }[];
};

type CalendarDay = {
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

type Data = {
  calendar: CalendarDay[];
  vrdDir: string;
  geminiConfigured: boolean;
};

type Mode = "gun" | "hafta" | "ay" | "aralik";

const MODES: { key: Mode; label: string; icon: typeof Calendar }[] = [
  { key: "gun", label: "Gün", icon: Calendar },
  { key: "hafta", label: "Hafta", icon: CalendarDays },
  { key: "ay", label: "Ay", icon: CalendarDays },
  { key: "aralik", label: "Tarih Aralığı", icon: CalendarRange },
];

const FUEL_TONE: Record<FuelKind, string> = {
  motorin: "from-sky-500 to-blue-500",
  benzin: "from-amber-500 to-orange-500",
  lpg: "from-emerald-500 to-green-500",
  adblue: "from-cyan-500 to-teal-500",
  diger: "from-slate-500 to-gray-500",
};

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function tl(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function lt(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toIso(dt: Date): string {
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
function fmtDay(iso: string): string {
  const dt = isoToDate(iso);
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtDayShort(iso: string): string {
  const dt = isoToDate(iso);
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]}`;
}

export default function SatisRaporuPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<Mode>("gun");
  const [selDay, setSelDay] = useState<string>(""); // iso
  const [dayFiles, setDayFiles] = useState<Set<string>>(new Set());
  const [selWeek, setSelWeek] = useState<string>(""); // pazartesi iso
  const [selMonth, setSelMonth] = useState<string>(""); // YYYY-MM
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  const [summary, setSummary] = useState<Aggregation | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  // data?.calendar her render'da yeni dizi üretmesin diye memolanır (useMemo bağımlılıkları kararlı kalsın).
  const calendar = useMemo(() => data?.calendar ?? [], [data]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/satis-raporu");
      const d = (await res.json()) as Data & { error?: string };
      if (!res.ok) throw new Error(d.error || "Satış verisi alınamadı.");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
  }, [data]);

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

  const filesKey = selection.files.slice().sort().join("|");

  // Seçim değişince özet çek.
  useEffect(() => {
    if (calendar.length === 0) return;
    setAnalysis("");
    if (selection.files.length === 0) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSummarizing(true);
      setError("");
      try {
        const res = await fetch("/api/ai/satis-raporu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "summary", files: selection.files }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Özet alınamadı.");
        if (!cancelled) setSummary(d.summary as Aggregation);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Özet alınamadı.");
      } finally {
        if (!cancelled) setSummarizing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  const maxHour = useMemo(
    () => Math.max(1, ...(summary?.saatler.map((h) => h.tutar) ?? [1])),
    [summary]
  );

  async function runAnalysis() {
    if (selection.files.length === 0) return;
    setAnalyzing(true);
    setError("");
    setAnalysis("");
    try {
      const res = await fetch("/api/ai/satis-raporu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          files: selection.files,
          label: selection.label,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Analiz başarısız.");
      setAnalysis(d.analysis || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analiz yapılamadı.");
    } finally {
      setAnalyzing(false);
    }
  }

  const dayObj = calendar.find((d) => d.iso === selDay);

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-indigo-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Pompa Satış Raporu</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Gün, hafta, ay veya tarih aralığı seç; istersen vardiyalara böl.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </Panel>

      {error && (
        <Panel className="border-red-500/30 bg-red-500/5">
          <p className="text-sm font-medium text-red-600">{error}</p>
        </Panel>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Panel key={i} className="animate-pulse">
              <div className="h-4 w-1/2 rounded bg-muted" />
              <div className="mt-3 h-6 w-2/3 rounded bg-muted" />
            </Panel>
          ))}
        </div>
      ) : calendar.length === 0 ? (
        <Panel className="py-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Vardiya verisi bulunamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">
            VRD klasöründe okunabilir XML dosyası yok.
          </p>
          {data?.vrdDir && (
            <p className="mt-2 text-xs text-muted-foreground/70">
              Klasör: <code>{data.vrdDir}</code>
            </p>
          )}
        </Panel>
      ) : (
        <>
          {/* Dönem seçici */}
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

          {selection.files.length === 0 ? (
            <Panel className="py-10 text-center">
              <Calendar className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">Seçim boş</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Görüntülemek için en az bir vardiya/gün seçin.
              </p>
            </Panel>
          ) : summarizing && !summary ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Panel key={i} className="animate-pulse">
                  <div className="h-4 w-1/2 rounded bg-muted" />
                  <div className="mt-3 h-6 w-2/3 rounded bg-muted" />
                </Panel>
              ))}
            </div>
          ) : summary ? (
            <div className={summarizing ? "opacity-60 transition-opacity" : ""}>
              <SummaryView
                summary={summary}
                maxHour={maxHour}
                geminiConfigured={data?.geminiConfigured ?? false}
                analysis={analysis}
                analyzing={analyzing}
                onAnalyze={runAnalysis}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SummaryView({
  summary,
  maxHour,
  geminiConfigured,
  analysis,
  analyzing,
  onAnalyze,
}: {
  summary: Aggregation;
  maxHour: number;
  geminiConfigured: boolean;
  analysis: string;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Özet kartları */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Toplam Ciro"
          value={`₺${tl(summary.toplamTutar)}`}
          tone="from-indigo-500 to-violet-500"
        />
        <StatCard
          icon={<Droplet className="h-5 w-5" />}
          label="Toplam Litre"
          value={`${lt(summary.toplamLitre)} lt`}
          tone="from-sky-500 to-blue-500"
        />
        <StatCard
          icon={<Fuel className="h-5 w-5" />}
          label="Fiş Adedi"
          value={String(summary.fisAdedi)}
          tone="from-emerald-500 to-green-500"
        />
      </div>

      {/* Yakıt dağılımı */}
      <Panel>
        <p className="mb-4 text-sm font-semibold">Yakıt Bazlı Satış</p>
        <div className="space-y-3">
          {summary.yakitlar.map((f) => {
            const pct =
              summary.toplamTutar > 0 ? (f.tutar / summary.toplamTutar) * 100 : 0;
            return (
              <div key={f.yakit}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${FUEL_TONE[f.yakit]}`}
                    />
                    {f.label}
                    <span className="text-xs text-muted-foreground">
                      {lt(f.litre)} lt · {f.adet} fiş
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">₺{tl(f.tutar)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${FUEL_TONE[f.yakit]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Saatlik yoğunluk */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Saatlik Ciro Yoğunluğu</p>
        </div>
        <div className="flex items-end gap-1.5" style={{ height: 140 }}>
          {summary.saatler.map((h) => (
            <div
              key={h.saat}
              className="group flex flex-1 flex-col items-center justify-end gap-1"
              title={`${String(h.saat).padStart(2, "0")}:00 — ₺${tl(h.tutar)} (${h.adet} fiş)`}
            >
              <div
                className="w-full rounded-t bg-gradient-to-t from-indigo-500/60 to-violet-500 transition-opacity group-hover:opacity-80"
                style={{ height: `${(h.tutar / maxHour) * 110}px` }}
              />
              <span className="text-[10px] text-muted-foreground">
                {String(h.saat).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Müşteri tipi */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Müşteri Tipi Dağılımı</p>
          </div>
          <div className="space-y-3">
            {summary.musteriTipi.map((c) => {
              const pct =
                summary.toplamTutar > 0 ? (c.tutar / summary.toplamTutar) * 100 : 0;
              return (
                <div key={c.tip} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{c.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{c.adet} fiş</span>
                    <span className="text-sm font-semibold tabular-nums">
                      ₺{tl(c.tutar)}
                    </span>
                    <Pill tone="neutral">%{pct.toFixed(0)}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Pompa dağılımı */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Fuel className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Pompa Dağılımı</p>
          </div>
          <div className="space-y-2">
            {summary.pompalar.map((p) => (
              <div key={p.pompa} className="flex items-center justify-between text-sm">
                <span className="font-medium">Pompa {p.pompa}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {lt(p.litre)} lt · {p.adet} fiş
                  </span>
                  <span className="font-semibold tabular-nums">₺{tl(p.tutar)}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* En çok alan filolar */}
      {summary.topFilolar.length > 0 && (
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">
              En Çok Alan Filo / Açık Hesap Müşterileri
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Müşteri</th>
                  <th className="px-3 py-2 text-right font-medium">Litre</th>
                  <th className="px-3 py-2 text-right font-medium">Fiş</th>
                  <th className="py-2 pl-3 text-right font-medium">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {summary.topFilolar.map((f) => (
                  <tr key={f.ad} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{f.ad}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {lt(f.litre)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {f.adet}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-semibold tabular-nums">
                      ₺{tl(f.tutar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* AI yorum */}
      <Panel>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold">AI Dönem Yorumu</p>
          </div>
          <button
            onClick={onAnalyze}
            disabled={analyzing || !geminiConfigured}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />{" "}
            {analyzing ? "Analiz ediliyor…" : "Analiz Et"}
          </button>
        </div>
        {!geminiConfigured && (
          <p className="mt-2 text-xs text-muted-foreground">
            AI yorumu için Ayarlar &gt; Yapay Zeka bölümünden Gemini anahtarını girin.
          </p>
        )}
        {analysis ? (
          <div className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-3 text-sm leading-relaxed">
            {analysis}
          </div>
        ) : (
          !analyzing && (
            <p className="mt-3 text-sm text-muted-foreground">
              Seçili dönemin satış özetini AI ile yorumlayın.
            </p>
          )
        )}
      </Panel>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${tone} text-white`}
        >
          {icon}
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </div>
    </Panel>
  );
}
