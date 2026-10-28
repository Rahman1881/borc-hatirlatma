"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerCell, ErrorNote, groupFilter, FetchedAt, PageHeader, cariText, fmtNum, fmtTL, useYoData, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type ToggleFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type Runway = {
  fleetId: number;
  fleetName?: string | null;
  cariCode?: string | null;
  remainingLimit: number;
  totalLimit: number;
  dailySpend: number;
  runwayDays: number;
  critical: boolean;
  groups?: string[] | null;
};

const columns: Column<Runway>[] = [
  { key: "name", label: "Müşteri", sort: (r) => r.fleetName, render: (r) => <CustomerCell name={r.fleetName} sub={cariText(r.cariCode)} groups={r.groups} /> },
  { key: "remaining", label: "Kalan limit", align: "right", sort: (r) => r.remainingLimit, render: (r) => fmtTL(r.remainingLimit) },
  { key: "total", label: "Toplam limit", align: "right", sort: (r) => r.totalLimit, render: (r) => fmtTL(r.totalLimit) },
  { key: "daily", label: "Günlük ort. alım", align: "right", sort: (r) => r.dailySpend, render: (r) => fmtTL(r.dailySpend) },
  {
    key: "days",
    label: "Kalan gün",
    align: "right",
    sort: (r) => r.runwayDays,
    render: (r) => (r.critical ? <Badge variant="destructive">{fmtNum(r.runwayDays, 1)}</Badge> : fmtNum(r.runwayDays, 1)),
  },
];

const multiFilters: MultiFilter<Runway>[] = [groupFilter<Runway>()];
const toggles: ToggleFilter<Runway>[] = [
  { key: "critical", label: "Yalnız kritik (3 gün içinde)", test: (r) => r.critical },
  { key: "empty", label: "Limiti bitmiş", test: (r) => r.remainingLimit <= 0 },
];

export default function YakitOfisiLimitPage() {
  const { data, loading, error, reload } = useYoData<{ runway: Section<{ criticalCount: number; fleets: Runway[] }>; fetchedAt: number }>("limit");
  const [fleetId, setFleetId] = useState<number | null>(null);
  const rows = data?.runway.data?.fleets;
  const sectionError = error || data?.runway.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Limiti Azalanlar"
        description="Son alım hızına göre limiti 7 gün içinde bitecek müşteriler. Satıra tıklayınca müşteri bilgileri açılır."
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
              rowKey={(r) => r.fleetId}
              searchText={(r) => [r.fleetName, r.cariCode]}
              searchPlaceholder="Müşteri veya kod ara"
              multiFilters={multiFilters}
              toggles={toggles}
              defaultSort={{ key: "days", dir: "asc" }}
              onRowClick={(r) => setFleetId(r.fleetId)}
              summary={(list) => `${list.length} müşteri · ${list.filter((r) => r.critical).length} kritik`}
              emptyText="Limiti yakında bitecek müşteri yok."
            />
          </CardContent>
        </Card>
      )}
      <FetchedAt at={data?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
