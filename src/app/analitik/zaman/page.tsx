"use client";

import { useMemo } from "react";
import { Panel } from "@/components/ai/ui";
import { Clock, CalendarDays } from "lucide-react";
import { AnalitikShell, useAnalitik, tl, type Overview } from "../shared";

export default function ZamanPage() {
  const state = useAnalitik();
  return (
    <AnalitikShell
      state={state}
      title="Zaman & Yoğunluk"
      subtitle="Peşin satışların saat ve haftanın günü desenleri."
      icon={<Clock className="h-5 w-5" />}
      showPeriod={false}
    >
      {(ov) => <Content ov={ov} />}
    </AnalitikShell>
  );
}

function Content({ ov }: { ov: Overview }) {
  const maxHour = useMemo(() => Math.max(1, ...ov.hourly.map((h) => h.adet)), [ov]);
  const maxDay = useMemo(() => Math.max(1, ...ov.weekday.map((d) => d.adet)), [ov]);

  const peakHour = useMemo(() => ov.hourly.reduce((a, b) => (b.adet > a.adet ? b : a), ov.hourly[0] ?? { hour: 0, adet: 0, litre: 0 }), [ov]);
  const peakDay = useMemo(() => ov.weekday.reduce((a, b) => (b.adet > a.adet ? b : a), ov.weekday[0] ?? { gun: "—", adet: 0, litre: 0 }), [ov]);
  const totalAdet = useMemo(() => ov.hourly.reduce((s, h) => s + h.adet, 0), [ov]);

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{ov.patternLabel}</p>

      {/* Özet */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">En Yoğun Saat</p>
          <p className="mt-1 text-base font-semibold tabular-nums">
            {String(peakHour.hour).padStart(2, "0")}:00 – {String((peakHour.hour + 1) % 24).padStart(2, "0")}:00
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">En Yoğun Gün</p>
          <p className="mt-1 text-base font-semibold">{peakDay.gun}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">Toplam İşlem (90 gün)</p>
          <p className="mt-1 text-base font-semibold tabular-nums">{tl(totalAdet)}</p>
        </Panel>
      </div>

      {/* Saatlik dağılım */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Saatlik Yoğunluk</p>
        </div>
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {ov.hourly.map((h) => {
            const isPeak = h.hour === peakHour.hour && h.adet > 0;
            return (
              <div key={h.hour} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${String(h.hour).padStart(2, "0")}:00 — ${tl(h.adet)} işlem · ${tl(h.litre)} lt`}>
                <span className="text-[9px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100">{tl(h.adet)}</span>
                <div
                  className={`w-full rounded-t transition-opacity group-hover:opacity-80 ${isPeak ? "bg-gradient-to-t from-violet-500/60 to-fuchsia-500" : "bg-gradient-to-t from-sky-500/40 to-blue-500"}`}
                  style={{ height: `${(h.adet / maxHour) * 130}px` }}
                />
                <span className="text-[8px] text-muted-foreground">{String(h.hour).padStart(2, "0")}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Sütunlar işlem adedini gösterir · üzerine gelince litre görünür</p>
      </Panel>

      {/* Haftanın günü */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Haftanın Günü Dağılımı</p>
        </div>
        <div className="space-y-2">
          {ov.weekday.map((d) => {
            const isPeak = d.gun === peakDay.gun && d.adet > 0;
            return (
              <div key={d.gun} className="flex items-center gap-3">
                <span className="w-8 text-xs font-medium text-muted-foreground">{d.gun}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${isPeak ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-gradient-to-r from-sky-500 to-blue-500"}`}
                    style={{ width: `${(d.adet / maxDay) * 100}%` }}
                  />
                </div>
                <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
                  {tl(d.adet)} işlem · {tl(d.litre)} lt
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
