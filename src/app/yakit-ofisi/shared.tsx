"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const fmtTL = (n: number | null | undefined) =>
  n == null ? "—" : `₺${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;

export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: digits });

export const fmtDate = (s: string | null | undefined, withTime = false) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return withTime
    ? d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("tr-TR");
};

export function daysSince(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400_000);
}

export type Section<T> = { data: T | null; error: string | null };

// Ekran verisini çeker; "Yenile" önbelleği atlar. extra: ek sorgu (ör. "days=7").
export function useYoData<T>(view: string, extra = "") {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/yakit-ofisi/data?view=${view}${extra ? `&${extra}` : ""}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Veri alınamadı.");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Veri alınamadı.");
      } finally {
        setLoading(false);
      }
    },
    [view, extra],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: () => load(true) };
}

export function PageHeader({
  title,
  description,
  loading,
  onRefresh,
}: {
  title: string;
  description: string;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {onRefresh && (
        <Button variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </Button>
      )}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  const noKey = message.includes("anahtarı girilmemiş");
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        {message}
        {noKey && (
          <>
            {" "}
            <Link href="/yakit-ofisi/ayarlar" className="underline font-medium">
              Bağlantı Ayarları
            </Link>
            &apos;na gidin.
          </>
        )}
      </span>
    </div>
  );
}

// Liste satırlarındaki müşteri hücresi: ad, altında kod gibi ek bilgi.
export function CustomerCell({
  name,
  sub,
  badge,
  groups,
}: {
  name?: string | null;
  sub?: string | null;
  badge?: ReactNode;
  groups?: string[] | null;
}) {
  return (
    <div>
      <div className="font-medium text-primary underline-offset-2 hover:underline">{name || "—"}</div>
      {(sub || badge) && (
        <div className="text-xs text-muted-foreground">
          {sub}
          {badge}
        </div>
      )}
      {groups && groups.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {groups.map((g) => (
            <span key={g} className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Yakıt Ofisi filo grupları (sunucu her satıra `groups` ekler). Eşleme alınamadıysa alan gelmez
// ve filtre hiç gösterilmez; grubu olmayan filo "Grupsuz" sayılır.
export const NO_GROUP = "Grupsuz";
export const groupValues = (groups?: string[] | null) => (groups ? (groups.length ? groups : [NO_GROUP]) : []);
export function groupFilter<T extends { groups?: string[] | null }>() {
  return { key: "group", label: "Grup", values: (r: T) => groupValues(r.groups) };
}

// Bazı kayıtlarda cari kod yerine iç kimlik (GUID) geliyor; onu göstermeyiz.
export const cariText = (v?: string | null) => (v && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? v : "");

export function FetchedAt({ at }: { at?: number }) {
  if (!at) return null;
  return <p className="text-xs text-muted-foreground">Son çekim: {fmtDate(new Date(at).toISOString(), true)} (5 dk önbellek)</p>;
}
