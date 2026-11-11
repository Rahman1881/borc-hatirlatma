"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bell, Droplet, MapPin, Plus, Route, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCark } from "@/components/cark-mobil/store";
import { MapView, type MapMarker } from "@/components/cark-mobil/map";
import { Box, Empty, PageHeader, StatusPill } from "@/components/cark-mobil/ui";
import { DEFAULT_DEPOT, dateTime, isoDay, liters, plannedTotal, todayIso } from "@/lib/cark-mobil/util";

export default function CarkMobilOzet() {
  const { activeTrips, trips, vehicles, notices, live, settings } = useCark();
  const depot = settings.depot ?? DEFAULT_DEPOT;
  const today = todayIso();

  const onRoad = activeTrips.filter((t) => t.status !== "assigned");
  const assigned = activeTrips.filter((t) => t.status === "assigned");
  const todayDelivered = useMemo(
    () => trips.filter((t) => t.date === today).reduce((a, t) => a + (t.deliveredMl ?? 0), 0),
    [trips, today]
  );
  const activeVehicles = vehicles.filter((v) => v.active);

  // Yoldaki tankerlerin son konumu (aktif seferin şoförüne ait canlı kayıt).
  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [{ id: "depot", lat: depot.lat, lng: depot.lng, kind: "depot", title: settings.depotName || "Merkez" }];
    for (const t of onRoad) {
      const p = live[t.driverId];
      if (p && p.tripId === t.id) {
        out.push({
          id: t.id,
          lat: p.lat,
          lng: p.lng,
          kind: "tanker",
          title: `${t.vehiclePlate ?? ""} · ${t.driverName ?? ""} · ${dateTime(p.capturedAtMs)}`,
        });
      }
    }
    return out;
  }, [onRoad, live, depot.lat, depot.lng, settings.depotName]);

  const sorted = [...activeTrips].sort((a, b) => (a.status === "assigned" ? 1 : 0) - (b.status === "assigned" ? 1 : 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Özet"
        description="Mobil uygulamayla aynı veriler; burada yaptığınız her işlem telefonlarda anında görünür."
        action={
          <Link href="/cark-mobil/seferler/yeni" className={cn(buttonVariants(), "h-9")}>
            <Plus className="h-4 w-4" /> Yeni sefer
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { icon: Route, label: "Yoldaki sefer", value: String(onRoad.length) },
          { icon: MapPin, label: "Bekleyen (atanmış) sefer", value: String(assigned.length) },
          { icon: Droplet, label: "Bugün teslim edilen", value: `${liters(todayDelivered)} L` },
          { icon: Truck, label: "Aktif tanker", value: String(activeVehicles.length) },
        ].map((c) => (
          <Box key={c.label} className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <c.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-semibold tabular-nums">{c.value}</p>
            </div>
          </Box>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Box>
          <p className="mb-3 text-sm font-semibold">Aktif ve bekleyen seferler</p>
          {sorted.length === 0 ? (
            <Empty>Şu anda aktif ya da atanmış sefer yok.</Empty>
          ) : (
            <div className="space-y-2">
              {sorted.map((t) => {
                const stops = t.stops?.length ?? 0;
                return (
                  <Link
                    key={t.id}
                    href={`/cark-mobil/seferler/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t.vehiclePlate} · {t.driverName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isoDay(t.date)} · {t.resolvedCount ?? 0}/{stops} durak · {liters(t.deliveredMl)} /{" "}
                        {liters(plannedTotal(t.stops))} L
                      </p>
                    </div>
                    <StatusPill status={t.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </Box>

        <Box>
          <p className="mb-3 text-sm font-semibold">Canlı konum</p>
          <MapView markers={markers} fitKey={markers.map((m) => m.id).join("|")} className="h-72 w-full rounded-lg border" />
          {onRoad.length > 0 && markers.length === 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Yoldaki tankerden henüz konum gelmedi (telefonun konumu ya da bağlantısı kapalı olabilir).
            </p>
          )}
        </Box>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Box>
          <p className="mb-3 text-sm font-semibold">Tankerdeki yakıt</p>
          {activeVehicles.length === 0 ? (
            <Empty>Aktif tanker yok.</Empty>
          ) : (
            <div className="space-y-4">
              {activeVehicles.map((v) => {
                const cap = v.capacityLiters * 1000;
                const pct = v.remainingFuelMl == null ? 0 : Math.min(100, Math.round((v.remainingFuelMl / cap) * 100));
                return (
                  <div key={v.id}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{v.plate}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {v.remainingFuelMl == null ? "Miktar girilmedi" : `${liters(v.remainingFuelMl)} / ${liters(cap)} L`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 rounded-full bg-muted">
                      <div className="h-2.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Box>

        <Box>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Son bildirimler</p>
            <Link href="/cark-mobil/bildirimler" className="text-xs text-primary hover:underline">
              Tümü
            </Link>
          </div>
          {notices.length === 0 ? (
            <Empty>Bildirim yok.</Empty>
          ) : (
            <div className="space-y-2">
              {notices.slice(0, 6).map((n) => (
                <div key={n.id} className="flex items-start gap-2 text-sm">
                  <Bell className={cn("mt-0.5 h-4 w-4 shrink-0", n.read ? "text-muted-foreground/50" : "text-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate", !n.read && "font-medium")}>{n.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{dateTime(n.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Box>
      </div>
    </div>
  );
}
