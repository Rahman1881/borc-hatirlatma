"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerCell, ErrorNote, groupFilter, FetchedAt, PageHeader, fmtDate, useYoData, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type SelectFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type Rejected = {
  id: number;
  requestDate: string;
  fleetID: number;
  fleetName?: string | null;
  customerCode?: string | null;
  plate?: string | null;
  reason?: string | null;
  stationName?: string | null;
  cityName?: string | null;
  productName?: string | null;
  groups?: string[] | null;
};

const PERIODS = [1, 3, 7, 14, 30];

const columns: Column<Rejected>[] = [
  { key: "date", label: "Zaman", sort: (r) => r.requestDate, render: (r) => fmtDate(r.requestDate, true) },
  { key: "name", label: "Müşteri", sort: (r) => r.fleetName, render: (r) => <CustomerCell name={r.fleetName || r.customerCode} sub={r.fleetName ? r.customerCode : null} groups={r.groups} /> },
  { key: "plate", label: "Plaka", sort: (r) => r.plate, render: (r) => <span className="font-medium">{r.plate || "—"}</span> },
  { key: "reason", label: "Sebep", sort: (r) => r.reason, className: "max-w-xs whitespace-normal text-sm", render: (r) => r.reason || "—" },
  { key: "product", label: "Ürün", sort: (r) => r.productName, render: (r) => r.productName || "—" },
  { key: "station", label: "İstasyon", sort: (r) => r.stationName, render: (r) => [r.stationName, r.cityName].filter(Boolean).join(" · ") || "—" },
];

const filters: SelectFilter<Rejected>[] = [
  { key: "reason", label: "Sebep", value: (r) => r.reason },
  { key: "fleet", label: "Müşteri", value: (r) => r.fleetName || r.customerCode },
  { key: "city", label: "İl", value: (r) => r.cityName },
];

const multiFilters: MultiFilter<Rejected>[] = [groupFilter<Rejected>()];

export default function YakitOfisiReddedilenPage() {
  const [days, setDays] = useState(3);
  const { data, loading, error, reload } = useYoData<{ rejected: Section<Rejected[]>; fetchedAt: number }>("rejected", `days=${days}`);
  const [fleetId, setFleetId] = useState<number | null>(null);
  const rows = data?.rejected.data;
  const sectionError = error || data?.rejected.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pompada Reddedilenler"
        description="İstasyonda okutulup reddedilen yakıt alımları. Satıra tıklayınca müşteri bilgileri açılır."
        loading={loading}
        onRefresh={reload}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Dönem:</span>
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`rounded-md border px-3 py-1 ${d === days ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            Son {d} gün
          </button>
        ))}
      </div>
      {sectionError && <ErrorNote message={sectionError} />}
      {!rows && !sectionError && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {rows && (
        <Card>
          <CardContent className="p-4">
            <DataTable
              key={days}
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              searchText={(r) => [r.fleetName, r.customerCode, r.plate, r.reason, r.stationName, r.cityName]}
              searchPlaceholder="Plaka, müşteri, sebep veya istasyon ara"
              filters={filters}
              multiFilters={multiFilters}
              defaultSort={{ key: "date", dir: "desc" }}
              onRowClick={(r) => r.fleetID && setFleetId(r.fleetID)}
              summary={(list) => `${list.length} red · ${new Set(list.map((r) => r.fleetID)).size} müşteri`}
              emptyText="Bu dönemde reddedilen alım yok."
            />
          </CardContent>
        </Card>
      )}
      <FetchedAt at={data?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
