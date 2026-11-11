"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, ReceiptThumb, Spinner, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import type { Refuel } from "@/lib/cark-mobil/types";
import { dateTime, liters, newId, parseMl } from "@/lib/cark-mobil/util";

// Tankerin (aracın) kendi deposuna aldığı yakıt: fiş fotoğrafı + kilometre. Fişteki litre,
// birim fiyat, tarih ve fiş numarası sunucuda okunur (OCR); eksik ya da yanlış okunanı yönetici düzeltir.

function price(v: number | null): string {
  return v == null ? "—" : (v / 10000).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function total(r: Refuel): string {
  if (r.amountMl == null || r.unitPriceTenThousandths == null) return "—";
  return ((r.amountMl / 1000) * (r.unitPriceTenThousandths / 10000)).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function state(r: Refuel): { text: string; tone: "green" | "amber" | "blue" | "muted" } {
  if (r.ocrState === "manual") return { text: "Yönetici düzenledi", tone: "blue" };
  if (r.ocrState === "complete") return { text: "Fiş okundu", tone: "green" };
  if ((r.ocrState === "pending" || r.ocrState === "processing") && Date.now() - (r.ocrStartedAtMs ?? r.capturedAtMs) < 120_000)
    return { text: "Fiş okunuyor", tone: "muted" };
  return { text: "İnceleme gerekli", tone: "amber" };
}

export default function YakitAlimlariPage() {
  const { busy, run } = useOp();
  const [rows, setRows] = useState<Refuel[] | null>(null);
  const [count, setCount] = useState(100);
  const [editing, setEditing] = useState<Refuel | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(collection(fb().db, "vehicleRefuels"), orderBy("createdAt", "desc"), limit(count)),
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Refuel).filter((r) => !r.deleted)),
        () => setRows([])
      ),
    [count]
  );

  const totals = useMemo(() => {
    const list = rows ?? [];
    const ml = list.reduce((a, r) => a + (r.amountMl ?? 0), 0);
    const tl = list.reduce(
      (a, r) => a + (r.amountMl != null && r.unitPriceTenThousandths != null ? (r.amountMl / 1000) * (r.unitPriceTenThousandths / 10000) : 0),
      0
    );
    return { ml, tl };
  }, [rows]);

  async function remove(r: Refuel) {
    if (!confirm("Bu yakıt alımı kaydı kaldırılsın mı? Fiş ve işlem izi arşivde korunur.")) return;
    await run("deleteVehicleRefuel", { id: r.id }, "Kayıt kaldırıldı.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Araç Yakıt Alımları"
        description="Tankerin kendi deposuna alınan yakıt: fiş, kilometre ve okunan tutarlar."
        action={
          <Button className="h-9" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Yakıt alımı ekle
          </Button>
        }
      />

      <Box>
        {rows === null ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <Empty>Henüz yakıt alımı kaydı yok.</Empty>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {rows.length} kayıt · {liters(totals.ml)} L ·{" "}
              <b className="text-foreground">₺{totals.tl.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</b> (okunan kayıtlar)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Fiş</th>
                    <th className="px-3 py-2 font-medium">Kayıt</th>
                    <th className="px-3 py-2 font-medium">Tanker · kişi</th>
                    <th className="px-3 py-2 text-right font-medium">Kilometre</th>
                    <th className="px-3 py-2 text-right font-medium">Litre</th>
                    <th className="px-3 py-2 text-right font-medium">Birim fiyat</th>
                    <th className="px-3 py-2 text-right font-medium">Tutar</th>
                    <th className="px-3 py-2 font-medium">Fiş tarihi · no</th>
                    <th className="px-3 py-2 font-medium">Durum</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = state(r);
                    return (
                      <tr key={r.id} className="border-b align-middle last:border-0">
                        <td className="py-2 pr-3">
                          <ReceiptThumb path={r.receiptPath} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{dateTime(r.capturedAtMs)}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{r.vehiclePlate}</span>
                          <span className="block text-xs text-muted-foreground">{r.driverName}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.odometerKm.toLocaleString("tr-TR")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.amountMl == null ? "—" : liters(r.amountMl)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{price(r.unitPriceTenThousandths)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{total(r)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.receiptDateTime ? r.receiptDateTime.replace("T", " ") : "—"}
                          <span className="block text-xs">{r.receiptNumber ?? ""}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Tag tone={s.tone}>{s.text}</Tag>
                        </td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right">
                          <Button variant="ghost" size="icon-sm" title="Düzelt" onClick={() => setEditing(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" title="Kaldır" disabled={busy} onClick={() => remove(r)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length >= count && (
              <div className="mt-4 text-center">
                <Button variant="outline" size="sm" onClick={() => setCount((n) => n + 100)}>
                  Daha eski kayıtları yükle
                </Button>
              </div>
            )}
          </>
        )}
      </Box>

      {editing && <RefuelFix refuel={editing} onClose={() => setEditing(null)} />}
      {adding && <RefuelAdd onClose={() => setAdding(false)} />}
    </div>
  );
}

function RefuelFix({ refuel, onClose }: { refuel: Refuel; onClose: () => void }) {
  const { busy, run } = useOp();
  const [odometer, setOdometer] = useState(String(refuel.odometerKm));
  const [amount, setAmount] = useState(refuel.amountMl == null ? "" : String(refuel.amountMl / 1000).replace(".", ","));
  const [unit, setUnit] = useState(refuel.unitPriceTenThousandths == null ? "" : String(refuel.unitPriceTenThousandths / 10000).replace(".", ","));
  const [when, setWhen] = useState(refuel.receiptDateTime ?? "");
  const [number, setNumber] = useState(refuel.receiptNumber ?? "");

  async function save() {
    const odometerKm = Number(odometer.replace(/\D/g, ""));
    if (!odometer.trim() || !Number.isInteger(odometerKm)) return toast.error("Kilometreyi girin.");
    const amountMl = amount.trim() ? parseMl(amount) : null;
    if (amount.trim() && (!amountMl || amountMl <= 0)) return toast.error("Litre geçersiz.");
    let unitPrice: number | null = null;
    if (unit.trim()) {
      if (!/^\d+(?:[.,]\d{1,4})?$/.test(unit.trim())) return toast.error("Birim fiyat geçersiz (ör. 54,95).");
      unitPrice = Math.round(Number(unit.trim().replace(",", ".")) * 10000);
      if (unitPrice <= 0) return toast.error("Birim fiyat geçersiz.");
    }
    const ok = await run(
      "correctVehicleRefuel",
      {
        id: refuel.id,
        revision: refuel.revision,
        odometerKm,
        amountMl,
        unitPriceTenThousandths: unitPrice,
        receiptDateTime: when || null,
        receiptNumber: number.trim() || null,
      },
      "Kayıt düzeltildi."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Yakıt alımını düzelt" description={`${refuel.vehiclePlate ?? ""} · ${dateTime(refuel.capturedAtMs)}`}>
      <div className="space-y-4">
        <div className="flex justify-center">
          <ReceiptThumb path={refuel.receiptPath} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kilometre">
            <Input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </Field>
          <Field label="Litre">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Birim fiyat (TL/L)">
            <Input inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Fiş numarası">
            <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Fiş tarihi ve saati" className="col-span-2">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        </div>
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

// Seçilen görseli en çok 2000 piksele küçültüp JPEG'e çevirir (sunucu yalnız JPEG kabul eder).
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Fotoğraf işlenemedi."))), "image/jpeg", 0.85)
  );
}

function RefuelAdd({ onClose }: { onClose: () => void }) {
  const { vehicles, me } = useCark();
  const { busy, run } = useOp();
  const active = vehicles.filter((v) => v.active);
  const [vehicleId, setVehicleId] = useState(active.length === 1 ? active[0].id : "");
  const [odometer, setOdometer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function save() {
    const odometerKm = Number(odometer.replace(/\D/g, ""));
    if (!vehicleId) return toast.error("Tanker seçin.");
    if (!file) return toast.error("Fiş fotoğrafını seçin.");
    if (!odometer.trim() || !Number.isInteger(odometerKm)) return toast.error("Toplam kilometreyi girin.");
    const operationId = newId();
    const receiptPath = `vehicle-refuels/${me!.id}/${operationId}.jpg`;
    setUploading(true);
    try {
      await uploadBytes(ref(fb().storage, receiptPath), await toJpeg(file), { contentType: "image/jpeg" });
    } catch (e) {
      setUploading(false);
      return toast.error(`Fiş yüklenemedi: ${errorText(e)}`);
    }
    setUploading(false);
    const ok = await run(
      "recordVehicleRefuel",
      { operationId, vehicleId, odometerKm, capturedAtMs: Date.now(), receiptPath },
      "Yakıt alımı kaydedildi; fiş okunuyor."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Yakıt alımı ekle" description="Fişteki litre, fiyat ve tarih kendiliğinden okunur; sonra düzeltebilirsiniz.">
      <div className="space-y-4">
        <Field label="Tanker">
          <select className={selectClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Seçin</option>
            {active.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fiş fotoğrafı">
          <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Toplam kilometre">
          <Input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy || uploading}>
            {(busy || uploading) && <Spinner />} Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}
