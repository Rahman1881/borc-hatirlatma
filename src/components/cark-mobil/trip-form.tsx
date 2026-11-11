"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, MapPinned, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCark } from "./store";
import { MapView, type MapLine, type MapMarker } from "./map";
import { Box, Field, Spinner, selectClass, useOp } from "./ui";
import type { Customer, Fuel, Route, Trip } from "@/lib/cark-mobil/types";
import { DEFAULT_DEPOT, FUELS, decodePolyline, duration, hasDuty, km, liters, newId, parseMl, todayIso } from "@/lib/cark-mobil/util";

// Sefer planlama (mobil uygulamadaki "Yeni sefer" / "Seferi düzenle"). Yüklenen miktarlar
// duraklardaki litrelerin toplamıdır; kayıtta rota ve (istenirse) ziyaret sırası sunucuda
// Google Routes ile hesaplanır.

type FormStop = { id: string; customerId: string; locationId: string; fuel: Fuel; litersText: string };

function CustomerPicker({ customers, value, onChange }: { customers: Customer[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const selected = customers.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return customers.filter((c) => !needle || c.name.toLocaleLowerCase("tr").includes(needle)).slice(0, 60);
  }, [customers, q]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${selectClass} flex items-center justify-between text-left`}>
        <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{selected?.name ?? "Müşteri seçin"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-64 rounded-lg border bg-popover p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri ara" className="pl-8" />
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto">
            {list.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">Müşteri bulunamadı.</p>
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                    setQ("");
                  }}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TripForm({ editing }: { editing?: Trip }) {
  const router = useRouter();
  const { vehicles, users, customers, settings } = useCark();
  const { busy, run } = useOp();
  const depot = settings.depot ?? DEFAULT_DEPOT;

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.active || v.id === editing?.vehicleId), [vehicles, editing]);
  const drivers = useMemo(
    () => users.filter((u) => hasDuty(u, "driver") && (u.active || u.id === editing?.driverId)),
    [users, editing]
  );
  const activeCustomers = useMemo(
    () =>
      customers
        .filter((c) => c.active !== false && (c.locations?.length ?? 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    [customers]
  );

  const [date, setDate] = useState(editing?.date ?? todayIso());
  const [pickedVehicle, setVehicleId] = useState(editing?.vehicleId ?? "");
  const [pickedDriver, setDriverId] = useState(editing?.driverId ?? "");
  // Tek aktif tanker / şoför varsa kendiliğinden seçilir.
  const vehicleId = pickedVehicle || (activeVehicles.length === 1 ? activeVehicles[0].id : "");
  const driverId = pickedDriver || (drivers.length === 1 ? drivers[0].id : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [optimize, setOptimize] = useState(editing?.optimize ?? true);
  const [stops, setStops] = useState<FormStop[]>(
    () =>
      editing?.stops?.map((s) => ({
        id: s.id,
        customerId: s.customerId,
        locationId: s.locationId,
        fuel: s.fuel,
        litersText: String(s.plannedMl / 1000).replace(".", ","),
      })) ?? [{ id: newId(), customerId: "", locationId: "", fuel: "diesel", litersText: "" }]
  );
  const [preview, setPreview] = useState<Route | null>(null);
  const [previewing, setPreviewing] = useState(false);


  const patch = (id: string, change: Partial<FormStop>) => {
    setStops((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
    setPreview(null);
  };
  const move = (i: number, by: number) => {
    setStops((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setPreview(null);
  };

  // Formdaki durakları müşteri kaydındaki bilgilerle birleştirir.
  const resolved = stops.map((s) => {
    const customer = customers.find((c) => c.id === s.customerId);
    const location = customer?.locations?.find((l) => l.id === s.locationId);
    return { form: s, customer, location, plannedMl: parseMl(s.litersText) };
  });
  const totals = FUELS.map((f) => ({
    ...f,
    ml: resolved.filter((r) => r.form.fuel === f.key).reduce((a, r) => a + (r.plannedMl ?? 0), 0),
  }));
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const tankMl = totals.filter((t) => t.key !== "adblue").reduce((a, t) => a + t.ml, 0);
  const overCapacity = !!vehicle && tankMl > vehicle.capacityLiters * 1000;

  function problem(): string | null {
    if (!vehicleId) return "Tanker seçin.";
    if (!driverId) return "Şoför seçin.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Tarih seçin.";
    if (resolved.length === 0) return "En az bir durak ekleyin.";
    for (const [i, r] of resolved.entries()) {
      if (!r.customer || !r.location) return `${i + 1}. durakta müşteri ve teslimat noktası seçin.`;
      if (!r.plannedMl || r.plannedMl <= 0) return `${i + 1}. durakta litre girin.`;
    }
    if (overCapacity) return "Planlanan motorin + benzin tanker kapasitesini aşıyor.";
    return null;
  }

  async function previewRoute() {
    const err = problem();
    if (err) return toast.error(err);
    setPreviewing(true);
    const r = await run<Route>("previewRoute", {
      origin: depot,
      destination: depot,
      stops: resolved.map((x) => ({ lat: x.location!.lat, lng: x.location!.lng })),
      optimize,
    });
    setPreviewing(false);
    if (r) setPreview(r);
  }

  async function save() {
    const err = problem();
    if (err) return toast.error(err);
    const id = editing?.id ?? newId();
    const payload = {
      id,
      operationId: newId(),
      driverId,
      vehicleId,
      date,
      loadedDieselMl: totals.find((t) => t.key === "diesel")!.ml,
      loadedGasolineMl: totals.find((t) => t.key === "gasoline")!.ml,
      loadedAdBlueMl: totals.find((t) => t.key === "adblue")!.ml,
      origin: depot,
      destination: depot,
      notes: notes.trim(),
      optimize,
      // Müşteri bilgileri sunucuda kayıttan yeniden okunur; buradakiler şema için gönderilir.
      stops: resolved.map((r) => ({
        id: r.form.id,
        customerId: r.customer!.id,
        locationId: r.location!.id,
        customerName: r.customer!.name,
        phone: "",
        address: r.location!.address ?? "",
        notes: r.location!.notes ?? "",
        lat: r.location!.lat,
        lng: r.location!.lng,
        fuel: r.form.fuel,
        plannedMl: r.plannedMl!,
      })),
    };
    const ok = await run(editing ? "updateTrip" : "dispatchTrip", payload, editing ? "Sefer güncellendi." : "Sefer atandı.");
    if (ok) router.push(`/cark-mobil/seferler/${id}`);
  }

  // Önizleme haritası: sunucunun döndürdüğü ziyaret sırasına göre numaralı duraklar.
  const order = preview?.order ?? resolved.map((_, i) => i);
  const markers: MapMarker[] = [
    { id: "depot", lat: depot.lat, lng: depot.lng, kind: "depot", title: settings.depotName || "Merkez" },
    ...order.flatMap((stopIndex, visit) => {
      const r = resolved[stopIndex];
      return r?.location
        ? [
            {
              id: r.form.id,
              lat: r.location.lat,
              lng: r.location.lng,
              kind: "stop" as const,
              text: String(visit + 1),
              title: `${visit + 1}. ${r.customer?.name ?? ""}`,
            },
          ]
        : [];
    }),
  ];
  const lines: MapLine[] = preview?.encodedPolyline ? [{ id: "route", points: decodePolyline(preview.encodedPolyline) }] : [];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-6">
        <Box className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tarih">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Tanker">
            <select className={selectClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Seçin</option>
              {activeVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} ({v.capacityLiters.toLocaleString("tr-TR")} L)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Şoför">
            <select className={selectClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Seçin</option>
              {drivers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </Field>
        </Box>

        <Box>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Duraklar</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStops((l) => [...l, { id: newId(), customerId: "", locationId: "", fuel: "diesel", litersText: "" }]);
                setPreview(null);
              }}
            >
              <Plus className="h-4 w-4" /> Durak ekle
            </Button>
          </div>
          <div className="space-y-3">
            {resolved.map((r, i) => {
              const locs = r.customer?.locations ?? [];
              return (
                <div key={r.form.id} className="grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,1.4fr)_7rem_6rem_auto] md:items-center">
                  <span className="text-sm font-semibold text-muted-foreground">{i + 1}</span>
                  <CustomerPicker
                    customers={activeCustomers}
                    value={r.form.customerId}
                    onChange={(customerId) => {
                      const c = customers.find((x) => x.id === customerId);
                      patch(r.form.id, { customerId, locationId: c?.locations?.[0]?.id ?? "" });
                    }}
                  />
                  <select
                    className={selectClass}
                    value={r.form.locationId}
                    disabled={locs.length <= 1}
                    onChange={(e) => patch(r.form.id, { locationId: e.target.value })}
                  >
                    {locs.length === 0 && <option value="">Teslimat noktası</option>}
                    {locs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <select className={selectClass} value={r.form.fuel} onChange={(e) => patch(r.form.id, { fuel: e.target.value as Fuel })}>
                    {FUELS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    inputMode="decimal"
                    placeholder="Litre"
                    value={r.form.litersText}
                    onChange={(e) => patch(r.form.id, { litersText: e.target.value })}
                  />
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} title="Yukarı">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={i === resolved.length - 1} onClick={() => move(i, 1)} title="Aşağı">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={resolved.length === 1}
                      onClick={() => {
                        setStops((l) => l.filter((s) => s.id !== r.form.id));
                        setPreview(null);
                      }}
                      title="Durağı kaldır"
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                  {r.location?.address && (
                    <p className="text-xs text-muted-foreground md:col-span-5 md:col-start-2">{r.location.address}</p>
                  )}
                </div>
              );
            })}
          </div>
          {activeCustomers.length === 0 && (
            <p className="mt-3 text-sm text-amber-600">Önce Müşteriler bölümünden konumu olan bir müşteri ekleyin.</p>
          )}
        </Box>

        <Box className="space-y-4">
          <Field label="Not (isteğe bağlı)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={optimize}
              onChange={(e) => {
                setOptimize(e.target.checked);
                setPreview(null);
              }}
            />
            Ziyaret sırasını en kısa rotaya göre düzenle
          </label>
        </Box>
      </div>

      <div className="space-y-6">
        <Box>
          <p className="mb-3 text-sm font-semibold">Plan toplamı</p>
          <div className="space-y-1.5 text-sm">
            {totals
              .filter((t) => t.ml > 0)
              .map((t) => (
                <div key={t.key} className="flex justify-between">
                  <span className="text-muted-foreground">{t.label}</span>
                  <span className="font-medium tabular-nums">{liters(t.ml)} L</span>
                </div>
              ))}
            {totals.every((t) => t.ml === 0) && <p className="text-muted-foreground">Henüz litre girilmedi.</p>}
            {vehicle && (
              <div className={`flex justify-between border-t pt-1.5 ${overCapacity ? "text-red-600" : "text-muted-foreground"}`}>
                <span>Tanker kapasitesi</span>
                <span className="tabular-nums">{liters(vehicle.capacityLiters * 1000)} L</span>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="outline" className="h-9" onClick={previewRoute} disabled={busy}>
              {previewing ? <Spinner /> : <MapPinned className="h-4 w-4" />} Rotayı önizle
            </Button>
            <Button className="h-9" onClick={save} disabled={busy}>
              {busy && !previewing ? <Spinner /> : <Save className="h-4 w-4" />}
              {editing ? "Değişiklikleri kaydet" : "Seferi ata"}
            </Button>
          </div>
        </Box>

        <Box>
          <p className="mb-3 text-sm font-semibold">Rota</p>
          <MapView
            markers={markers}
            lines={lines}
            fitKey={`${markers.map((m) => `${m.id}${m.text ?? ""}`).join("|")}|${lines.length}`}
            className="h-80 w-full rounded-lg border"
          />
          {preview ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Yaklaşık {km(preview.distanceMeters)} · {duration((preview.durationSeconds ?? 0) * 1000)}
              {optimize && " · sıra en kısa rotaya göre"}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Rota ve süre için &quot;Rotayı önizle&quot;ye basın. Kayıtta rota yeniden hesaplanır.
            </p>
          )}
        </Box>
      </div>
    </div>
  );
}
