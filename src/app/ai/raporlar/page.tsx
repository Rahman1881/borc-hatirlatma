"use client";

import { useEffect, useState } from "react";
import { Panel, SectionTitle, Pill } from "@/components/ai/ui";
import { Send, Clock, Check, FileText } from "lucide-react";

type TgSchedule = {
  id: string;
  label: string;
  type: "daily" | "weekly" | "news";
  time: string;
  weekday: number | null;
  enabled: boolean;
};

type TgStatus = {
  configured?: boolean;
  botUsername?: string;
  chats?: { chatId: string; name: string; enabled: boolean }[];
  schedules?: TgSchedule[];
  vardiyaEnabled?: boolean;
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors ${
        on ? "bg-primary" : "bg-input ring-1 ring-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function scheduleHint(s: TgSchedule): string {
  if (s.type === "weekly") return "Haftalık performans · Pazartesi";
  if (s.type === "news") return "Petrol & akaryakıt haberleri";
  return "Önceki günün satış raporu";
}

export default function RaporlarPage() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [schedules, setSchedules] = useState<TgSchedule[]>([]);
  const [vardiya, setVardiya] = useState(true);

  useEffect(() => {
    fetch("/api/ai/telegram")
      .then((r) => r.json())
      .then((d: TgStatus) => {
        setStatus(d);
        setSchedules(d.schedules || []);
        if (typeof d.vardiyaEnabled === "boolean") setVardiya(d.vardiyaEnabled);
      })
      .catch(() => {});
  }, []);

  async function toggleSchedule(i: number) {
    const next = schedules.map((x, idx) =>
      idx === i ? { ...x, enabled: !x.enabled } : x
    );
    setSchedules(next);
    try {
      await fetch("/api/ai/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "schedules", schedules: next }),
      });
    } catch {
      // sessizce geç
    }
  }

  async function toggleVardiya() {
    const next = !vardiya;
    setVardiya(next);
    try {
      await fetch("/api/ai/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vardiya", enabled: next }),
      });
    } catch {
      // sessizce geç
    }
  }

  const configured = !!status?.configured;
  const username = status?.botUsername || "";
  const chatCount = status?.chats?.filter((c) => c.enabled).length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel>
          <SectionTitle title="Otomatik Raporlar" />
          <div className="space-y-3">
            {/* Vardiya raporları — zamana değil yeni dosyaya bağlı */}
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Vardiya Raporları</p>
                  {vardiya && <Pill tone="positive">Aktif</Pill>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Her vardiya kapanıp yeni dosya düştüğünde otomatik raporlanır.
                </p>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FileText className="h-3 w-3" /> Olay tabanlı · günde ~3 kez
                </p>
              </div>
              <Toggle on={vardiya} onClick={toggleVardiya} />
            </div>

            {schedules.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{s.label}</p>
                    {s.enabled && <Pill tone="positive">Aktif</Pill>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scheduleHint(s)}
                  </p>
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> Her gün {s.time}
                  </p>
                </div>
                <Toggle on={s.enabled} onClick={() => toggleSchedule(i)} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Raporlar gerçek pompa (VRD) satış verisinden üretilir. Çalışması için
            sunucu bilgisayarı açık olmalıdır.
          </p>
        </Panel>

        <Panel>
          <SectionTitle title="Telegram Bot Bağlantısı" />
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#229ED9]/15 text-[#229ED9]">
                  <Send className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    {username ? `@${username}` : "Telegram Bot"}
                  </p>
                  <p
                    className={`text-xs ${
                      configured
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {configured
                      ? `Bağlı · ${chatCount} abone`
                      : "Bağlı değil · Ayarlar'dan token girin"}
                  </p>
                </div>
              </div>
              {configured ? (
                <Pill tone="positive">
                  <Check className="h-3 w-3" /> Çevrimiçi
                </Pill>
              ) : (
                <Pill>Pasif</Pill>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Patron, Telegram üzerinden bota yazıp anlık soru sorabilir; otomatik
              raporlar da bu sohbete düşer. Gerçek bağlantı için Ayarlar&apos;dan bot
              token girilir.
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="bg-muted/30">
        <SectionTitle title="Telegram Önizleme" />
        <div className="space-y-3 rounded-xl bg-[#0e1621] p-3">
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            🧾 <b>1. Vardiya Raporu</b> (00:00–08:00)
            <br />⛽ Satış: ₺410.579 · 6.666 L
            <br />🧾 Fiş: 215
            <br />En güçlü kalem: Motorin %69
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            📊 <b>Günlük Satış Raporu</b> (önceki gün)
            <br />⛽ Toplam: ₺1.24M · 19.8K L
            <br />🧾 Fiş: 648 · 3 vardiya
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            📰 <b>Günlük Bülten</b>
            <br />• Brent petrol ham fiyatı haftalık seyri…
            <br />• Türkiye akaryakıt fiyatlarında güncel durum…
          </div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[#2b5278] px-3 py-2 text-sm text-white">
            Bu hafta en kârlı yakıt hangisi?
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            💡 Marj bazında <b>benzin</b> önde. Net katkı: Motorin önde, ardından
            benzin ve LPG.
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Örnek görünüm · gerçek veriyle otomatik gönderilir
        </p>
      </Panel>
    </div>
  );
}
