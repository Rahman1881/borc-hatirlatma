"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { callOp, errorText, fb } from "@/lib/cark-mobil/firebase";
import { STATUS } from "@/lib/cark-mobil/util";
import type { TripStatus } from "@/lib/cark-mobil/types";

// Çark Mobil sayfalarının ortak parçaları.

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
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
    // Etiket alanı sarar; böylece etikete tıklamak alanı seçer ve ekran okuyucu adını okur.
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
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function StatusPill({ status }: { status: TripStatus }) {
  const s = STATUS[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", s.tone)}>{s.label}</span>;
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-500/12 text-red-700 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

// Sunucu işlemini çalıştırır; hata olursa bildirim gösterir ve null döner.
export function useOp() {
  const [busy, setBusy] = useState(false);
  async function run<T = unknown>(action: string, payload: Record<string, unknown>, okMessage?: string): Promise<T | null> {
    setBusy(true);
    try {
      const result = await callOp<T>(action, payload);
      if (okMessage) toast.success(okMessage);
      return result ?? ({} as T);
    } catch (e) {
      toast.error(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

// Storage'daki fiş fotoğrafı: küçük resim, tıklayınca yeni sekmede açılır.
export function ReceiptThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getDownloadURL(ref(fb().storage, path))
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <span className="relative inline-block">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="Fişi aç">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Fiş" className="h-14 w-14 rounded-md border object-cover" />
        </a>
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-md border text-[10px] text-muted-foreground">
          {failed ? "Açılamadı" : "…"}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          title="Fişi kaldır"
          className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-xs text-white"
        >
          ×
        </button>
      )}
    </span>
  );
}
