"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Link2, Map as MapIcon, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { callOp, errorText } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { MapView, type MapMarker } from "@/components/cark-mobil/map";
import { Box, Empty, Field, Modal, PageHeader, ReceiptThumb, Spinner, Tag, useOp } from "@/components/cark-mobil/ui";
import type { Customer, CustomerHistoryRow, CustomerLocation, Phone } from "@/lib/cark-mobil/types";
import { customerPhones, dateTime, displayPhone, fuelName, liters, newId, normalizePhone, validPhone } from "@/lib/cark-mobil/util";

type Place = { id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } };

export default function MusterilerPage() {
  const { customers } = useCark();
  const { busy, run } = useOp();
  const [q, setQ] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [history, setHistory] = useState<Customer | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return customers
      .filter((c) => {
        if (!needle) return true;
        const text = [c.name, c.taxNumber, ...customerPhones(c).map((p) => p.number), ...(c.locations ?? []).map((l) => l.address)]
          .join(" ")
          .toLocaleLowerCase("tr");
        return text.includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [customers, q]);

  const markers = useMemo<MapMarker[]>(
    () =>
      list.flatMap((c) =>
        (c.locations ?? []).map((l) => ({ id: `${c.id}-${l.id}`, lat: l.lat, lng: l.lng, kind: "pin" as const, title: `${c.name} · ${l.label}` }))
      ),
    [list]
  );

  async function remove(c: Customer) {
    if (!confirm(`${c.name} müşteri listesinden kaldırılsın mı? Geçmiş teslimat kayıtları korunur.`)) return;
    await run("deleteCustomer", { id: c.id }, "Müşteri kaldırıldı.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Müşteriler"
        description="Müşteriler, telefonları ve teslimat noktaları. Şoförler bu bilgileri seferde görür."
        action={
          <div className="flex gap-2">
            <Button variant="outline" className="h-9" onClick={() => setShowMap((s) => !s)}>
              <MapIcon className="h-4 w-4" /> {showMap ? "Haritayı gizle" : "Haritada göster"}
            </Button>
            <Button className="h-9" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Yeni müşteri
            </Button>
          </div>
        }
      />

      {showMap && (
        <Box>
          <MapView markers={markers} fitKey={`${markers.length}`} className="h-96 w-full rounded-lg border" />
        </Box>
      )}

      <Box>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon, vergi no ya da adres ara" className="pl-8" />
          </div>
          <span className="text-xs text-muted-foreground">{list.length} müşteri</span>
        </div>
        {list.length === 0 ? (
          <Empty>Müşteri bulunamadı.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Müşteri</th>
                  <th className="px-3 py-2 font-medium">Telefon</th>
                  <th className="px-3 py-2 font-medium">Teslimat noktaları</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{c.name}</span>
                      {c.active === false && (
                        <span className="ml-2">
                          <Tag>Pasif</Tag>
                        </span>
                      )}
                      {c.taxNumber && <p className="text-xs text-muted-foreground">Vergi no: {c.taxNumber}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {customerPhones(c).map((p) => (
                        <p key={p.number}>
                          {displayPhone(p.number)}
                          {p.label && <span className="text-xs"> · {p.label}</span>}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {(c.locations ?? []).map((l) => (
                        <p key={l.id} className="max-w-md truncate">
                          <span className="text-foreground">{l.label}</span>
                          {l.address && ` · ${l.address}`}
                        </p>
                      ))}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-3 text-right">
                      <Button variant="ghost" size="icon-sm" title="Teslimat geçmişi" onClick={() => setHistory(c)}>
                        <History className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="Düzenle" onClick={() => setEditing(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="Kaldır" disabled={busy} onClick={() => remove(c)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      {editing && <CustomerForm customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {history && <CustomerHistory customer={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { settings } = useCark();
  const { busy, run } = useOp();
  const [name, setName] = useState(customer?.name ?? "");
  const [taxNumber, setTaxNumber] = useState(customer?.taxNumber ?? "");
  const [active, setActive] = useState(customer?.active ?? true);
  const [phones, setPhones] = useState<Phone[]>(() => (customer ? customerPhones(customer) : []));
  const [locations, setLocations] = useState<CustomerLocation[]>(
    () => customer?.locations?.map((l) => ({ ...l })) ?? [{ id: newId(), label: "Merkez", address: "", notes: "", lat: NaN, lng: NaN }]
  );
  const [current, setCurrent] = useState(0); // haritada düzenlenen nokta
  const [searchText, setSearchText] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [linkText, setLinkText] = useState("");
  const [looking, setLooking] = useState(false);

  const loc = locations[Math.min(current, locations.length - 1)];
  const patchLoc = (change: Partial<CustomerLocation>) =>
    setLocations((list) => list.map((l, i) => (i === Math.min(current, list.length - 1) ? { ...l, ...change } : l)));

  async function search() {
    if (searchText.trim().length < 3) return toast.error("Aramak için en az 3 harf yazın.");
    setLooking(true);
    try {
      const r = await callOp<{ places: Place[] }>("searchPlaces", { query: searchText.trim() });
      setPlaces(r.places ?? []);
      if (!r.places?.length) toast.info("Sonuç bulunamadı.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLooking(false);
    }
  }
  async function resolveLink() {
    if (linkText.trim().length < 10) return toast.error("Google ya da Yandex harita bağlantısını yapıştırın.");
    setLooking(true);
    try {
      const r = await callOp<{ lat: number; lng: number }>("resolveMapsLink", { url: linkText.trim() });
      patchLoc({ lat: r.lat, lng: r.lng });
      setLinkText("");
      toast.success("Konum bağlantıdan alındı.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLooking(false);
    }
  }

  async function save() {
    if (name.trim().length < 2) return toast.error("Müşteri adını girin.");
    if (taxNumber && !/^(\d{10}|\d{11})$/.test(taxNumber.trim())) return toast.error("Vergi numarası 10, T.C. kimlik numarası 11 haneli olmalı.");
    const cleanPhones = phones.filter((p) => p.number.trim());
    for (const p of cleanPhones) if (!validPhone(p.number)) return toast.error(`Telefon numarası geçersiz: ${p.number}`);
    for (const [i, l] of locations.entries()) {
      if (!l.label.trim()) return toast.error(`${i + 1}. teslimat noktasına bir ad verin.`);
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return toast.error(`"${l.label}" için haritadan konum seçin.`);
    }
    const ok = await run(
      "saveCustomer",
      {
        id: customer?.id ?? newId(),
        name: name.trim(),
        taxNumber: taxNumber.trim(),
        phone: "",
        phones: cleanPhones.map((p) => ({ label: p.label.trim(), number: normalizePhone(p.number) })),
        active,
        locations: locations.map((l) => ({
          id: l.id,
          label: l.label.trim(),
          address: l.address.trim(),
          notes: l.notes.trim(),
          lat: l.lat,
          lng: l.lng,
        })),
      },
      "Müşteri kaydedildi."
    );
    if (ok) onClose();
  }

  const hasPoint = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
  const markers: MapMarker[] = locations
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, kind: l.id === loc?.id ? "pin" : "skipped", title: l.label }));

  return (
    <Modal open onClose={onClose} wide title={customer ? "Müşteriyi düzenle" : "Yeni müşteri"}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Müşteri adı">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vergi / T.C. no (isteğe bağlı)">
              <Input inputMode="numeric" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value.replace(/\D/g, ""))} maxLength={11} />
            </Field>
            <label className="flex items-end gap-2 pb-1.5 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium">Telefonlar</p>
              <Button variant="outline" size="sm" onClick={() => setPhones((l) => [...l, { label: "", number: "" }])}>
                <Plus className="h-4 w-4" /> Telefon ekle
              </Button>
            </div>
            <div className="space-y-2">
              {phones.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="0532 123 45 67"
                    value={p.number}
                    onChange={(e) => setPhones((l) => l.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))}
                  />
                  <Input
                    placeholder="Açıklama (ör. muhasebe)"
                    value={p.label}
                    maxLength={60}
                    onChange={(e) => setPhones((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <Button variant="ghost" size="icon" onClick={() => setPhones((l) => l.filter((_, j) => j !== i))} title="Kaldır">
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ))}
              {phones.length === 0 && <p className="text-xs text-muted-foreground">Telefon eklenmedi.</p>}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium">Teslimat noktaları</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLocations((l) => [...l, { id: newId(), label: `Nokta ${l.length + 1}`, address: "", notes: "", lat: NaN, lng: NaN }]);
                  setCurrent(locations.length);
                }}
              >
                <Plus className="h-4 w-4" /> Nokta ekle
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l, i) => (
                <button
                  key={l.id}
                  onClick={() => setCurrent(i)}
                  className={`rounded-full border px-3 py-1 text-xs ${l.id === loc?.id ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}
                >
                  {l.label || `Nokta ${i + 1}`}
                  {!Number.isFinite(l.lat) && " ·konum yok"}
                </button>
              ))}
            </div>
            {loc && (
              <div className="mt-3 space-y-3 rounded-lg border p-3">
                <div className="flex gap-2">
                  <Input value={loc.label} onChange={(e) => patchLoc({ label: e.target.value })} placeholder="Nokta adı" maxLength={100} />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={locations.length === 1}
                    title="Noktayı kaldır"
                    onClick={() => {
                      setLocations((l) => l.filter((x) => x.id !== loc.id));
                      setCurrent(0);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
                <Textarea value={loc.address} onChange={(e) => patchLoc({ address: e.target.value })} placeholder="Adres" rows={2} maxLength={500} />
                <Textarea
                  value={loc.notes}
                  onChange={(e) => patchLoc({ notes: e.target.value })}
                  placeholder="Şoföre not (ör. arka kapıdan girilir)"
                  rows={2}
                  maxLength={1000}
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">
            Konum: {loc?.label} {hasPoint ? <span className="font-normal text-muted-foreground">({loc.lat.toFixed(5)}, {loc.lng.toFixed(5)})</span> : <span className="font-normal text-amber-600">seçilmedi</span>}
          </p>
          <div className="flex gap-2">
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Adres ya da işletme ara"
            />
            <Button variant="outline" onClick={search} disabled={looking}>
              {looking ? <Spinner /> : <Search className="h-4 w-4" />} Ara
            </Button>
          </div>
          {places.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-1.5">
              {places.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    if (!p.location) return;
                    patchLoc({ lat: p.location.latitude, lng: p.location.longitude, address: loc?.address || p.formattedAddress || "" });
                    setPlaces([]);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{p.displayName?.text}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.formattedAddress}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Google / Yandex harita bağlantısı yapıştırın" />
            <Button variant="outline" onClick={resolveLink} disabled={looking}>
              <Link2 className="h-4 w-4" /> Konumu al
            </Button>
          </div>
          <MapView
            markers={markers}
            center={settings.depot}
            onPick={(lat, lng) => patchLoc({ lat, lng })}
            fitKey={`${loc?.id}|${hasPoint ? `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}` : ""}`}
            className="h-72 w-full rounded-lg border"
          />
          <p className="text-xs text-muted-foreground">Konumu değiştirmek için haritaya tıklayın.</p>
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" className="h-9" onClick={onClose}>
          Vazgeç
        </Button>
        <Button className="h-9" onClick={save} disabled={busy}>
          {busy && <Spinner />} Kaydet
        </Button>
      </div>
    </Modal>
  );
}

// Müşterinin gerçekleşen teslimatları (yüklenen sefer listesindeki seferlerden, sunucuda okunur).
function CustomerHistory({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { trips, tripLimit, loadMoreTrips } = useCark();
  const [rows, setRows] = useState<CustomerHistoryRow[] | null>(null);
  const [error, setError] = useState("");

  const tripIds = useMemo(
    () => trips.filter((t) => (t.stops ?? []).some((s) => s.customerId === customer.id)).map((t) => t.id),
    [trips, customer.id]
  );
  const key = tripIds.join("|");

  useEffect(() => {
    let alive = true;
    (async () => {
      setError("");
      try {
        const all: CustomerHistoryRow[] = [];
        for (let i = 0; i < tripIds.length; i += 20) {
          const r = await callOp<{ entries: CustomerHistoryRow[] }>("customerDeliveryHistory", {
            customerId: customer.id,
            tripIds: tripIds.slice(i, i + 20),
          });
          all.push(...(r.entries ?? []));
        }
        all.sort((a, b) => (b.capturedAtMs ?? 0) - (a.capturedAtMs ?? 0));
        if (alive) setRows(all);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, key]);

  const total = (rows ?? []).reduce((a, r) => a + r.actualMl, 0);

  return (
    <Modal open onClose={onClose} wide title={`${customer.name} · teslimat geçmişi`}>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : rows === null ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Yüklenen seferlerde bu müşteriye teslimat yok.</Empty>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} teslimat · toplam <b className="text-foreground">{liters(total)} L</b>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Tarih</th>
                  <th className="px-3 py-2 font-medium">Ürün</th>
                  <th className="px-3 py-2 text-right font-medium">Teslim</th>
                  <th className="px-3 py-2 font-medium">Tanker · şoför</th>
                  <th className="py-2 pl-3 font-medium">Fiş</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{dateTime(r.capturedAtMs)}</td>
                    <td className="px-3 py-2">{fuelName(r.fuel)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{liters(r.actualMl)} L</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.vehiclePlate} · {r.driverName}
                    </td>
                    <td className="py-2 pl-3">
                      <div className="flex flex-wrap gap-2">
                        {r.receiptPaths.map((p) => (
                          <ReceiptThumb key={p} path={p} />
                        ))}
                        {r.receiptMissing && <Tag tone="red">Fiş yok</Tag>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {trips.length >= tripLimit && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={loadMoreTrips}>
            Daha eski seferlere de bak
          </Button>
        </div>
      )}
    </Modal>
  );
}
