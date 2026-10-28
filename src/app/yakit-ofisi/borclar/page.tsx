"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerCell, ErrorNote, FetchedAt, PageHeader, daysSince, groupFilter, fmtDate, fmtTL, useYoData, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type SelectFilter, type ToggleFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type Fleet = {
  id: number;
  name?: string | null;
  customName?: string | null;
  code?: string | null;
  codeName?: string | null;
  totalDebtDiscounted?: number;
  totalDebtDiscountedDueBeforeToday?: number;
  totalDebtDiscountedPastDue?: number;
  totalLimit?: number;
  remainingLimit?: number;
  lastFuelPurchaseDate?: string | null;
  addressPhone?: string | null;
  city?: string | null;
  district?: string | null;
  termDay?: number | null;
  termType?: number | string;
  fuelAllowance?: boolean;
  groups?: string[] | null;
};

const nameOf = (f: Fleet) => f.customName || f.name || f.code || "—";
const due = (f: Fleet) => f.totalDebtDiscountedDueBeforeToday ?? 0;
const notDue = (f: Fleet) => (f.totalDebtDiscounted ?? 0) - due(f);
const sum = (rows: Fleet[], get: (f: Fleet) => number) => rows.reduce((a, f) => a + get(f), 0);
const termText = (f: Fleet) =>
  f.termDay == null ? "—" : `${f.termType === 1 || f.termType === "AfterInvoice" ? "Faturadan" : "Ay sonundan"} ${f.termDay} gün`;

const customer: Column<Fleet> = {
  key: "name",
  label: "Müşteri",
  sort: nameOf,
  render: (f) => (
    <CustomerCell
      name={nameOf(f)}
      sub={[f.codeName, f.code].filter(Boolean).join(" · ")}
      groups={f.groups}
      badge={
        f.fuelAllowance === false && (
          <Badge variant="destructive" className="ml-2">
            Alım kapalı
          </Badge>
        )
      }
    />
  ),
};
const total: Column<Fleet> = { key: "debt", label: "Toplam borç", align: "right", sort: (f) => f.totalDebtDiscounted, render: (f) => fmtTL(f.totalDebtDiscounted) };
const remaining: Column<Fleet> = { key: "remaining", label: "Kalan limit", align: "right", sort: (f) => f.remainingLimit, render: (f) => fmtTL(f.remainingLimit) };
const lastPurchase: Column<Fleet> = {
  key: "last",
  label: "Son alım",
  sort: (f) => f.lastFuelPurchaseDate,
  render: (f) => {
    const idle = daysSince(f.lastFuelPurchaseDate);
    return (
      <>
        {fmtDate(f.lastFuelPurchaseDate)}
        {idle != null && idle > 14 && <div className="text-xs text-muted-foreground">{idle} gün önce</div>}
      </>
    );
  },
};
const phone: Column<Fleet> = { key: "phone", label: "Telefon", render: (f) => f.addressPhone || "—" };

const overdueColumns: Column<Fleet>[] = [
  customer,
  { key: "due", label: "Vadesi geçen", align: "right", sort: due, render: (f) => <span className="font-semibold">{fmtTL(due(f))}</span> },
  {
    key: "past",
    label: "Gecikme sınırını aşan",
    align: "right",
    sort: (f) => f.totalDebtDiscountedPastDue,
    render: (f) => (f.totalDebtDiscountedPastDue ? <span className="text-destructive">{fmtTL(f.totalDebtDiscountedPastDue)}</span> : "—"),
  },
  total,
  remaining,
  lastPurchase,
  phone,
];

const upcomingColumns: Column<Fleet>[] = [
  customer,
  { key: "notDue", label: "Vadesi gelmemiş", align: "right", sort: notDue, render: (f) => <span className="font-semibold">{fmtTL(notDue(f))}</span> },
  { key: "term", label: "Vade", sort: (f) => f.termDay, render: termText },
  {
    key: "due",
    label: "Ayrıca vadesi geçen",
    align: "right",
    sort: due,
    render: (f) => (due(f) > 0 ? <span className="text-destructive">{fmtTL(due(f))}</span> : "—"),
  },
  total,
  remaining,
  lastPurchase,
  phone,
];

const search = (f: Fleet) => [nameOf(f), f.name, f.code, f.codeName, f.addressPhone];
const filters: SelectFilter<Fleet>[] = [
  // Yakıt Ofisi'nde ilçe elle yazılıyor (ADAPAZARI / adapazarı); filtre için birleştirilir.
  { key: "district", label: "İlçe", value: (f) => f.district?.trim().toLocaleUpperCase("tr") },
];
const multiFilters: MultiFilter<Fleet>[] = [groupFilter<Fleet>()];
const overdueToggles: ToggleFilter<Fleet>[] = [
  { key: "past", label: "Gecikme sınırını aşanlar", test: (f) => (f.totalDebtDiscountedPastDue ?? 0) > 0 },
  { key: "closed", label: "Alımı kapalı olanlar", test: (f) => f.fuelAllowance === false },
  { key: "idle", label: "30 gündür alım yok", test: (f) => (daysSince(f.lastFuelPurchaseDate) ?? 999) >= 30 },
];
const upcomingToggles: ToggleFilter<Fleet>[] = [
  { key: "alsoDue", label: "Vadesi geçmiş borcu da olanlar", test: (f) => due(f) > 0 },
  { key: "noLimit", label: "Limiti bitmiş", test: (f) => (f.remainingLimit ?? 0) <= 0 },
];

export default function YakitOfisiBorclarPage() {
  const { data, loading, error, reload } = useYoData<{ fleets: Section<Fleet[]>; fetchedAt: number }>("borclar");
  // Genel Bakış'tan ?tab=gelen ile gelinebilir. Sekmeler veri gelince çizildiği için sunucu çiziminde fark oluşmaz.
  const [tab, setTab] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "gelen" ? "gelen" : "gecen",
  );
  const [fleetId, setFleetId] = useState<number | null>(null);

  const all = data?.fleets.data;
  const overdue = useMemo(() => (all ?? []).filter((f) => due(f) > 0), [all]);
  const upcoming = useMemo(() => (all ?? []).filter((f) => notDue(f) > 0.5), [all]);
  const sectionError = error || data?.fleets.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Borçlar"
        description="Yakıt Ofisi'nde borcu olan müşteri hesapları. Satıra tıklayınca müşteri bilgileri açılır."
        loading={loading}
        onRefresh={reload}
      />
      {sectionError && <ErrorNote message={sectionError} />}
      {!all && !sectionError && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}

      {all && (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList>
            <TabsTrigger value="gecen">Vadesi Geçen ({overdue.length})</TabsTrigger>
            <TabsTrigger value="gelen">Vadesi Gelen ({upcoming.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="gecen">
            <Card>
              <CardContent className="p-4">
                <DataTable
                  rows={overdue}
                  columns={overdueColumns}
                  rowKey={(f) => f.id}
                  searchText={search}
                  searchPlaceholder="Müşteri, kod veya telefon ara"
                  filters={filters}
                  multiFilters={multiFilters}
                  toggles={overdueToggles}
                  defaultSort={{ key: "due", dir: "desc" }}
                  onRowClick={(f) => setFleetId(f.id)}
                  summary={(rows) => (
                    <>
                      {rows.length} müşteri · vadesi geçen <span className="font-semibold text-foreground">{fmtTL(sum(rows, due))}</span>
                    </>
                  )}
                  emptyText="Vadesi geçmiş borcu olan müşteri yok."
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  &quot;Gecikme sınırını aşan&quot;: vadesi geçmiş borcun, Yakıt Ofisi&apos;nde tanımlı gecikme sınırını da geçmiş kısmı.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gelen">
            <Card>
              <CardContent className="p-4">
                <DataTable
                  rows={upcoming}
                  columns={upcomingColumns}
                  rowKey={(f) => f.id}
                  searchText={search}
                  searchPlaceholder="Müşteri, kod veya telefon ara"
                  filters={filters}
                  multiFilters={multiFilters}
                  toggles={upcomingToggles}
                  defaultSort={{ key: "notDue", dir: "desc" }}
                  onRowClick={(f) => setFleetId(f.id)}
                  summary={(rows) => (
                    <>
                      {rows.length} müşteri · vadesi gelmemiş <span className="font-semibold text-foreground">{fmtTL(sum(rows, notDue))}</span>
                    </>
                  )}
                  emptyText="Vadesi gelmemiş borcu olan müşteri yok."
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Vadesi henüz gelmemiş (ödeme günü gelmemiş) borçlar. &quot;Vade&quot; müşterinin Yakıt Ofisi&apos;ndeki vade koşulu.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      <FetchedAt at={data?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
