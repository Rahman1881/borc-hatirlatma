"use client";

import { useMemo } from "react";
import { Panel } from "@/components/ai/ui";
import { Percent, Fuel, TrendingDown, UserCheck } from "lucide-react";
import {
  AnalitikShell,
  KpiCard,
  useAnalitik,
  tl,
  tl2,
  pct,
  Iskonto,
  fuelTone,
  type Overview,
} from "../shared";

export default function IskontoPage() {
  const state = useAnalitik();
  return (
    <AnalitikShell
      state={state}
      title="İskonto & Zarar"
      subtitle="Liste fiyatından vazgeçilen ciro, yakıt ve temsilci kırılımı."
      icon={<Percent className="h-5 w-5" />}
    >
      {(ov) => <Content ov={ov} />}
    </AnalitikShell>
  );
}

function Content({ ov }: { ov: Overview }) {
  const maxAttendant = useMemo(() => Math.max(1, ...ov.topAttendants.map((a) => a.iskonto)), [ov]);
  const maxTrend = useMemo(() => Math.max(1, ...ov.dailyTrend.map((d) => d.ciro)), [ov]);
  const toplamVazgecilen = useMemo(() => ov.fuelDiscounts.reduce((s, f) => s + f.vazgecilenCiro, 0), [ov]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={<TrendingDown className="h-5 w-5" />} label="Vazgeçilen Ciro" value={`₺${tl(ov.kpi.iskontoCiro)}`} sub={`liste fiyatından · ${pct(ov.kpi.iskontoPct)}`} tone="from-rose-500 to-red-500" />
        <KpiCard icon={<Percent className="h-5 w-5" />} label="İskontolu Oran" value={`%${ov.kpi.iskontoluOran}`} sub="iskontolu satış payı" tone="from-amber-500 to-orange-500" />
        <KpiCard icon={<Fuel className="h-5 w-5" />} label="Ort. İskonto" value={`${ov.kpi.ortIskonto} kr/lt`} sub={`litre başına · ${pct(ov.kpi.iskontoPct)}`} tone="from-emerald-500 to-green-500" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Yakıt bazlı liste vs satış */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Fuel className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Yakıt Bazlı Liste vs. Satış Fiyatı</p>
          </div>
          {ov.fuelDiscounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu dönemde peşin satış yok.</p>
          ) : (
            <div className="space-y-4">
              {ov.fuelDiscounts.map((f) => {
                const tone = fuelTone(f.yakit);
                return (
                  <div key={f.yakit}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${tone}`} />
                        {f.yakit}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Liste ₺{tl2(f.listeFiyat)} → Ort. ₺{tl2(f.ortSatis)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${Math.min(100, Math.max(2, f.vazgecilenPct * 25))}%` }} />
                      </div>
                      <Iskonto
                        tl={f.vazgecilenCiro}
                        pct={f.vazgecilenPct}
                        minus
                        className="w-36 text-right text-sm font-semibold tabular-nums text-rose-600"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            Toplam vazgeçilen ciro: <span className="font-semibold text-foreground">₺{tl(toplamVazgecilen)}</span>{" "}
            ({pct(ov.kpi.iskontoPct)}) · liste fiyatı = vardiya içi en yüksek FYT · yüzde = liste fiyatına göre indirim
          </div>
        </Panel>

        {/* Temsilciler */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">En Çok İskonto Veren Temsilciler</p>
          </div>
          {ov.topAttendants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu dönemde iskontolu satış yok.</p>
          ) : (
            <div className="space-y-3">
              {ov.topAttendants.map((a) => (
                <div key={a.ad}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{a.ad}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.islem} işlem ·{" "}
                      <Iskonto tl={a.iskonto} pct={a.iskontoPct} className="font-semibold text-foreground" />
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${(a.iskonto / maxAttendant) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Günlük trend */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Günlük Vazgeçilen Ciro Trendi (son 7 gün)</p>
        </div>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {ov.dailyTrend.map((d) => (
            <div key={d.iso} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${d.iso} — ₺${tl(d.ciro)} (${pct(d.pct)})`}>
              <span className="text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100">₺{tl(d.ciro)} · {pct(d.pct)}</span>
              <div className="w-full rounded-t bg-gradient-to-t from-rose-500/50 to-red-500 transition-opacity group-hover:opacity-80" style={{ height: `${(d.ciro / maxTrend) * 130}px` }} />
              <span className="text-[10px] text-muted-foreground">{d.gun}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
