"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerCell, ErrorNote, groupFilter, FetchedAt, PageHeader, cariText, fmtDate, fmtNum, useYoData, type Section } from "../shared";
import { DataTable, type Column, type MultiFilter, type SelectFilter, type ToggleFilter } from "../data-table";
import { FleetDialog } from "../fleet-dialog";

type Churn = {
  fleetId: number;
  fleetName?: string | null;
  cariCode?: string | null;
  level: number | string;
  blocker: number | string;
  reason?: string | null;
  lastPurchaseDate?: string | null;
  silenceDays: number;
  baselineLiter: number;
  recentLiter: number;
  groups?: string[] | null;
};

// API enum'ları sayı ya da ad olarak dönebiliyor; ikisini de karşılar.
const pick = (v: number | string, byNum: Record<number, string>, byName: Record<string, string>) =>
  typeof v === "number" ? byNum[v] ?? String(v) : byName[v] ?? v;
const levelText = (v: number | string) =>
  pick(v, { 1: "İzleme", 2: "Kritik", 3: "Kesen" }, { High: "İzleme", Critical: "Kritik", Stopped: "Kesen" });
const levelRank = (v: number | string) => ({ İzleme: 1, Kritik: 2, Kesen: 3 })[levelText(v)] ?? 0;
const blockerText = (v: number | string) =>
  pick(v, { 0: "", 1: "Limit bitmiş", 2: "Vadesi geçmiş borç" }, { None: "", LimitDepleted: "Limit bitmiş", Overdue: "Vadesi geçmiş borç" });

const columns: Column<Churn>[] = [
  { key: "name", label: "Müşteri", sort: (c) => c.fleetName, render: (c) => <CustomerCell name={c.fleetName} sub={cariText(c.cariCode)} groups={c.groups} /> },
  {
    key: "level",
    label: "Durum",
    sort: (c) => levelRank(c.level),
    render: (c) => (
      <>
        <Badge variant={levelText(c.level) === "İzleme" ? "secondary" : "destructive"}>{levelText(c.level)}</Badge>
        {blockerText(c.blocker) && <div className="mt-1 text-xs text-muted-foreground">{blockerText(c.blocker)}</div>}
      </>
    ),
  },
  { key: "reason", label: "Gerekçe", className: "max-w-sm whitespace-normal text-sm", render: (c) => c.reason || "—" },
  {
    key: "last",
    label: "Son alım",
    sort: (c) => c.silenceDays,
    render: (c) => (
      <>
        {fmtDate(c.lastPurchaseDate)}
        <div className="text-xs text-muted-foreground">{c.silenceDays} gün sessiz</div>
      </>
    ),
  },
  { key: "base", label: "Normal aylık (lt)", align: "right", sort: (c) => c.baselineLiter, render: (c) => fmtNum(c.baselineLiter) },
  { key: "recent", label: "Son 30 gün (lt)", align: "right", sort: (c) => c.recentLiter, render: (c) => fmtNum(c.recentLiter) },
];

const filters: SelectFilter<Churn>[] = [
  { key: "level", label: "Durum", value: (c) => levelText(c.level) },
  { key: "blocker", label: "Engel", value: (c) => blockerText(c.blocker) || "Engel yok" },
];
const multiFilters: MultiFilter<Churn>[] = [groupFilter<Churn>()];
const toggles: ToggleFilter<Churn>[] = [{ key: "silent", label: "14 gündür alım yok", test: (c) => c.silenceDays >= 14 }];

export default function YakitOfisiAlimDusenPage() {
  const { data, loading, error, reload } = useYoData<{ churn: Section<Churn[]>; fetchedAt: number }>("churn");
  const [fleetId, setFleetId] = useState<number | null>(null);
  const rows = data?.churn.data;
  const sectionError = error || data?.churn.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alımı Düşen veya Bırakanlar"
        description="Alımı normalinin belirgin altına düşen ya da alımı kesen müşteriler. Satıra tıklayınca müşteri bilgileri açılır."
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
              rowKey={(c) => c.fleetId}
              searchText={(c) => [c.fleetName, c.cariCode, c.reason]}
              searchPlaceholder="Müşteri veya gerekçe ara"
              filters={filters}
              multiFilters={multiFilters}
              toggles={toggles}
              defaultSort={{ key: "base", dir: "desc" }}
              onRowClick={(c) => setFleetId(c.fleetId)}
              summary={(list) => `${list.length} müşteri`}
              emptyText="Alımı düşen müşteri yok."
            />
          </CardContent>
        </Card>
      )}
      <FetchedAt at={data?.fetchedAt} />
      <FleetDialog fleetId={fleetId} onClose={() => setFleetId(null)} />
    </div>
  );
}
