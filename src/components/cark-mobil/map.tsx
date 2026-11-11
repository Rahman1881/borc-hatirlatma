"use client";

import dynamic from "next/dynamic";
import type { MapProps } from "./map-inner";

export type { MapLine, MapMarker } from "./map-inner";

// Leaflet `window` ister; yalnız tarayıcıda yüklenir.
const Inner = dynamic(() => import("./map-inner"), {
  ssr: false,
  loading: () => <div className="grid h-80 w-full place-items-center rounded-lg border text-sm text-muted-foreground">Harita yükleniyor…</div>,
});

export function MapView(props: MapProps) {
  return <Inner {...props} />;
}
