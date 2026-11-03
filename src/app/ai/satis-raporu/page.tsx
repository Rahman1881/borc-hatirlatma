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
  FolderOpen,
  Calendar,
} from "lucide-react";
import {
  VrdPeriodPicker,
  lt,
  tl,
  type CalendarDay,
  type VrdSelection,
} from "@/components/ai/vrd-period-picker";

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

type Data = {
  calendar: CalendarDay[];
  vrdDir: string;
};

const FUEL_TONE: Record<FuelKind, string> = {
  motorin: "from-sky-500 to-blue-500",
  benzin: "from-amber-500 to-orange-500",
  lpg: "from-emerald-500 to-green-500",
  adblue: "from-cyan-500 to-teal-500",
  diger: "from-slate-500 to-gray-500",
};

export default function SatisRaporuPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selection, setSelection] = useState<VrdSelection>({ files: [], label: "" });

  const [summary, setSummary] = useState<Aggregation | null>(null);
  const [summarizing, setSummarizing] = useState(false);

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

  const filesKey = selection.files.slice().sort().join("|");

  // Seçim değişince özet çek.
  useEffect(() => {
    if (calendar.length === 0) return;
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
          <VrdPeriodPicker calendar={calendar} onChange={setSelection} />

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
              <SummaryView summary={summary} maxHour={maxHour} />
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
}: {
  summary: Aggregation;
  maxHour: number;
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
