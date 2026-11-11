"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, PageHeader, StatusPill, selectClass } from "@/components/cark-mobil/ui";
import type { Trip } from "@/lib/cark-mobil/types";
import { isoDay, liters, plannedTotal } from "@/lib/cark-mobil/util";

type Tab = "aktif" | "gecmis";

export default function SeferlerPage() {
  const router = useRouter();
  const { activeTrips, trips, tripLimit, loadMoreTrips } = useCark();
  const [tab, setTab] = useState<Tab>("aktif");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");

  const active = useMemo(
    () =>
      [...activeTrips].sort(
        (a, b) => Number(a.status === "assigned") - Number(b.status === "assigned") || b.date.localeCompare(a.date)
      ),
    [activeTrips]
  );
  const history = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return trips.filter((t) => {
      if (t.status !== "completed" && t.status !== "cancelled") return false;
      if (status && t.status !== status) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (!needle) return true;
      const text = [t.vehiclePlate, t.driverName, ...(t.stops ?? []).map((s) => s.customerName)]
        .join(" ")
        .toLocaleLowerCase("tr");
      return text.includes(needle);
    });
  }, [trips, q, from, to, status]);

  const rows = tab === "aktif" ? active : history;
  const totalDelivered = history.reduce((a, t) => a + (t.deliveredMl ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seferler"
        description="Sefer planlayın, yoldaki tankeri izleyin, geçmiş teslimat ve fişlere bakın."
        action={
          <Link href="/cark-mobil/seferler/yeni" className={cn(buttonVariants(), "h-9")}>
            <Plus className="h-4 w-4" /> Yeni sefer
          </Link>
        }
      />

      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm sm:w-fit">
        {(
          [
            ["aktif", `Aktif ve bekleyen (${active.length})`],
            ["gecmis", "Geçmiş"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("rounded-md px-4 py-1.5", tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      <Box>
        {tab === "gecmis" && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="relative min-w-52 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plaka, şoför ya da müşteri ara" className="pl-8" />
            </div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" title="Başlangıç" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" title="Bitiş" />
            <select className={cn(selectClass, "w-40")} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tüm durumlar</option>
              <option value="completed">Tamamlandı</option>
              <option value="cancelled">İptal</option>
            </select>
            <span className="text-xs text-muted-foreground">
              {history.length} sefer · <b className="text-foreground">{liters(totalDelivered)} L</b> teslim
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>{tab === "aktif" ? "Aktif ya da atanmış sefer yok." : "Bu ölçütlere uyan sefer yok."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Tarih</th>
                  <th className="px-3 py-2 font-medium">Tanker</th>
                  <th className="px-3 py-2 font-medium">Şoför</th>
                  <th className="px-3 py-2 font-medium">Duraklar</th>
                  <th className="px-3 py-2 text-right font-medium">Planlanan</th>
                  <th className="px-3 py-2 text-right font-medium">Teslim</th>
                  <th className="py-2 pl-3 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t: Trip) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/cark-mobil/seferler/${t.id}`)}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                  >
                    <td className="whitespace-nowrap py-2.5 pr-3">{isoDay(t.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium">{t.vehiclePlate}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{t.driverName}</td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">
                      {t.resolvedCount ?? 0}/{t.stops?.length ?? 0} · {(t.stops ?? []).map((s) => s.customerName).join(", ")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">{liters(plannedTotal(t.stops))} L</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{liters(t.deliveredMl)} L</td>
                    <td className="whitespace-nowrap py-2.5 pl-3">
                      <StatusPill status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "gecmis" && trips.length >= tripLimit && (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm" onClick={loadMoreTrips}>
              Daha eski seferleri yükle
            </Button>
          </div>
        )}
      </Box>
    </div>
  );
}
