"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet + OpenStreetMap haritası (anahtar ve ücret gerektirmez). İşaretçiler resim dosyası
// yerine HTML ile çizilir. Tarayıcıda çalışır; `map.tsx` üzerinden dinamik yüklenir.

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  kind?: "depot" | "stop" | "done" | "skipped" | "tanker" | "pin";
  text?: string; // işaretçinin içindeki kısa metin (ör. durak sırası)
  title?: string; // üzerine gelince / tıklayınca görünen açıklama
};
export type MapLine = { id: string; points: [number, number][]; color?: string; dashed?: boolean; weight?: number };

export type MapProps = {
  markers?: MapMarker[];
  lines?: MapLine[];
  onPick?: (lat: number, lng: number) => void; // haritaya tıklanınca
  center?: { lat: number; lng: number };
  zoom?: number;
  // Değişince harita tüm işaretçi ve çizgileri kapsayacak şekilde yeniden çerçevelenir.
  fitKey?: string;
  className?: string;
};

const COLORS: Record<NonNullable<MapMarker["kind"]>, string> = {
  depot: "#0f172a",
  stop: "#dc2626",
  done: "#059669",
  skipped: "#9ca3af",
  tanker: "#2563eb",
  pin: "#dc2626",
};

function icon(m: MapMarker): L.DivIcon {
  const kind = m.kind ?? "pin";
  const size = kind === "tanker" ? 34 : 28;
  const text = m.text ?? (kind === "depot" ? "M" : kind === "tanker" ? "🚚" : "");
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${COLORS[kind]};color:#fff;display:grid;place-items:center;font:600 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${text}</div>`,
  });
}

export default function MapInner({ markers = [], lines = [], onPick, center, zoom = 12, fitKey, className }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  const fitted = useRef<string | undefined>(undefined);

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
      [center?.lat ?? 40.7766, center?.lng ?? 30.3882],
      zoom
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap katkıcıları",
    }).addTo(m);
    m.on("click", (e) => pick.current?.(e.latlng.lat, e.latlng.lng));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
    // Harita bir kez kurulur; merkez/zoom sonradan fitKey ile yönetilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const l of lines) {
      if (l.points.length < 2) continue;
      L.polyline(l.points, {
        color: l.color ?? "#2563eb",
        weight: l.weight ?? 4,
        opacity: 0.85,
        dashArray: l.dashed ? "6 8" : undefined,
      }).addTo(g);
    }
    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: icon(mk), zIndexOffset: mk.kind === "tanker" ? 1000 : 0 });
      if (mk.title) marker.bindTooltip(mk.title);
      marker.addTo(g);
    }
    if (fitKey !== fitted.current) {
      fitted.current = fitKey;
      const pts: [number, number][] = [
        ...markers.map((x) => [x.lat, x.lng] as [number, number]),
        ...lines.flatMap((l) => l.points),
      ];
      if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), 14));
      else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
    }
  }, [markers, lines, fitKey]);

  return <div ref={el} className={className ?? "h-80 w-full rounded-lg border"} style={{ zIndex: 0 }} />;
}
