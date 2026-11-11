"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { limitToLast, onValue, orderByChild, query as rtdbQuery, ref } from "firebase/database";
import { ArrowLeft, Ban, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { callOp, fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { MapView, type MapLine, type MapMarker } from "@/components/cark-mobil/map";
import { Box, Empty, Field, Modal, PageHeader, ReceiptThumb, Spinner, StatusPill, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import type { Delivery, Stop, TrackPoint, Trip, TripSummary, Wait } from "@/lib/cark-mobil/types";
import {
  DEFAULT_DEPOT,
  clock,
  dateTime,
  decodePolyline,
  displayPhone,
  duration,
  fuelName,
  isoDay,
  km,
  liters,
  newId,
  parseMl,
  plannedTotal,
} from "@/lib/cark-mobil/util";

const GAP_MS = 120_000; // bundan uzun GPS kesintisi düz çizgiyle birleştirilmez

const DELIVERY_LABEL: Record<Delivery["status"], { text: string; tone: "green" | "amber" | "muted" }> = {
  delivered: { text: "Teslim edildi", tone: "green" },
  partial: { text: "Farklı miktar", tone: "amber" },
  skipped: { text: "Atlandı", tone: "muted" },
};

export default function SeferDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { live, settings } = useCark();
  const { busy, run } = useOp();
  const depot = settings.depot ?? DEFAULT_DEPOT;

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [waits, setWaits] = useState<Wait[]>([]);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [fixing, setFixing] = useState<{ stop: Stop; delivery: Delivery } | null>(null);

  useEffect(() => {
    const { db } = fb();
    const tripRef = doc(db, "trips", id);
    const subs = [
      onSnapshot(
        tripRef,
        (s) => setTrip(s.exists() && !s.data().deleted ? ({ id: s.id, ...s.data() } as Trip) : null),
        () => setTrip(null)
      ),
      onSnapshot(collection(tripRef, "deliveries"), (s) =>
        setDeliveries(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Delivery))
      ),
      onSnapshot(collection(tripRef, "waits"), (s) =>
        setWaits(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Wait).sort((a, b) => a.startedAtMs - b.startedAtMs))
      ),
    ];
    return () => subs.forEach((off) => off());
  }, [id]);

  // Kaydedilen GPS izi (sefer başladıysa). Yoldayken yeni noktalar geldikçe güncellenir.
  const started = !!trip?.startedAtMs;
  useEffect(() => {
    if (!started) return;
    return onValue(
      rtdbQuery(ref(fb().rtdb, `tracks/${id}`), orderByChild("capturedAtMs"), limitToLast(8000)),
      (s) => {
        const points = Object.values((s.val() as Record<string, TrackPoint>) ?? {})
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
        setTrack(points);
      },
      () => setTrack([])
    );
  }, [id, started]);

  // Biten seferin özeti (GPS kilometresi, bekleme, eksik fiş) sunucuda hesaplanır.
  const finished = trip?.status === "completed" || trip?.status === "cancelled";
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    callOp<{ summaries: Record<string, TripSummary> }>("tripHistorySummaries", { tripIds: [id] })
      .then((r) => alive && setSummary(r.summaries?.[id] ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, finished, deliveries.length]);

  const byStop = useMemo(() => new Map(deliveries.map((d) => [d.stopId ?? d.id, d])), [deliveries]);

  const { markers, lines } = useMemo(() => {
    const m: MapMarker[] = [{ id: "depot", lat: depot.lat, lng: depot.lng, kind: "depot", title: settings.depotName || "Merkez" }];
    const l: MapLine[] = [];
    if (!trip) return { markers: m, lines: l };
    (trip.stops ?? []).forEach((s, i) => {
      const d = byStop.get(s.id);
      m.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        kind: !d ? "stop" : d.status === "skipped" ? "skipped" : "done",
        text: String(i + 1),
        title: `${i + 1}. ${s.customerName}`,
      });
    });
    if (trip.route?.encodedPolyline) {
      l.push({ id: "plan", points: decodePolyline(trip.route.encodedPolyline), color: "#94a3b8", dashed: true, weight: 3 });
    }
    // GPS izi: kesintilerde parçalara bölünür (sahte düz çizgi çizilmez).
    let segment: [number, number][] = [];
    let last = 0;
    track.forEach((p) => {
      if (segment.length && p.capturedAtMs - last > GAP_MS) {
        l.push({ id: `gps-${l.length}`, points: segment });
        segment = [];
      }
      segment.push([p.lat, p.lng]);
      last = p.capturedAtMs;
    });
    if (segment.length) l.push({ id: `gps-${l.length}`, points: segment });

    const pos = live[trip.driverId];
    if ((trip.status === "active" || trip.status === "returning") && pos && pos.tripId === trip.id) {
      m.push({
        id: "tanker",
        lat: pos.lat,
        lng: pos.lng,
        kind: "tanker",
        title: `${trip.vehiclePlate ?? ""} · son konum ${clock(pos.capturedAtMs)}`,
      });
    }
    return { markers: m, lines: l };
  }, [trip, byStop, track, live, depot.lat, depot.lng, settings.depotName]);

  if (trip === undefined) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner />
      </div>
    );
  }
  if (trip === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Empty>Sefer bulunamadı ya da silinmiş.</Empty>
      </div>
    );
  }

  const stops = trip.stops ?? [];
  const pos = live[trip.driverId];
  const livePos = (trip.status === "active" || trip.status === "returning") && pos?.tripId === trip.id ? pos : null;

  async function cancel() {
    if (!confirm("Bu sefer iptal edilsin mi? Şoföre bildirim gider.")) return;
    await run("tripAction", { tripId: id, operationId: newId(), kind: "cancel" }, "Sefer iptal edildi.");
  }
  async function remove() {
    if (!confirm("Sefer listeden kaldırılsın mı? Teslimat ve fiş kayıtları arşivde korunur.")) return;
    const ok = await run("deleteTrip", { id }, "Sefer kaldırıldı.");
    if (ok) router.push("/cark-mobil/seferler");
  }
  async function removeReceipt(stopId: string, path: string) {
    if (!confirm("Bu fiş fotoğrafı teslimattan kaldırılsın mı?")) return;
    await run("deleteDeliveryReceipt", { tripId: id, stopId, operationId: newId(), path }, "Fiş kaldırıldı.");
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`${trip.vehiclePlate ?? "Sefer"} · ${trip.driverName ?? ""}`}
        description={`${isoDay(trip.date)} · ${stops.length} durak · planlanan ${liters(plannedTotal(stops))} L`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={trip.status} />
            {trip.status === "assigned" && (
              <>
                <Link href={`/cark-mobil/seferler/${id}/duzenle`} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                  <Pencil className="h-4 w-4" /> Düzenle
                </Link>
                <Button variant="destructive" className="h-9" onClick={cancel} disabled={busy}>
                  <Ban className="h-4 w-4" /> İptal et
                </Button>
              </>
            )}
            {finished && (
              <Button variant="destructive" className="h-9" onClick={remove} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Kaldır
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Teslim edilen", `${liters(trip.deliveredMl)} L`],
          ["Sonuçlanan durak", `${trip.resolvedCount ?? 0} / ${stops.length}`],
          ["Başlangıç – bitiş", `${clock(trip.startedAtMs)} – ${clock(trip.endedAtMs)}`],
          [
            finished ? "GPS mesafesi" : "Planlanan rota",
            finished ? km(summary?.distanceMeters) : `${km(trip.route?.distanceMeters)} · ${duration((trip.route?.durationSeconds ?? 0) * 1000)}`,
          ],
        ].map(([label, value]) => (
          <Box key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
          </Box>
        ))}
      </div>

      <Box>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Harita</p>
          <p className="text-xs text-muted-foreground">
            {livePos
              ? `Canlı konum · son güncelleme ${clock(livePos.capturedAtMs)}`
              : trip.status === "active" || trip.status === "returning"
                ? "Tankerden henüz konum gelmedi."
                : track.length
                  ? "Mavi: kaydedilen GPS izi · gri kesik: planlanan rota"
                  : "Gri kesik: planlanan rota"}
          </p>
        </div>
        <MapView
          markers={markers}
          lines={lines}
          fitKey={`${trip.id}|${stops.length}|${track.length > 0}|${trip.status}`}
          className="h-[26rem] w-full rounded-lg border"
        />
        {finished && summary && (summary.gpsGapCount > 0 || summary.trackTruncated) && (
          <p className="mt-2 text-xs text-muted-foreground">
            GPS kaydında {summary.gpsGapCount} kesinti var; mesafe yalnız kaydedilen kısımları kapsar.
          </p>
        )}
      </Box>

      <Box>
        <p className="mb-3 text-sm font-semibold">Duraklar ve teslimatlar</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Müşteri</th>
                <th className="px-3 py-2 font-medium">Ürün</th>
                <th className="px-3 py-2 text-right font-medium">Planlanan</th>
                <th className="px-3 py-2 text-right font-medium">Teslim</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Fişler</th>
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => {
                const d = byStop.get(s.id);
                const phones = s.phones?.length ? s.phones : s.phone ? [{ label: "", number: s.phone }] : [];
                return (
                  <tr key={s.id} className="border-b align-top last:border-0">
                    <td className="py-3 pr-3 font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{s.customerName}</p>
                      <p className="text-xs text-muted-foreground">{s.address}</p>
                      {phones.length > 0 && (
                        <p className="text-xs text-muted-foreground">{phones.map((p) => displayPhone(p.number)).join(" · ")}</p>
                      )}
                      {s.notes && <p className="mt-0.5 text-xs text-muted-foreground">Not: {s.notes}</p>}
                    </td>
                    <td className="px-3 py-3">{fuelName(s.fuel)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{liters(s.plannedMl)} L</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{d ? `${liters(d.actualMl)} L` : "—"}</td>
                    <td className="px-3 py-3">
                      {d ? (
                        <>
                          <Tag tone={DELIVERY_LABEL[d.status].tone}>{DELIVERY_LABEL[d.status].text}</Tag>
                          <p className="mt-1 text-xs text-muted-foreground">{dateTime(d.capturedAtMs)}</p>
                          {d.note && <p className="mt-0.5 max-w-48 text-xs text-muted-foreground">{d.note}</p>}
                        </>
                      ) : (
                        <Tag>Bekliyor</Tag>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {d && (
                        <div className="flex flex-wrap gap-2">
                          {(d.receiptPaths ?? []).map((path) => (
                            <ReceiptThumb
                              key={path}
                              path={path}
                              onRemove={trip.status === "completed" ? () => removeReceipt(s.id, path) : undefined}
                            />
                          ))}
                          {d.actualMl > 0 && !(d.receiptPaths ?? []).length && (
                            <div>
                              <Tag tone="red">Fiş yok</Tag>
                              {d.missingReceiptReason && (
                                <p className="mt-1 max-w-40 text-xs text-muted-foreground">{d.missingReceiptReason}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      {d && (
                        <Button variant="outline" size="sm" onClick={() => setFixing({ stop: s, delivery: d })}>
                          Düzelt
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {trip.notes && <p className="mt-3 text-sm text-muted-foreground">Sefer notu: {trip.notes}</p>}
      </Box>

      {waits.length > 0 && (
        <Box>
          <p className="mb-3 text-sm font-semibold">
            Beklemeler{summary ? ` · toplam ${duration(summary.waitingMs)}` : ""}
          </p>
          <div className="space-y-2 text-sm">
            {waits.map((w) => (
              <div key={w.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="tabular-nums text-muted-foreground">
                  {clock(w.startedAtMs)} – {w.endedAtMs ? clock(w.endedAtMs) : "sürüyor"}
                </span>
                <span>{w.reason}</span>
                {w.endedAtMs && <span className="text-xs text-muted-foreground">{duration(w.endedAtMs - w.startedAtMs)}</span>}
              </div>
            ))}
          </div>
        </Box>
      )}

      {fixing && <FixDelivery tripId={id} stop={fixing.stop} delivery={fixing.delivery} onClose={() => setFixing(null)} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/cark-mobil/seferler" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Seferler
    </Link>
  );
}

// Kaydedilmiş teslimatı yönetici düzeltir (gerçek litre planlanandan fazla olabilir). Fişler,
// teslimat zamanı ve konumu olduğu gibi korunur; önceki değer sunucuda düzeltme kaydına yazılır.
function FixDelivery({ tripId, stop, delivery, onClose }: { tripId: string; stop: Stop; delivery: Delivery; onClose: () => void }) {
  const { busy, run } = useOp();
  const [status, setStatus] = useState<Delivery["status"]>(delivery.status);
  const [litersText, setLitersText] = useState(String(delivery.actualMl / 1000).replace(".", ","));
  const [note, setNote] = useState(delivery.note ?? "");
  const [reason, setReason] = useState(delivery.missingReceiptReason ?? "");
  const receipts = delivery.receiptPaths ?? [];

  const actualMl = status === "skipped" ? 0 : status === "delivered" ? stop.plannedMl : parseMl(litersText);
  const needsReason = (actualMl ?? 0) > 0 && receipts.length === 0;

  async function save() {
    if (status === "partial" && (!actualMl || actualMl <= 0)) return toast.error("Teslim edilen litreyi girin.");
    if (status !== "delivered" && note.trim().length < 3) return toast.error("Açıklama girin (en az 3 harf).");
    if (needsReason && reason.trim().length < 5) return toast.error("Fiş olmadığı için gerekçe girin.");
    const ok = await run(
      "recordDelivery",
      {
        tripId,
        operationId: newId(),
        delivery: {
          stopId: stop.id,
          status,
          actualMl: actualMl ?? 0,
          note: note.trim(),
          receiptPaths: receipts,
          missingReceiptReason: needsReason ? reason.trim() : "",
          capturedAtMs: delivery.capturedAtMs,
          location: delivery.location ?? null,
        },
      },
      "Teslimat düzeltildi."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Teslimatı düzelt" description={`${stop.customerName} · planlanan ${liters(stop.plannedMl)} L ${fuelName(stop.fuel)}`}>
      <div className="space-y-4">
        <Field label="Durum">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as Delivery["status"])}>
            <option value="delivered">Planlanan miktar teslim edildi</option>
            <option value="partial">Farklı miktar teslim edildi</option>
            <option value="skipped">Atlandı (teslim yok)</option>
          </select>
        </Field>
        {status === "partial" && (
          <Field label="Teslim edilen (litre)" hint="Planlanandan fazla olabilir.">
            <Input inputMode="decimal" value={litersText} onChange={(e) => setLitersText(e.target.value)} />
          </Field>
        )}
        <Field label={status === "delivered" ? "Açıklama (isteğe bağlı)" : "Açıklama"}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {needsReason && (
          <Field label="Fiş neden yok?">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
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
