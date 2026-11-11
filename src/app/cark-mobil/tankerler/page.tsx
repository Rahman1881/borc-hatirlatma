"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { History, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, Spinner, Tag, useOp } from "@/components/cark-mobil/ui";
import type { FuelHistoryEntry, Vehicle } from "@/lib/cark-mobil/types";
import { dateTime, liters, newId, parseMl } from "@/lib/cark-mobil/util";

// Tankerler ve tankerde taşınan yakıtın elle tutulan stoku. Bu stok, teslimatlardan ya da
// aracın kendi yakıt alımlarından kendiliğinden düşmez (mobil uygulamadaki kural).

export default function TankerlerPage() {
  const { vehicles } = useCark();
  const { busy, run } = useOp();
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [stock, setStock] = useState<{ vehicle: Vehicle; kind: "add" | "remove" } | null>(null);
  const [history, setHistory] = useState<Vehicle | null>(null);

  const list = [...vehicles].sort((a, b) => Number(b.active ?? false) - Number(a.active ?? false) || a.plate.localeCompare(b.plate, "tr"));

  async function remove(v: Vehicle) {
    if (!confirm(`${v.plate} silinsin mi? Sefer ya da yakıt geçmişi olan tanker silinemez, pasife alınabilir.`)) return;
    await run("deleteVehicle", { id: v.id }, "Tanker silindi.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tankerler"
        description="Tanker kayıtları ve tankerdeki yakıt miktarı."
        action={
          <Button className="h-9" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Yeni tanker
          </Button>
        }
      />

      {list.length === 0 ? (
        <Box>
          <Empty>Henüz tanker eklenmedi.</Empty>
        </Box>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((v) => {
            const cap = v.capacityLiters * 1000;
            const pct = v.remainingFuelMl == null ? 0 : Math.min(100, Math.round((v.remainingFuelMl / cap) * 100));
            return (
              <Box key={v.id} className={v.active ? "" : "opacity-70"}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">{v.plate}</p>
                    <p className="text-xs text-muted-foreground">Kapasite {v.capacityLiters.toLocaleString("tr-TR")} L</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!v.active && <Tag>Pasif</Tag>}
                    <Button variant="ghost" size="icon-sm" title="Düzenle" onClick={() => setEditing(v)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Sil" disabled={busy} onClick={() => remove(v)}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold tabular-nums">
                      {v.remainingFuelMl == null ? "—" : `${liters(v.remainingFuelMl)} L`}
                    </span>
                    <span className="text-sm text-muted-foreground">{v.remainingFuelMl == null ? "Miktar girilmedi" : `%${pct} dolu`}</span>
                  </div>
                  <div className="mt-2 h-3 rounded-full bg-muted">
                    <div className="h-3 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStock({ vehicle: v, kind: "add" })}>
                    <Plus className="h-4 w-4" /> Yakıt ekle
                  </Button>
                  <Button variant="outline" size="sm" disabled={v.remainingFuelMl == null} onClick={() => setStock({ vehicle: v, kind: "remove" })}>
                    <Minus className="h-4 w-4" /> Yakıt çıkar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setHistory(v)}>
                    <History className="h-4 w-4" /> Geçmiş
                  </Button>
                </div>
              </Box>
            );
          })}
        </div>
      )}

      {editing && <VehicleForm vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {stock && <StockForm vehicle={stock.vehicle} kind={stock.kind} onClose={() => setStock(null)} />}
      {history && <StockHistory vehicle={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function VehicleForm({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const { busy, run } = useOp();
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [capacity, setCapacity] = useState(vehicle ? String(vehicle.capacityLiters) : "");
  const [active, setActive] = useState(vehicle?.active ?? true);

  async function save() {
    const capacityLiters = Number(capacity.replace(/\./g, "").replace(",", "."));
    if (plate.trim().length < 3) return toast.error("Plakayı girin.");
    if (!Number.isFinite(capacityLiters) || capacityLiters <= 0) return toast.error("Kapasiteyi litre olarak girin.");
    const ok = await run(
      "saveVehicle",
      { id: vehicle?.id ?? newId(), plate: plate.trim().toLocaleUpperCase("tr"), capacityLiters, active },
      "Tanker kaydedildi."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={vehicle ? "Tankeri düzenle" : "Yeni tanker"}>
      <div className="space-y-4">
        <Field label="Plaka">
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={30} placeholder="54 ABC 123" />
        </Field>
        <Field label="Kapasite (litre)">
          <Input inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="20000" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif (sefer planlamada görünür)
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StockForm({ vehicle, kind, onClose }: { vehicle: Vehicle; kind: "add" | "remove"; onClose: () => void }) {
  const { busy, run } = useOp();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  async function save() {
    const amountMl = parseMl(amount);
    if (!amountMl || amountMl <= 0) return toast.error("Miktarı litre olarak girin.");
    const ok = await run(
      "adjustVehicleStock",
      { vehicleId: vehicle.id, operationId: newId(), kind, amountMl, note: note.trim() },
      kind === "add" ? "Yakıt eklendi." : "Yakıt çıkarıldı."
    );
    if (ok) onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${vehicle.plate} · ${kind === "add" ? "yakıt ekle" : "yakıt çıkar"}`}
      description={`Şu an tankerde: ${vehicle.remainingFuelMl == null ? "miktar girilmedi" : `${liters(vehicle.remainingFuelMl)} L`}`}
    >
      <div className="space-y-4">
        <Field label="Miktar (litre)">
          <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Not (isteğe bağlı)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} {kind === "add" ? "Ekle" : "Çıkar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const KIND: Record<FuelHistoryEntry["kind"], string> = { add: "Eklendi", remove: "Çıkarıldı", set: "Miktar girildi" };

function StockHistory({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const [rows, setRows] = useState<FuelHistoryEntry[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        query(collection(fb().db, "vehicles", vehicle.id, "fuelHistory"), orderBy("createdAt", "desc"), limit(200)),
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as FuelHistoryEntry)),
        () => setRows([])
      ),
    [vehicle.id]
  );

  return (
    <Modal open onClose={onClose} wide title={`${vehicle.plate} · yakıt hareketleri`}>
      {rows === null ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Henüz yakıt hareketi yok.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Tarih</th>
                <th className="px-3 py-2 font-medium">İşlem</th>
                <th className="px-3 py-2 text-right font-medium">Miktar</th>
                <th className="px-3 py-2 text-right font-medium">Önce → sonra</th>
                <th className="px-3 py-2 font-medium">Kişi</th>
                <th className="py-2 pl-3 font-medium">Not</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3">{dateTime(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Tag tone={r.kind === "add" ? "green" : r.kind === "remove" ? "amber" : "muted"}>{KIND[r.kind] ?? r.kind}</Tag>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{liters(r.amountMl)} L</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.beforeMl == null ? "—" : liters(r.beforeMl)} → {r.afterMl == null ? "—" : liters(r.afterMl)} L
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.actorName}</td>
                  <td className="py-2 pl-3 text-muted-foreground">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
