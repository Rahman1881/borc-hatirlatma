"use client";

import Link from "next/link";
import { doc, updateDoc } from "firebase/firestore";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, PageHeader } from "@/components/cark-mobil/ui";
import type { Notice } from "@/lib/cark-mobil/types";
import { dateTime } from "@/lib/cark-mobil/util";

// Mobil uygulamadaki bildirim kutusunun aynısı (son 100). "Okundu" bilgisi telefonla ortaktır.

export default function BildirimlerPage() {
  const { notices, me } = useCark();
  const unread = notices.filter((n) => !n.read);

  const markRead = (n: Notice) => {
    if (n.read || !me) return;
    updateDoc(doc(fb().db, "users", me.id, "notifications", n.id), { read: true }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bildirimler"
        description="Sefer, teslimat, vardiya, görev ve yıkama bildirimleri."
        action={
          unread.length > 0 ? (
            <Button variant="outline" className="h-9" onClick={() => unread.forEach(markRead)}>
              <CheckCheck className="h-4 w-4" /> Tümünü okundu yap ({unread.length})
            </Button>
          ) : undefined
        }
      />
      <Box>
        {notices.length === 0 ? (
          <Empty>Bildirim yok.</Empty>
        ) : (
          <div className="divide-y">
            {notices.map((n) => {
              const href = n.tripId
                ? `/cark-mobil/seferler/${n.tripId}`
                : n.refuelId
                  ? "/cark-mobil/yakit-alimlari"
                  : n.washId
                    ? "/cark-mobil/yikama"
                    : n.taskId
                      ? "/cark-mobil/gorevler"
                      : n.shiftId
                        ? "/cark-mobil/vardiyalar"
                        : null;
              const body = (
                <div className="flex items-start gap-3 py-3">
                  <Bell className={cn("mt-0.5 h-4 w-4 shrink-0", n.read ? "text-muted-foreground/40" : "text-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{dateTime(n.createdAt)}</span>
                </div>
              );
              return href ? (
                <Link key={n.id} href={href} onClick={() => markRead(n)} className="block hover:bg-muted/50">
                  {body}
                </Link>
              ) : (
                <button key={n.id} onClick={() => markRead(n)} className="block w-full text-left hover:bg-muted/50">
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </Box>
    </div>
  );
}
