"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { MapView } from "@/components/cark-mobil/map";
import { Box, Field, PageHeader, Spinner, useOp } from "@/components/cark-mobil/ui";
import type { LatLng, StationConfig } from "@/lib/cark-mobil/types";
import { DEFAULT_DEPOT, newId } from "@/lib/cark-mobil/util";

// İki ayrı ayar: (1) tanker seferlerinin çıkış/dönüş noktası olan merkez, (2) istasyon vardiya
// girişi kuralları (personel vardiyaya istasyonda, belirlenen saat aralığında giriş yapar).

export default function AyarlarPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Ayarlar" description="Tanker merkezi ve istasyon vardiya giriş kuralları." />
      <StationSettings />
      <DepotSettings />
    </div>
  );
}

function DepotSettings() {
  const { settings } = useCark();
  const { busy, run } = useOp();
  // Düzenlenmemiş alanlar kayıtlı ayarı gösterir (ayar sonradan yüklense de).
  const [editedName, setName] = useState<string | null>(null);
  const [editedPoint, setPoint] = useState<LatLng | null>(null);
  const name = editedName ?? settings.depotName ?? "";
  const point = editedPoint ?? settings.depot ?? DEFAULT_DEPOT;

  async function save() {
    if (name.trim().length < 2) return toast.error("Merkez adını girin.");
    await run("saveSettings", { depot: point, depotName: name.trim() }, "Merkez kaydedildi.");
  }

  return (
    <Box className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Tanker merkezi</p>
        <p className="text-xs text-muted-foreground">Seferlerin çıkış ve dönüş noktası.</p>
      </div>
      <Field label="Merkez adı" className="max-w-sm">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium">
          Konum{" "}
          <span className="font-normal text-muted-foreground">
            ({point.lat.toFixed(5)}, {point.lng.toFixed(5)})
          </span>
        </p>
        <MapView
          markers={[{ id: "depot", lat: point.lat, lng: point.lng, kind: "depot", title: name || "Merkez" }]}
          onPick={(lat, lng) => setPoint({ lat, lng })}
          fitKey={`${settings.depot?.lat ?? ""}`}
          className="h-80 w-full rounded-lg border"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Konumu değiştirmek için haritaya tıklayın.</p>
      </div>
      <Button className="h-9" onClick={save} disabled={busy}>
        {busy ? <Spinner /> : <Save className="h-4 w-4" />} Merkezi kaydet
      </Button>
    </Box>
  );
}

const NUMBERS: { key: "radiusMeters" | "checkInBeforeMinutes" | "checkInAfterMinutes" | "reminderMinutes" | "graceMinutes"; label: string; hint: string; min: number; max: number; fallback: number }[] = [
  { key: "radiusMeters", label: "Giriş yarıçapı (metre)", hint: "Personel istasyona bu kadar yakınken giriş yapabilir.", min: 50, max: 1000, fallback: 150 },
  { key: "checkInBeforeMinutes", label: "Vardiyadan önce giriş (dk)", hint: "Vardiya başlamadan en çok kaç dakika önce giriş yapılabilir.", min: 0, max: 120, fallback: 30 },
  { key: "checkInAfterMinutes", label: "Vardiyadan sonra giriş (dk)", hint: "Vardiya başladıktan sonra en geç kaç dakikaya kadar giriş yapılabilir.", min: 0, max: 240, fallback: 120 },
  { key: "reminderMinutes", label: "Vardiya hatırlatması (dk)", hint: "Vardiyadan kaç dakika önce, giriş yapmamış personele hatırlatma gider.", min: 5, max: 120, fallback: 30 },
  { key: "graceMinutes", label: "Geç hatırlatma süresi (dk)", hint: "Vardiya başladıktan sonra bu süreye kadar hatırlatma gönderilebilir.", min: 0, max: 120, fallback: 15 },
];

function StationSettings() {
  const { settings } = useCark();
  const { busy, run } = useOp();
  const [saved, setSaved] = useState<StationConfig | null | undefined>(undefined);
  const [edited, setEdited] = useState<Partial<Record<(typeof NUMBERS)[number]["key"], string>>>({});
  const [editedCenter, setCenter] = useState<LatLng | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(fb().db, "station", "config"),
        (s) => setSaved((s.data() as StationConfig) ?? null),
        () => setSaved(null)
      ),
    []
  );

  const center = editedCenter ?? saved?.center ?? settings.depot ?? DEFAULT_DEPOT;
  const value = (n: (typeof NUMBERS)[number]) => edited[n.key] ?? String(saved?.[n.key] ?? n.fallback);

  async function save() {
    const numbers: Record<string, number> = {};
    for (const n of NUMBERS) {
      const v = Number(value(n));
      if (!Number.isInteger(v) || v < n.min || v > n.max) return toast.error(`${n.label}: ${n.min}–${n.max} arasında olmalı.`);
      numbers[n.key] = v;
    }
    const ok = await run("stationSaveConfig", { operationId: newId(), center, ...numbers, washCapacity: 1 }, "İstasyon ayarları kaydedildi.");
    if (ok) {
      setEdited({});
      setCenter(null);
    }
  }

  if (saved === undefined) {
    return (
      <Box className="grid place-items-center py-10">
        <Spinner />
      </Box>
    );
  }

  return (
    <Box className="space-y-4">
      <div>
        <p className="text-sm font-semibold">İstasyon vardiya girişi</p>
        <p className="text-xs text-muted-foreground">
          Personel vardiyaya girerken konumu bir kez doğrulanır; sürekli takip yoktur.
          {saved === null && <span className="text-amber-600"> Henüz kaydedilmedi; kaydedilene kadar personel vardiya girişi yapamaz.</span>}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {NUMBERS.map((n) => (
          <Field key={n.key} label={n.label} hint={n.hint}>
            <Input
              inputMode="numeric"
              value={value(n)}
              onChange={(e) => setEdited((x) => ({ ...x, [n.key]: e.target.value.replace(/\D/g, "") }))}
            />
          </Field>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">
          İstasyon konumu{" "}
          <span className="font-normal text-muted-foreground">
            ({center.lat.toFixed(5)}, {center.lng.toFixed(5)})
          </span>
        </p>
        <MapView
          markers={[{ id: "station", lat: center.lat, lng: center.lng, kind: "pin", title: "İstasyon" }]}
          onPick={(lat, lng) => setCenter({ lat, lng })}
          zoom={16}
          fitKey={`${saved?.center?.lat ?? "x"}`}
          className="h-80 w-full rounded-lg border"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Konumu değiştirmek için haritaya tıklayın.</p>
      </div>
      <Button className="h-9" onClick={save} disabled={busy}>
        {busy ? <Spinner /> : <Save className="h-4 w-4" />} İstasyon ayarlarını kaydet
      </Button>
    </Box>
  );
}
