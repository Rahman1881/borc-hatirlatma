"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerCell, ErrorNote, groupFilter, FetchedAt, PageHeader, fmtDate, fmtTL, useYoData, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type SelectFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type CardError = {
  id: number;
  fleetID: number;
  fleetName?: string | null;
  fleetCode?: string | null;
  amount: number;
  lastErrorMessage?: string | null;
  lastError?: string | null;
  errorCount: number;
  groups?: string[] | null;
};

const columns: Column<CardError>[] = [
  {
    key: "name",
    label: "Müşteri",
    sort: (c) => c.fleetName,
    render: (c) => <CustomerCell name={c.fleetName || `Filo ${c.fleetID}`} sub={c.fleetCode} groups={c.groups} />,
  },
  { key: "amount", label: "Limit tutarı", align: "right", sort: (c) => c.amount, render: (c) => fmtTL(c.amount) },
  { key: "count", label: "Hatalı deneme", align: "right", sort: (c) => c.errorCount, render: (c) => c.errorCount },
  { key: "message", label: "Son hata", className: "max-w-md whitespace-normal text-sm", render: (c) => c.lastErrorMessage || "—" },
  { key: "date", label: "Son hata zamanı", sort: (c) => c.lastError, render: (c) => fmtDate(c.lastError, true) },
];

const filters: SelectFilter<CardError>[] = [
  { key: "message", label: "Hata", value: (c) => c.lastErrorMessage },
];

const multiFilters: MultiFilter<CardError>[] = [groupFilter<CardError>()];

export default function YakitOfisiKartHatalariPage() {
  const { data, loading, error, reload } = useYoData<{ cards: Section<CardError[]>; fetchedAt: number }>("cards");
  const [fleetId, setFleetId] = useState<number | null>(null);
  const rows = data?.cards.data;
  const sectionError = error || data?.cards.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kart Hataları"
        description="Kredi kartından limit yüklemesi hata veren abonelikler. Satıra tıklayınca müşteri bilgileri açılır."
        loading={loading}
        onRefresh={reload}
      />
      {sectionError && <ErrorNote message={sectionError} />}
      {!rows && !sectionError && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {rows && (
        <Card>
          <CardContent className="p-4">
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(c) => c.id}
              searchText={(c) => [c.fleetName, c.fleetCode, c.lastErrorMessage]}
              searchPlaceholder="Müşteri veya hata ara"
              filters={filters}
              multiFilters={multiFilters}
              defaultSort={{ key: "date", dir: "desc" }}
              onRowClick={(c) => setFleetId(c.fleetID)}
              summary={(list) => `${list.length} abonelik · ${fmtTL(list.reduce((a, c) => a + c.amount, 0))}`}
              emptyText="Kart hatası veren abonelik yok."
            />
          </CardContent>
        </Card>
      )}
      <FetchedAt at={data?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
