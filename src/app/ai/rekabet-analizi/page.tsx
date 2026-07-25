"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import {
  Fuel,
  MapPin,
  RefreshCw,
  KeyRound,
  Navigation,
  Download,
} from "lucide-react";

type FuelType = "benzin" | "motorin" | "lpg";

type PriceRow = {
  tarih: string;
  il: string;
  plaka: number;
  marka: string;
  yakit: FuelType;
  fiyat: number;
  kaynak: "marka" | "manuel";
};

type Station = {
  id: string;
  name: string;
  address: string;
  phone: string;
  mapsUrl: string;
  website: string;
  category: string;
  rating: number | null;
  ratingCount: number | null;
  lat: number | null;
  lng: number | null;
  businessStatus: string;
  brand: string;
  distanceKm: number | null;
};

type Overview = {
  station: { il: string; ilce: string; plaka: number; lat: number; lng: number };
  tarih: string;
  priceSource: "cache" | "marka" | "none";
  updatedAt: string | null;
  prices: PriceRow[];
  stations: Station[];
  placesConfigured: boolean;
  placesError?: string;
};

const FUELS: { key: FuelType; label: string }[] = [
  { key: "benzin", label: "Benzin" },
  { key: "motorin", label: "Motorin" },
  { key: "lpg", label: "LPG" },
];

const OWN_BRAND = "Petrol Ofisi";

// SQLite 'YYYY-MM-DD HH:MM:SS' -> 'GG.AA.YYYY SS:DD'
function formatUpdated(s: string | null): string {
  if (!s) return "";
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return s;
  const [, y, mo, d, hh, mm] = m;
  return `${d}.${mo}.${y} ${hh}:${mm}`;
}

export default function RekabetAnaliziPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/rekabet-analizi");
      const d = (await res.json()) as Overview & { error?: string };
      if (!res.ok) throw new Error(d.error || "Veri alınamadı.");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Manuel çekim: önbelleği yok say, kaynaktan yeniden çek.
  async function fetchPrices() {
    setFetching(true);
    setError("");
    try {
      const res = await fetch("/api/ai/rekabet-analizi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const d = (await res.json()) as Overview & { error?: string };
      if (!res.ok) throw new Error(d.error || "Fiyatlar çekilemedi.");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fiyatlar çekilemedi.");
    } finally {
      setFetching(false);
    }
  }

  // marka -> yakıt -> fiyat eşlemesi
  const priceMap = useMemo(() => {
    const map: Record<string, Partial<Record<FuelType, number>>> = {};
    for (const p of data?.prices || []) {
      if (!map[p.marka]) map[p.marka] = {};
      map[p.marka][p.yakit] = p.fiyat;
    }
    return map;
  }, [data]);

  // Kendi fiyatımız (kıyas referansı)
  const ownPrice = priceMap[OWN_BRAND] || {};

  // Tabloda gösterilecek markalar: fiyatı olanlar (bizimki en üstte).
  const brands = useMemo(() => {
    const withPrice = Object.keys(priceMap);
    return withPrice.sort((a, b) => {
      if (a === OWN_BRAND) return -1;
      if (b === OWN_BRAND) return 1;
      return a.localeCompare(b, "tr");
    });
  }, [priceMap]);

  const sourceLabel: Record<Overview["priceSource"], string> = {
    cache: "Önbellek (bugün)",
    marka: "Marka siteleri (otomatik)",
    none: "Henüz fiyat yok",
  };

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Fuel className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                {data
                  ? `${data.station.il.toLocaleUpperCase("tr")} ${data.station.ilce.toLocaleUpperCase("tr")} Fiyatları`
                  : "Rekabet Analizi"}
              </p>
              {data && (
                <Pill tone={data.priceSource === "none" ? "neutral" : "primary"}>
                  {sourceLabel[data.priceSource]}
                </Pill>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data
                ? `${data.station.ilce} / ${data.station.il} çevresindeki akaryakıt istasyonları ve marka fiyatları. ${data.tarih} tarihli.`
                : "İstasyonunuza yakın rakip istasyonların fiyatları ve AI kıyaslaması."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={fetchPrices}
              disabled={fetching || loading}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              <Download className={`h-4 w-4 ${fetching ? "animate-pulse" : ""}`} />{" "}
              {fetching ? "Çekiliyor…" : "Fiyatları Çek"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Yenile
            </button>
          </div>
        </div>
      </Panel>

      {error && (
        <Panel className="border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <p className="text-sm font-medium text-red-600">{error}</p>
          </div>
        </Panel>
      )}

      {data && data.priceSource === "none" && (
        <Panel className="border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">Bugünün fiyatları çekilemedi.</b> Marka
            sitelerine şu an ulaşılamadı. Yenile&apos;ye basabilir veya yarınki otomatik
            çekimi bekleyebilirsiniz.
          </p>
        </Panel>
      )}
      {/* Fiyat tablosu */}
      <Panel>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Marka Fiyatları (₺/lt)</p>
          {data?.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Son güncelleme: {formatUpdated(data.updatedAt)}
            </span>
          )}
        </div>

        {/* Renk açıklaması */}
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-red-500/20 ring-1 ring-red-500/40" />
            Bizden ucuz (rakip avantajlı)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-emerald-500/20 ring-1 ring-emerald-500/40" />
            Bizden pahalı (biz avantajlıyız)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-muted ring-1 ring-foreground/10" />
            Eşit / referans
          </span>
        </div>

        {brands.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Bugün için fiyat verisi yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Marka</th>
                  {FUELS.map((f) => (
                    <th key={f.key} className="px-3 py-2 text-right font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brands.map((marka) => {
                  const own = marka === OWN_BRAND;
                  return (
                    <tr key={marka} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2 font-medium">
                          {marka}
                          {own && <Pill tone="primary">Bizim</Pill>}
                        </span>
                      </td>
                      {FUELS.map((f) => {
                        const val = priceMap[marka]?.[f.key];
                        const ref = ownPrice[f.key];
                        let cls = "text-muted-foreground";
                        if (val != null && !own && ref != null) {
                          if (val < ref) cls = "text-red-600 dark:text-red-400 font-semibold";
                          else if (val > ref)
                            cls = "text-emerald-600 dark:text-emerald-400 font-semibold";
                          else cls = "text-foreground";
                        } else if (val != null && own) {
                          cls = "text-foreground font-semibold";
                        }
                        return (
                          <td key={f.key} className="px-3 py-2.5 text-right tabular-nums">
                            {val != null ? (
                              <span className={cls}>{val.toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Yakın istasyonlar */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Navigation className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">
            Yakın İstasyonlar{" "}
            {data && (
              <span className="text-muted-foreground">({data.stations.length})</span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Panel key={i} className="animate-pulse">
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="mt-3 h-3 w-2/3 rounded bg-muted" />
              </Panel>
            ))}
          </div>
        ) : data && !data.placesConfigured ? (
          <Panel className="py-8 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Google Places anahtarı gerekli</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Çevredeki istasyonları görmek için Ayarlar &gt; Google Places bölümünden
              anahtarı girin.
            </p>
          </Panel>
        ) : data && data.stations.length === 0 ? (
          <Panel className="py-8 text-center">
            <Fuel className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">İstasyon bulunamadı</p>
            {data.placesError && (
              <p className="mt-1 text-sm text-muted-foreground">{data.placesError}</p>
            )}
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data?.stations.map((s) => (
              <StationCard key={s.id} station={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StationCard({ station: s }: { station: Station }) {
  return (
    <Panel className="transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Fuel className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold leading-tight">{s.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {s.brand || "Marka bilinmiyor"}
            </p>
            {s.address && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" /> {s.address}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {s.distanceKm != null && (
            <Pill tone="neutral">{s.distanceKm} km</Pill>
          )}
          {s.mapsUrl && (
            <a
              href={s.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              <MapPin className="h-3.5 w-3.5" /> Harita
            </a>
          )}
        </div>
      </div>
    </Panel>
  );
}
