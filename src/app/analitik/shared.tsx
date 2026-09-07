"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ai/ui";
import {
  Users,
  Calendar,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  Database,
  RefreshCw,
} from "lucide-react";

// ————————————————————————————————————————————————————————————
// Ortak yardımcılar
// ————————————————————————————————————————————————————————————
export function tl(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
export function tl2(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Yakıt etiketine göre renk tonu.
export function fuelTone(label: string): string {
  const s = label.toLocaleLowerCase("tr");
  if (s.includes("motorin")) return "from-sky-500 to-blue-500";
  if (s.includes("benzin")) return "from-amber-500 to-orange-500";
  if (s.includes("lpg") || s.includes("otogaz")) return "from-emerald-500 to-green-500";
  if (s.includes("adblue")) return "from-cyan-500 to-teal-500";
  return "from-slate-500 to-gray-500";
}

// ————————————————————————————————————————————————————————————
// Tipler (API ile uyumlu)
// ————————————————————————————————————————————————————————————
export type Period = "gun" | "hafta" | "ay" | "ozel";
export type DateRange = { from: string; to: string };
export type Segment = "sadik" | "yeni" | "kacan";

export type PlateRow = {
  plaka: string;
  ziyaret: number;
  litre: number;
  ciro: number;
  iskonto: number;
  sonZiyaret: string;
  segment: Segment;
  temsilci: string;
};

export type PlateBrief = {
  plaka: string;
  ziyaret: number;
  ciro: number;
  iskonto: number;
  sonZiyaret: string;
  ilkZiyaret: string;
  gunGecti: number;
};

export type Overview = {
  refDate: string;
  refLabel: string;
  period: Period;
  periodLabel: string;
  kpi: {
    musteri: number;
    ilkDefa: number;
    iskontoluOran: number;
    iskontoCiro: number;
    ortIskonto: number;
    toplamCiro: number;
    toplamLitre: number;
  };
  fuelDiscounts: { yakit: string; listeFiyat: number; ortSatis: number; litre: number; vazgecilenCiro: number }[];
  fuelDemand: { yakit: string; litre: number; pct: number }[];
  topAttendants: { ad: string; iskonto: number; islem: number }[];
  dailyTrend: { gun: string; iso: string; ciro: number }[];
  segments: { sadik: number; yeni: number; kacan: number };
  segmentPlates: { sadik: PlateBrief[]; yeni: PlateBrief[]; kacan: PlateBrief[] };
  topPlates: PlateRow[];
  topByCiro: PlateRow[];
  hourly: { hour: number; adet: number; litre: number }[];
  weekday: { gun: string; adet: number; litre: number }[];
  patternLabel: string;
};

export type Profile = {
  plaka: string;
  ilkZiyaret: string;
  sonZiyaret: string;
  ziyaret: number;
  ortAralik: string;
  toplamLitre: number;
  toplamCiro: number;
  toplamIskonto: number;
  segment: "Sadık" | "Yeni" | "Kaçan";
  temsilci: string;
  saatTercihi: string;
  yakitKarma: { yakit: string; pct: number }[];
  aylikTrend: { ay: string; adet: number }[];
  gecmis: { tarih: string; yakit: string; litre: number; tutar: number; iskonto: number }[];
};

export const PERIODS: { key: Period; label: string; icon: typeof Calendar }[] = [
  { key: "gun", label: "Bugün", icon: Calendar },
  { key: "hafta", label: "Bu Hafta", icon: CalendarDays },
  { key: "ay", label: "Bu Ay", icon: CalendarRange },
  { key: "ozel", label: "Tarih Aralığı", icon: CalendarClock },
];

export const SEG_PILL: Record<Segment, { tone: "positive" | "primary" | "negative"; label: string }> = {
  sadik: { tone: "positive", label: "Sadık" },
  yeni: { tone: "primary", label: "Yeni" },
  kacan: { tone: "negative", label: "Kaçan" },
};

// ————————————————————————————————————————————————————————————
// Dönem seçimi — menüler arası kalıcı (localStorage)
// ————————————————————————————————————————————————————————————
const PERIOD_KEY = "analitik_period";
const RANGE_KEY = "analitik_range";
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function usePeriod(): {
  period: Period;
  setPeriod: (p: Period) => void;
  range: DateRange;
  setRange: (r: DateRange) => void;
} {
  const [period, setPeriodState] = useState<Period>("gun");
  const [range, setRangeState] = useState<DateRange>({ from: "", to: "" });
  useEffect(() => {
    const saved = localStorage.getItem(PERIOD_KEY);
    if (saved === "gun" || saved === "hafta" || saved === "ay" || saved === "ozel") setPeriodState(saved);
    const savedRange = localStorage.getItem(RANGE_KEY);
    if (savedRange) {
      try {
        const r = JSON.parse(savedRange);
        if (ISO_RE.test(r?.from) && ISO_RE.test(r?.to)) setRangeState({ from: r.from, to: r.to });
      } catch {
        /* yoksay */
      }
    }
  }, []);
  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    localStorage.setItem(PERIOD_KEY, p);
  }, []);
  const setRange = useCallback((r: DateRange) => {
    setRangeState(r);
    localStorage.setItem(RANGE_KEY, JSON.stringify(r));
  }, []);
  return { period, setPeriod, range, setRange };
}

// ————————————————————————————————————————————————————————————
// Veri akışı: durum kontrolü, dönem yükleme, senkron
// ————————————————————————————————————————————————————————————
export type AnalitikState = {
  hasData: boolean | null;
  period: Period;
  setPeriod: (p: Period) => void;
  range: DateRange;
  setRange: (r: DateRange) => void;
  overview: Overview | null;
  loading: boolean;
  error: string;
  syncing: boolean;
  syncMsg: string;
  runSync: () => Promise<void>;
};

// Özel aralık seçili ama henüz iki tarih de girilmemişse veri çekmeyiz.
function rangeReady(period: Period, range: DateRange): boolean {
  return period !== "ozel" || (!!range.from && !!range.to);
}

export function useAnalitik(): AnalitikState {
  const [hasData, setHasData] = useState<boolean | null>(null);
  const { period, setPeriod, range, setRange } = usePeriod();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    fetch("/api/analitik?view=status")
      .then((r) => r.json())
      .then((d) => setHasData(!!d.hasData))
      .catch(() => setHasData(false));
  }, []);

  const loadOverview = useCallback(async (p: Period, r: DateRange) => {
    setLoading(true);
    setError("");
    try {
      let url = `/api/analitik?period=${p}`;
      if (p === "ozel" && r.from && r.to) url += `&from=${r.from}&to=${r.to}`;
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Veri alınamadı.");
      setOverview(d.overview as Overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veri alınamadı.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasData && rangeReady(period, range)) loadOverview(period, range);
  }, [hasData, period, range, loadOverview]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg("Klasör taranıyor…");
    setError("");
    try {
      const res = await fetch("/api/analitik/sync", { method: "POST" });
      if (!res.body) throw new Error("Akış başlatılamadı.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "progress") {
            const pct = evt.total ? Math.round(((evt.processed + evt.skipped) / evt.total) * 100) : 0;
            setSyncMsg(`Aktarılıyor… %${pct} (${evt.processed + evt.skipped}/${evt.total} dosya, ${tl(evt.inserted)} satış)`);
          } else if (evt.type === "done") {
            setSyncMsg(`Tamamlandı: ${evt.processed} yeni dosya, ${tl(evt.inserted)} satış aktarıldı.`);
          } else if (evt.type === "error") {
            throw new Error(evt.error);
          }
        }
      }
      setHasData(true);
      if (rangeReady(period, range)) await loadOverview(period, range);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senkron başarısız.");
    } finally {
      setSyncing(false);
    }
  }, [loadOverview, period, range]);

  return { hasData, period, setPeriod, range, setRange, overview, loading, error, syncing, syncMsg, runSync };
}

// ————————————————————————————————————————————————————————————
// Kabuk: başlık + ilk açılış/senkron + dönem sekmeleri
// ————————————————————————————————————————————————————————————
export function AnalitikShell({
  state,
  title,
  subtitle,
  icon,
  showPeriod = true,
  children,
}: {
  state: AnalitikState;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  showPeriod?: boolean;
  children: (overview: Overview) => React.ReactNode;
}) {
  const { hasData, period, setPeriod, range, setRange, overview, loading, error, syncing, syncMsg, runSync } = state;

  // Tarih aralığı giriş taslağı — "Uygula"ya basılınca gerçek aralığa yazılır.
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  useEffect(() => {
    setDraftFrom(range.from || overview?.refDate || "");
    setDraftTo(range.to || overview?.refDate || "");
  }, [range.from, range.to, overview?.refDate]);
  const applyRange = () => {
    if (draftFrom && draftTo) setRange({ from: draftFrom, to: draftTo });
  };
  const rangeDirty = draftFrom !== range.from || draftTo !== range.to;

  const header = (
    <Panel className="bg-gradient-to-r from-violet-500/10 via-card to-card">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          {icon}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {subtitle}
            {overview?.refLabel ? <span className="ml-1">· Son veri: {overview.refLabel}</span> : null}
          </p>
        </div>
        {hasData && (
          <button
            onClick={runSync}
            disabled={syncing}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Güncelle
          </button>
        )}
      </div>
    </Panel>
  );

  // İlk açılış / senkron ekranı
  if (hasData === false || (hasData === null && !overview)) {
    return (
      <div className="space-y-6">
        {header}
        <Panel className="py-10 text-center">
          {hasData === null ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (
            <>
              <Database className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-semibold">VRD verisi henüz aktarılmadı</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Analiz, VRD vardiya dosyalarının tek seferlik veritabanına aktarılmasıyla çalışır.
                Sonraki açılışlarda yalnız yeni dosyalar işlenir; tarama anlık olur.
              </p>
              {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
              {syncMsg && <p className="mt-3 text-sm text-muted-foreground">{syncMsg}</p>}
              <button
                onClick={runSync}
                disabled={syncing}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Aktarılıyor…" : "Verileri Aktar"}
              </button>
            </>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {syncMsg && !syncing && (
        <Panel className="border-emerald-500/30 bg-emerald-500/5 py-3">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{syncMsg}</p>
        </Panel>
      )}

      {showPeriod && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => {
              const on = p.key === period;
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {p.label}
                </button>
              );
            })}
          </div>

          {period === "ozel" && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Başlangıç</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={overview?.refDate || undefined}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Bitiş</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  max={overview?.refDate || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
              <button
                onClick={applyRange}
                disabled={!draftFrom || !draftTo || !rangeDirty}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
              >
                Uygula
              </button>
              {overview?.refLabel && (
                <span className="ml-auto self-center text-xs text-muted-foreground">
                  en son veri: {overview.refLabel}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showPeriod && period === "ozel" && !rangeReady(period, range) ? (
        <p className="text-xs text-muted-foreground">
          Analiz için bir başlangıç ve bitiş tarihi seçip <span className="font-medium text-foreground">Uygula</span>&apos;ya basın.
        </p>
      ) : (
        showPeriod &&
        overview && (
          <p className="text-xs text-muted-foreground">
            Dönem: <span className="font-medium text-foreground">{overview.periodLabel}</span>
            {" · "}en son veri günü {overview.refLabel}
          </p>
        )
      )}

      {error && (
        <Panel className="border-red-500/30 bg-red-500/5">
          <p className="text-sm font-medium text-red-600">{error}</p>
        </Panel>
      )}

      {!overview ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className="animate-pulse">
              <div className="h-4 w-1/2 rounded bg-muted" />
              <div className="mt-3 h-6 w-2/3 rounded bg-muted" />
            </Panel>
          ))}
        </div>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>{children(overview)}</div>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————————————————
// Ortak sunum bileşenleri
// ————————————————————————————————————————————————————————————
export function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${tone} text-white`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground/70">{sub}</p>
        </div>
      </div>
    </Panel>
  );
}

export function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${accent ?? ""}`}>{value}</p>
    </Panel>
  );
}

// Bir plakaya tıklandığında plaka detay sayfasına götürür.
export function plateHref(plaka: string): string {
  return `/analitik/plakalar?plaka=${encodeURIComponent(plaka)}`;
}
