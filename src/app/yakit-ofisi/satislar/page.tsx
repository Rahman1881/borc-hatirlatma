"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerCell, ErrorNote, groupFilter, FetchedAt, PageHeader, fmtDate, fmtNum, fmtTL, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type SelectFilter, type ToggleFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type SalesRow = {
  dimensionID?: number | null;
  dimensionName?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  count: number;
  quantity: number;
  amountDiscounted: number;
  previousCount?: number | null;
  previousQuantity?: number | null;
  previousAmountDiscounted?: number | null;
  amountDiscountedChange?: number | null;
  groups?: string[] | null;
};

type Summary = {
  totals: Section<SalesRow>;
  series: Section<SalesRow[]>;
  groups: Section<SalesRow[]>;
  bucket: "Day" | "Month";
  group: string;
  range: { from: string; to: string; days: number };
  compareRange: { from: string; to: string };
  fetchedAt: number;
};

type Purchase = {
  id: number;
  fleetID: number;
  fleetCode?: string | null;
  fleetName?: string | null;
  plate?: string | null;
  fuelType?: number | string;
  liter?: number;
  unitPrice?: number;
  totalAmountDiscounted?: number;
  processDate: string;
  dealer?: { name?: string | null; city?: string | null; innerCity?: string | null } | null;
  groups?: string[] | null;
};

// --- Tarih aralıkları (tarayıcının yerel saatiyle, hafta pazartesi başlar) ---

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function presetRange(key: string): { from: string; to: string } {
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = shift(t, -((t.getDay() + 6) % 7));
  switch (key) {
    case "dun":
      return { from: iso(shift(t, -1)), to: iso(shift(t, -1)) };
    case "hafta":
      return { from: iso(monday), to: iso(t) };
    case "gecenHafta":
      return { from: iso(shift(monday, -7)), to: iso(shift(monday, -1)) };
    case "ay":
      return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
    case "gecenAy":
      return {
        from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: iso(new Date(t.getFullYear(), t.getMonth(), 0)),
      };
    case "son30":
      return { from: iso(shift(t, -29)), to: iso(t) };
    case "yil":
      return { from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) };
    default:
      return { from: iso(t), to: iso(t) };
  }
}

const PRESETS = [
  ["bugun", "Bugün"],
  ["dun", "Dün"],
  ["hafta", "Bu hafta"],
  ["gecenHafta", "Geçen hafta"],
  ["ay", "Bu ay"],
  ["gecenAy", "Geçen ay"],
  ["son30", "Son 30 gün"],
  ["yil", "Bu yıl"],
] as const;

const TYPES = [
  ["Fuel", "Akaryakıt"],
  ["AdBlue", "AdBlue"],
  ["Toll", "HGS"],
  ["", "Hepsi"],
] as const;

const GROUP_TABS = [
  ["Customer", "Müşteriler"],
  ["City", "İller"],
  ["Dealer", "İstasyonlar"],
  ["Plate", "Plakalar"],
] as const;

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const FUEL_NAMES: Record<string, string> = {
  "0": "Kurşunsuz 95",
  "1": "ProDiesel",
  "2": "EuroDiesel",
  "31": "AdBlue",
  "37": "HGS",
  "45": "HGS etiket",
  Benzine95: "Kurşunsuz 95",
  ProDiesel: "ProDiesel",
  EuroDiesel: "EuroDiesel",
  PoAdBlue: "AdBlue",
  Toll: "HGS",
  TollTag: "HGS etiket",
};
const fuelName = (v?: number | string) => (v == null ? "—" : FUEL_NAMES[String(v)] ?? String(v));

const fmtCompactTL = (n: number) =>
  Math.abs(n) >= 1e6
    ? `₺${fmtNum(n / 1e6, 1)} Mn`
    : Math.abs(n) >= 1e3
      ? `₺${fmtNum(n / 1e3, 0)} B`
      : `₺${fmtNum(n, 0)}`;

const pct = (now: number, prev?: number | null) => (prev ? ((now - prev) / prev) * 100 : null);

function Change({ now, prev, money = true }: { now: number; prev?: number | null; money?: boolean }) {
  if (prev == null) return <span className="text-muted-foreground">—</span>;
  const diff = now - prev;
  const p = pct(now, prev);
  if (Math.abs(diff) < 0.5) return <span className="text-muted-foreground">0</span>;
  const up = diff > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? "text-emerald-700" : "text-destructive"}`}>
      <Icon className="h-3.5 w-3.5" />
      {money ? fmtTL(Math.abs(diff)) : fmtNum(Math.abs(diff))}
      {p != null && <span className="text-xs">({up ? "+" : "−"}%{fmtNum(Math.abs(p), 1)})</span>}
    </span>
  );
}

function Stat({ title, value, sub }: { title: string; value: string; sub?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Grafik serisini boş günler/aylar sıfırla doldurarak kurar.
function buildSeries(rows: SalesRow[], bucket: "Day" | "Month", from: string, to: string) {
  const key = (y: number, m: number, d?: number) => `${y}-${m}-${d ?? 0}`;
  const byKey = new Map(rows.map((r) => [key(r.year ?? 0, r.month ?? 0, bucket === "Day" ? r.day ?? 0 : undefined), r]));
  const out: { label: string; full: string; amount: number; quantity: number; count: number }[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (bucket === "Day") {
    for (let d = start; d <= end; d = shift(d, 1)) {
      const r = byKey.get(key(d.getFullYear(), d.getMonth() + 1, d.getDate()));
      out.push({
        label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
        full: d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        amount: r?.amountDiscounted ?? 0,
        quantity: r?.quantity ?? 0,
        count: r?.count ?? 0,
      });
    }
  } else {
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const r = byKey.get(key(d.getFullYear(), d.getMonth() + 1));
      out.push({
        label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
        full: d.toLocaleDateString("tr-TR", { month: "long", year: "numeric" }),
        amount: r?.amountDiscounted ?? 0,
        quantity: r?.quantity ?? 0,
        count: r?.count ?? 0,
      });
    }
  }
  return out;
}

const BAR_COLOR = "#2a78d6";

function SalesChart({ data, unit }: { data: ReturnType<typeof buildSeries>; unit: string }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => fmtCompactTL(v)}
          />
          <Tooltip
            cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <div className="mb-1 font-medium">{p.full}</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: BAR_COLOR }} />
                    Tutar <span className="ml-auto font-semibold">{fmtTL(p.amount)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {fmtNum(p.quantity)} {unit} · {fmtNum(p.count)} işlem
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="amount" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Kırılım tablosu ---

const changeOf = (r: SalesRow) => r.amountDiscounted - (r.previousAmountDiscounted ?? 0);
const groupToggles: ToggleFilter<SalesRow>[] = [
  { key: "down", label: "Düşenler", test: (r) => changeOf(r) < -0.5 },
  { key: "up", label: "Artanlar", test: (r) => changeOf(r) > 0.5 },
  { key: "new", label: "Önceki dönemde alımı yok", test: (r) => r.amountDiscounted > 0 && !r.previousAmountDiscounted },
  { key: "stopped", label: "Bu dönemde alımı yok", test: (r) => r.amountDiscounted <= 0 && (r.previousAmountDiscounted ?? 0) > 0 },
];

const groupMulti: MultiFilter<SalesRow>[] = [groupFilter<SalesRow>()];
const purchaseMulti: MultiFilter<Purchase>[] = [groupFilter<Purchase>()];

function groupColumns(label: string, unit: string, total: number, clickable: boolean): Column<SalesRow>[] {
  return [
    {
      key: "name",
      label,
      sort: (r) => r.dimensionName,
      render: (r) => (clickable ? <CustomerCell name={r.dimensionName} groups={r.groups} /> : <span className="font-medium">{r.dimensionName || "—"}</span>),
    },
    { key: "count", label: "İşlem", align: "right", sort: (r) => r.count, render: (r) => fmtNum(r.count) },
    { key: "qty", label: `Miktar (${unit})`, align: "right", sort: (r) => r.quantity, render: (r) => fmtNum(r.quantity) },
    { key: "amount", label: "Tutar", align: "right", sort: (r) => r.amountDiscounted, render: (r) => <span className="font-semibold">{fmtTL(r.amountDiscounted)}</span> },
    { key: "share", label: "Pay", align: "right", sort: (r) => r.amountDiscounted, render: (r) => (total ? `%${fmtNum((r.amountDiscounted / total) * 100, 1)}` : "—") },
    { key: "prev", label: "Önceki dönem", align: "right", sort: (r) => r.previousAmountDiscounted, render: (r) => fmtTL(r.previousAmountDiscounted ?? 0) },
    { key: "change", label: "Değişim", align: "right", sort: changeOf, render: (r) => <Change now={r.amountDiscounted} prev={r.previousAmountDiscounted ?? 0} /> },
  ];
}

// --- Satış hareketleri ---

const purchaseColumns: Column<Purchase>[] = [
  { key: "date", label: "Zaman", sort: (p) => p.processDate, render: (p) => fmtDate(p.processDate, true) },
  { key: "name", label: "Müşteri", sort: (p) => p.fleetName, render: (p) => <CustomerCell name={p.fleetName || p.fleetCode} sub={p.fleetName ? p.fleetCode : null} groups={p.groups} /> },
  { key: "plate", label: "Plaka", sort: (p) => p.plate, render: (p) => <span className="font-medium">{p.plate || "—"}</span> },
  { key: "fuel", label: "Ürün", sort: (p) => fuelName(p.fuelType), render: (p) => fuelName(p.fuelType) },
  { key: "liter", label: "Litre", align: "right", sort: (p) => p.liter, render: (p) => fmtNum(p.liter, 2) },
  { key: "price", label: "Birim fiyat", align: "right", sort: (p) => p.unitPrice, render: (p) => (p.unitPrice ? `₺${fmtNum(p.unitPrice, 2)}` : "—") },
  { key: "amount", label: "Tutar", align: "right", sort: (p) => p.totalAmountDiscounted, render: (p) => fmtTL(p.totalAmountDiscounted) },
  {
    key: "station",
    label: "İstasyon",
    sort: (p) => p.dealer?.name,
    className: "max-w-56 whitespace-normal text-sm",
    render: (p) => [p.dealer?.name, p.dealer?.innerCity || p.dealer?.city].filter(Boolean).join(" · ") || "—",
  },
];
const purchaseFilters: SelectFilter<Purchase>[] = [
  { key: "fleet", label: "Müşteri", value: (p) => p.fleetName || p.fleetCode },
  { key: "fuel", label: "Ürün", value: (p) => fuelName(p.fuelType) },
  { key: "station", label: "İstasyon", value: (p) => p.dealer?.name },
];

function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const fresh = useRef(false); // yalnız "Yenile"den sonraki ilk istek önbelleği atlar

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const skipCache = fresh.current;
    fresh.current = false;
    fetch(`${url}${skipCache ? "&fresh=1" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Veri alınamadı.");
        if (!cancelled) setState({ url, data: json });
      })
      .catch((err) => {
        if (!cancelled) setState({ url, error: err instanceof Error ? err.message : "Veri alınamadı." });
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  // Yeni dönem yüklenirken önceki veri (soluk) ekranda kalır; sayfa boşalıp zıplamaz.
  const current = state && state.url === url ? state : null;
  return {
    data: current?.data ?? state?.data ?? null,
    error: current?.error ?? null,
    loading: Boolean(url) && !current,
    reload: useCallback(() => {
      setState(null);
      fresh.current = true;
      setNonce((n) => n + 1);
    }, []),
  };
}

export default function YakitOfisiSatislarPage() {
  const [preset, setPreset] = useState<string>("ay");
  const [range, setRange] = useState(() => presetRange("ay"));
  const [type, setType] = useState("Fuel");
  const [tab, setTab] = useState("Customer");
  const [fleetId, setFleetId] = useState<number | null>(null);

  const isPurchases = tab === "hareketler";
  const base = `from=${range.from}&to=${range.to}&type=${type}`;
  const summary = useJson<Summary>(`/api/yakit-ofisi/sales?${base}&group=${isPurchases ? "Customer" : tab}`);
  const purchases = useJson<{ purchases: Section<{ total: number; items: Purchase[] | null }>; fetchedAt: number }>(
    isPurchases ? `/api/yakit-ofisi/sales?view=purchases&${base}` : null,
  );

  const s = summary.data;
  const t = s?.totals.data;
  const unit = type === "Toll" ? "geçiş" : type ? "lt" : "miktar";
  const series = useMemo(
    () => (s?.series.data ? buildSeries(s.series.data, s.bucket, s.range.from, s.range.to) : []),
    [s],
  );
  const groupLabel = GROUP_TABS.find(([k]) => k === tab)?.[1] ?? "";
  const columns = useMemo(
    () => groupColumns(groupLabel.replace(/ler$|lar$/, "") || "Ad", unit, t?.amountDiscounted ?? 0, tab === "Customer"),
    [groupLabel, unit, t, tab],
  );

  const choosePreset = (key: string) => {
    setPreset(key);
    setRange(presetRange(key));
  };
  const setDate = (k: "from" | "to", v: string) => {
    if (!v) return;
    setPreset("");
    setRange((r) => ({ ...r, [k]: v }));
  };

  // Hareket listesinde eski dönemin satırları yanıltıcı olur; yüklenirken gösterilmez.
  const pData = purchases.loading ? undefined : purchases.data?.purchases;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Satışlar"
        description="Yakıt Ofisi müşterilerinin satışları. Dönem seçin; tablolar önceki aynı uzunluktaki dönemle karşılaştırılır."
        loading={summary.loading}
        onRefresh={() => {
          summary.reload();
          if (isPurchases) purchases.reload();
        }}
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => choosePreset(k)}
                className={`rounded-md border px-3 py-1.5 text-sm ${preset === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Başlangıç</span>
            <Input type="date" value={range.from} max={range.to} onChange={(e) => setDate("from", e.target.value)} className="h-8 w-40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Bitiş</span>
            <Input type="date" value={range.to} min={range.from} onChange={(e) => setDate("to", e.target.value)} className="h-8 w-40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Satış tipi</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-8 rounded-lg border bg-background px-2 text-sm outline-none focus:border-primary"
            >
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {summary.error && <ErrorNote message={summary.error} />}
      {s?.totals.error && <ErrorNote message={s.totals.error} />}
      {summary.loading && !s && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}

      {s && t && (
        <div className={`space-y-6 transition-opacity ${summary.loading ? "opacity-50" : ""}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              title="Satış tutarı"
              value={fmtTL(t.amountDiscounted)}
              sub={
                <>
                  Önceki dönem {fmtTL(t.previousAmountDiscounted)} · <Change now={t.amountDiscounted} prev={t.previousAmountDiscounted} />
                </>
              }
            />
            <Stat
              title={`Miktar (${unit})`}
              value={fmtNum(t.quantity)}
              sub={
                <>
                  Önceki dönem {fmtNum(t.previousQuantity)} · <Change now={t.quantity} prev={t.previousQuantity} money={false} />
                </>
              }
            />
            <Stat
              title="İşlem adedi"
              value={fmtNum(t.count)}
              sub={
                <>
                  Önceki dönem {fmtNum(t.previousCount)} · <Change now={t.count} prev={t.previousCount} money={false} />
                </>
              }
            />
            <Stat
              title={type === "Fuel" || type === "AdBlue" ? "Ortalama litre fiyatı" : "Ortalama işlem tutarı"}
              value={
                type === "Fuel" || type === "AdBlue"
                  ? t.quantity
                    ? `₺${fmtNum(t.amountDiscounted / t.quantity, 2)}`
                    : "—"
                  : t.count
                    ? fmtTL(t.amountDiscounted / t.count)
                    : "—"
              }
              sub={`${fmtDate(s.range.from)} – ${fmtDate(s.range.to)} · ${s.range.days} gün`}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{s.bucket === "Day" ? "Günlük satış tutarı" : "Aylık satış tutarı"}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Karşılaştırılan önceki dönem: {fmtDate(s.compareRange.from)} – {fmtDate(s.compareRange.to)}
              </p>
            </CardHeader>
            <CardContent>
              {s.series.error ? <ErrorNote message={s.series.error} /> : <SalesChart data={series} unit={unit} />}
            </CardContent>
          </Card>
        </div>
      )}

      {s && (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList>
            {GROUP_TABS.map(([k, l]) => (
              <TabsTrigger key={k} value={k}>
                {l}
              </TabsTrigger>
            ))}
            <TabsTrigger value="hareketler">Satış Hareketleri</TabsTrigger>
          </TabsList>

          {GROUP_TABS.map(([k]) => (
            <TabsContent key={k} value={k}>
              <Card>
                <CardContent className="p-4">
                  {s.group !== k || summary.loading ? (
                    <p className="text-sm text-muted-foreground">Yükleniyor…</p>
                  ) : s.groups.error ? (
                    <ErrorNote message={s.groups.error} />
                  ) : (
                    <DataTable
                      key={`${k}-${base}`}
                      rows={s.groups.data ?? []}
                      columns={columns}
                      rowKey={(r) => `${r.dimensionID ?? ""}-${r.dimensionName ?? ""}`}
                      searchText={(r) => [r.dimensionName]}
                      searchPlaceholder={`${groupLabel} içinde ara`}
                      multiFilters={groupMulti}
                      toggles={groupToggles}
                      defaultSort={{ key: "amount", dir: "desc" }}
                      onRowClick={k === "Customer" ? (r) => r.dimensionID && setFleetId(r.dimensionID) : undefined}
                      summary={(rows) => (
                        <>
                          {fmtNum(rows.length)} kayıt · <span className="font-semibold text-foreground">{fmtTL(rows.reduce((a, r) => a + r.amountDiscounted, 0))}</span>
                        </>
                      )}
                      emptyText="Bu dönemde satış yok."
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}

          <TabsContent value="hareketler">
            <Card>
              <CardContent className="p-4">
                {purchases.error && <ErrorNote message={purchases.error} />}
                {pData?.error && <ErrorNote message={pData.error} />}
                {purchases.loading && <p className="text-sm text-muted-foreground">Satış hareketleri okunuyor…</p>}
                {pData?.data && !pData.data.items && (
                  <p className="text-sm">
                    Bu aralıkta {fmtNum(pData.data.total)} satış var; tek tek listelemek için çok fazla. Lütfen daha kısa bir
                    aralık seçin (örneğin &quot;Bu hafta&quot; ya da birkaç gün). Toplamlar ve kırılımlar yukarıda yine tam.
                  </p>
                )}
                {pData?.data?.items && (
                  <DataTable
                    key={base}
                    rows={pData.data.items}
                    columns={purchaseColumns}
                    rowKey={(p) => p.id}
                    searchText={(p) => [p.fleetName, p.fleetCode, p.plate, p.dealer?.name]}
                    searchPlaceholder="Müşteri, plaka veya istasyon ara"
                    filters={purchaseFilters}
                    multiFilters={purchaseMulti}
                    defaultSort={{ key: "date", dir: "desc" }}
                    onRowClick={(p) => setFleetId(p.fleetID)}
                    summary={(rows) => (
                      <>
                        {fmtNum(rows.length)} satış · {fmtNum(rows.reduce((a, p) => a + (p.liter ?? 0), 0))} lt ·{" "}
                        <span className="font-semibold text-foreground">{fmtTL(rows.reduce((a, p) => a + (p.totalAmountDiscounted ?? 0), 0))}</span>
                      </>
                    )}
                    emptyText="Bu aralıkta satış yok."
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <FetchedAt at={s?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
