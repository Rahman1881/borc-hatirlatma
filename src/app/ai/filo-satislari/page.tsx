"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import {
  Truck,
  RefreshCw,
  FolderOpen,
  Calendar,
  Download,
  ArrowLeft,
  Search,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import {
  VrdPeriodPicker,
  fmtDay,
  lt,
  tl,
  type CalendarDay,
  type VrdSelection,
} from "@/components/ai/vrd-period-picker";

type CustomerKind = "istasyon" | "acik_hesap" | "filo" | "diger";

type FleetRow = {
  ad: string;
  kodlar: string[];
  musteri: CustomerKind;
  tutar: number;
  litre: number;
  adet: number;
  plakaSayisi: number;
  ilkAlim: string;
  sonAlim: string;
};

type PlateRow = {
  plaka: string;
  tutar: number;
  litre: number;
  adet: number;
  yakitlar: string;
  ilkAlim: string;
  sonAlim: string;
};

type SaleRow = {
  iso: string;
  saat: string;
  plaka: string;
  yakit: string;
  litre: number;
  fiyat: number;
  tutar: number;
  pompa: string;
  fisNo: string;
};

const TIP_LABEL: Record<CustomerKind, string> = {
  istasyon: "İstasyon",
  acik_hesap: "Açık Hesap",
  filo: "Filo",
  diger: "Diğer",
};

// 'YYYY-AA-GG SS:DD:SS' -> '3 Kasım 2026 14:05'
function fmtWhen(when: string): string {
  const [d, t = ""] = when.split(" ");
  return `${fmtDay(d)} ${t.slice(0, 5)}`.trim();
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ai/filo-satislari", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || "Veri alınamadı.");
  return d as T;
}

export default function FiloSatislariPage() {
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [vrdDir, setVrdDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selection, setSelection] = useState<VrdSelection>({ files: [], label: "" });
  const [fleets, setFleets] = useState<FleetRow[] | null>(null);
  const [listing, setListing] = useState(false);
  const [query, setQuery] = useState("");

  const [fleet, setFleet] = useState<string>("");
  const [plates, setPlates] = useState<PlateRow[] | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [plateFilter, setPlateFilter] = useState("");

  const [exporting, setExporting] = useState<"" | "all" | "fleet">("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/satis-raporu");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Satış verisi alınamadı.");
      setCalendar(d.calendar as CalendarDay[]);
      setVrdDir(d.vrdDir as string);
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

  // Dönem değişince filo listesini (ve açık filo varsa plakalarını) yeniden çek.
  useEffect(() => {
    if (selection.files.length === 0) {
      setFleets(null);
      setPlates(null);
      setSales([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setListing(true);
      setError("");
      try {
        const d = await post<{ filolar: FleetRow[] }>({ action: "list", files: selection.files });
        if (!cancelled) setFleets(d.filolar);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Filo listesi alınamadı.");
      } finally {
        if (!cancelled) setListing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  useEffect(() => {
    if (!fleet || selection.files.length === 0) return;
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setError("");
      try {
        const d = await post<{ plakalar: PlateRow[]; fisler: SaleRow[] }>({
          action: "plates",
          files: selection.files,
          fleet,
        });
        if (!cancelled) {
          setPlates(d.plakalar);
          setSales(d.fisler);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Plakalar alınamadı.");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, filesKey]);

  function openFleet(ad: string) {
    setPlates(null);
    setSales([]);
    setPlateFilter("");
    setFleet(ad);
  }

  function closeFleet() {
    setFleet("");
    setPlates(null);
    setSales([]);
    setPlateFilter("");
  }

  async function exportExcel(which: "all" | "fleet") {
    setExporting(which);
    setError("");
    try {
      const res = await fetch("/api/ai/filo-satislari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "excel",
          files: selection.files,
          fleet: which === "fleet" ? fleet : undefined,
          label: selection.label,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Excel oluşturulamadı.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${which === "fleet" ? `Filo - ${fleet}` : "Filo Satışları"} - ${selection.label}.xlsx`
        .replace(/[\\/:*?"<>|]/g, " ");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Excel oluşturulamadı.");
    } finally {
      setExporting("");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!fleets) return [];
    if (!q) return fleets;
    return fleets.filter(
      (f) =>
        f.ad.toLocaleLowerCase("tr").includes(q) ||
        f.kodlar.some((k) => k.toLocaleLowerCase("tr").includes(q))
    );
  }, [fleets, query]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (t, f) => ({ tutar: t.tutar + f.tutar, litre: t.litre + f.litre, adet: t.adet + f.adet }),
        { tutar: 0, litre: 0, adet: 0 }
      ),
    [filtered]
  );

  const fleetRow = fleets?.find((f) => f.ad === fleet);
  const shownSales = plateFilter ? sales.filter((s) => s.plaka === plateFilter) : sales;

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-teal-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 text-white">
            <Truck className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Filo Satışları</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Seçilen dönemde yakıt alan tüm filo ve açık hesap müşterileri. Filoya tıklayınca
              plakaları listelenir.
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
        <Panel className="animate-pulse">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="mt-3 h-8 w-2/3 rounded bg-muted" />
        </Panel>
      ) : calendar.length === 0 ? (
        <Panel className="py-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Vardiya verisi bulunamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">
            VRD klasöründe okunabilir XML dosyası yok.
          </p>
          {vrdDir && (
            <p className="mt-2 text-xs text-muted-foreground/70">
              Klasör: <code>{vrdDir}</code>
            </p>
          )}
        </Panel>
      ) : (
        <>
          <VrdPeriodPicker calendar={calendar} onChange={setSelection} />

          {selection.files.length === 0 ? (
            <Panel className="py-10 text-center">
              <Calendar className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">Seçim boş</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Görüntülemek için en az bir vardiya/gün seçin.
              </p>
            </Panel>
          ) : fleet ? (
            <FleetDetail
              fleet={fleet}
              fleetRow={fleetRow}
              plates={plates}
              sales={shownSales}
              totalSales={sales.length}
              loading={detailLoading}
              plateFilter={plateFilter}
              setPlateFilter={setPlateFilter}
              exporting={exporting === "fleet"}
              onExport={() => exportExcel("fleet")}
              onBack={closeFleet}
            />
          ) : (
            <Panel>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filo adı veya kodu ara"
                    className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                {fleets && (
                  <span className="text-xs text-muted-foreground">
                    {filtered.length} müşteri · {totals.adet} fiş · {lt(totals.litre)} lt ·{" "}
                    <span className="font-semibold text-foreground">₺{tl(totals.tutar)}</span>
                  </span>
                )}
                <button
                  onClick={() => exportExcel("all")}
                  disabled={!fleets?.length || exporting !== ""}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                >
                  {exporting === "all" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Excel&apos;e aktar
                </button>
              </div>

              {listing && !fleets ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : !fleets || fleets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Bu dönemde filo / açık hesap satışı yok.
                </p>
              ) : (
                <div className={`overflow-x-auto ${listing ? "opacity-60 transition-opacity" : ""}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Müşteri</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">Kod</th>
                        <th className="px-3 py-2 text-right font-medium">Plaka</th>
                        <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Fiş</th>
                        <th className="px-3 py-2 text-right font-medium">Litre</th>
                        <th className="py-2 pl-3 text-right font-medium">Tutar</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((f) => (
                        <tr
                          key={f.ad}
                          onClick={() => openFleet(f.ad)}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                        >
                          <td className="py-2.5 pr-3">
                            <span className="font-medium">{f.ad}</span>
                            {f.musteri === "acik_hesap" && (
                              <span className="ml-2 align-middle">
                                <Pill>{TIP_LABEL[f.musteri]}</Pill>
                              </span>
                            )}
                          </td>
                          <td className="hidden px-3 py-2.5 text-xs text-muted-foreground sm:table-cell">
                            {f.kodlar.join(", ")}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {f.plakaSayisi}
                          </td>
                          <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                            {f.adet}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {lt(f.litre)}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-semibold tabular-nums">
                            ₺{tl(f.tutar)}
                          </td>
                          <td className="pl-2 text-muted-foreground">
                            <ChevronRight className="h-4 w-4" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function FleetDetail({
  fleet,
  fleetRow,
  plates,
  sales,
  totalSales,
  loading,
  plateFilter,
  setPlateFilter,
  exporting,
  onExport,
  onBack,
}: {
  fleet: string;
  fleetRow: FleetRow | undefined;
  plates: PlateRow[] | null;
  sales: SaleRow[];
  totalSales: number;
  loading: boolean;
  plateFilter: string;
  setPlateFilter: (p: string) => void;
  exporting: boolean;
  onExport: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Tüm filolar
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{fleet}</p>
            {fleetRow && (
              <p className="text-xs text-muted-foreground">
                {fleetRow.kodlar.join(", ")} · {fleetRow.plakaSayisi} plaka · {fleetRow.adet} fiş ·{" "}
                {lt(fleetRow.litre)} lt ·{" "}
                <span className="font-semibold text-foreground">₺{tl(fleetRow.tutar)}</span>
              </p>
            )}
          </div>
          <button
            onClick={onExport}
            disabled={!plates?.length || exporting}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Excel&apos;e aktar
          </button>
        </div>
      </Panel>

      {loading && !plates ? (
        <Panel className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </Panel>
      ) : !plates || plates.length === 0 ? (
        <Panel className="py-8 text-center text-sm text-muted-foreground">
          Bu dönemde bu filonun satışı yok.
        </Panel>
      ) : (
        <div className={`space-y-6 ${loading ? "opacity-60 transition-opacity" : ""}`}>
          <Panel>
            <p className="mb-1 text-sm font-semibold">Yakıt alan plakalar</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Bir plakaya tıklayınca aşağıdaki fiş listesi o plakaya göre süzülür.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Plaka</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Yakıt</th>
                    <th className="px-3 py-2 text-right font-medium">Fiş</th>
                    <th className="px-3 py-2 text-right font-medium">Litre</th>
                    <th className="px-3 py-2 text-right font-medium">Tutar</th>
                    <th className="hidden py-2 pl-3 text-right font-medium md:table-cell">Son alım</th>
                  </tr>
                </thead>
                <tbody>
                  {plates.map((p) => {
                    const on = plateFilter === p.plaka;
                    return (
                      <tr
                        key={p.plaka}
                        onClick={() => setPlateFilter(on ? "" : p.plaka)}
                        className={`cursor-pointer border-b last:border-0 ${
                          on ? "bg-primary/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="py-2.5 pr-3 font-medium tabular-nums">{p.plaka}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">
                          {p.yakitlar}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {p.adet}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {lt(p.litre)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                          ₺{tl(p.tutar)}
                        </td>
                        <td className="hidden py-2.5 pl-3 text-right text-xs text-muted-foreground md:table-cell">
                          {fmtWhen(p.sonAlim)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Fişler</p>
              <span className="text-xs text-muted-foreground">
                {sales.length}
                {plateFilter ? ` / ${totalSales}` : ""} fiş
              </span>
              {plateFilter && (
                <button
                  onClick={() => setPlateFilter("")}
                  className="flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  {plateFilter} <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tarih</th>
                    <th className="px-3 py-2 font-medium">Plaka</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Yakıt</th>
                    <th className="px-3 py-2 text-right font-medium">Litre</th>
                    <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Fiyat</th>
                    <th className="px-3 py-2 text-right font-medium">Tutar</th>
                    <th className="hidden py-2 pl-3 text-right font-medium md:table-cell">Pompa / Fiş</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s, i) => (
                    <tr key={`${s.iso}-${s.saat}-${s.fisNo}-${i}`} className="border-b last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                        {fmtWhen(`${s.iso} ${s.saat}`)}
                      </td>
                      <td className="px-3 py-2 font-medium tabular-nums">{s.plaka}</td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{s.yakit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{lt(s.litre)}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground md:table-cell">
                        {tl(s.fiyat)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">₺{tl(s.tutar)}</td>
                      <td className="hidden py-2 pl-3 text-right text-xs text-muted-foreground md:table-cell">
                        {s.pompa} / {s.fisNo}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
