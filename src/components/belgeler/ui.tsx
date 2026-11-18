"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { kalanGun } from "@/lib/belge-turleri";
import type { Belge, HatirlatmaAyar, Varlik } from "@/lib/belgeler";

// Şirket ve Özlük Belgeleri sayfalarının ortak parçaları.

export type Snapshot = {
  bugun: string;
  varliklar: Varlik[];
  belgeler: Belge[];
  ayar: HatirlatmaAyar;
  telegram: boolean;
  abone: number;
  bekleyen: { id: number; sahip: string; tur: string; kalan: number }[];
};

// Modülün verisi + işlem çağrısı. Her işlem güncel veriyi geri getirir.
export function useBelgeler() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/belgeler", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Snapshot);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    fetch("/api/belgeler", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Snapshot) => setData(d))
      .catch(() => setFailed(true));
  }, []);

  // Başarılıysa sunucunun yanıtını (yeni kaydın id'si dahil), hata olursa null döndürür.
  const op = useCallback(async (action: string, payload: Record<string, unknown> = {}, okMessage?: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/belgeler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = (await res.json()) as Snapshot & { id?: number; error?: string; gonderilen?: number };
      if (!res.ok) throw new Error(body.error || "İşlem yapılamadı.");
      setData(body);
      if (okMessage) toast.success(okMessage);
      return body;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "İşlem yapılamadı.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { data, failed, busy, reload, op };
}

export type Durum = { kod: "arsiv" | "suresiz" | "gecti" | "yakin" | "gecerli"; etiket: string; kalan: number | null };

// Belgenin durumu. "Yakın": en uzun hatırlatma eşiğinin (yoksa 30 günün) içine girmiş.
export function durumOf(b: Belge, bugun: string): Durum {
  if (b.durum === "arsiv") return { kod: "arsiv", etiket: "Arşiv", kalan: null };
  if (!b.bitis) return { kod: "suresiz", etiket: "Süresiz", kalan: null };
  const kalan = kalanGun(b.bitis, bugun);
  if (kalan < 0) return { kod: "gecti", etiket: `${-kalan} gün önce doldu`, kalan };
  const esik = Math.max(30, ...b.hatirlat.split(",").map(Number).filter(Number.isFinite));
  if (kalan === 0) return { kod: "yakin", etiket: "Bugün doluyor", kalan };
  if (kalan <= esik) return { kod: "yakin", etiket: `${kalan} gün kaldı`, kalan };
  return { kod: "gecerli", etiket: `${kalan} gün kaldı`, kalan };
}

const TONE: Record<Durum["kod"], Parameters<typeof Tag>[0]["tone"]> = {
  arsiv: "muted",
  suresiz: "blue",
  gecti: "red",
  yakin: "amber",
  gecerli: "green",
};

export function DurumTag({ durum }: { durum: Durum }) {
  return <Tag tone={TONE[durum.kod]}>{durum.etiket}</Tag>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-card p-5", className)}>{children}</div>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-sm font-medium leading-none">{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-500/12 text-red-700 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  };
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Loading({ failed }: { failed: boolean }) {
  return <Empty>{failed ? "Belgeler okunamadı. Sayfayı yenileyin." : "Yükleniyor…"}</Empty>;
}
