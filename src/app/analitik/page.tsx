"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Panel, Pill } from "@/components/ai/ui";
import {
  Users,
  UserPlus,
  Percent,
  TrendingDown,
  Repeat,
  Fuel,
  Wallet,
  Car,
  Star,
  Sparkles,
  UserX,
} from "lucide-react";
import {
  AnalitikShell,
  KpiCard,
  useAnalitik,
  tl,
  fuelTone,
  plateHref,
  SEG_PILL,
  type Overview,
} from "./shared";

const SEG_CARDS = [
  { key: "sadik" as const, label: "Sadık", tone: "from-emerald-500 to-green-500", icon: Star, desc: "Düzenli gelen" },
  { key: "yeni" as const, label: "Yeni", tone: "from-sky-500 to-blue-500", icon: Sparkles, desc: "İlk 30 günde" },
  { key: "kacan" as const, label: "Kaçan", tone: "from-rose-500 to-red-500", icon: UserX, desc: "30+ gündür yok" },
];

export default function GenelBakisPage() {
  const state = useAnalitik();
  return (
    <AnalitikShell
      state={state}
      title="Genel Bakış"
      subtitle="Peşin (bireysel) müşterilerin dönemsel özeti."
      icon={<Users className="h-5 w-5" />}
    >
      {(ov) => <Content ov={ov} />}
    </AnalitikShell>
  );
}

function Content({ ov }: { ov: Overview }) {
  const router = useRouter();
  const maxTrend = useMemo(() => Math.max(1, ...ov.dailyTrend.map((d) => d.ciro)), [ov]);
  const totalDemand = useMemo(() => ov.fuelDemand.reduce((s, f) => s + f.litre, 0), [ov]);

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<Users className="h-5 w-5" />} label="Müşteri" value={tl(ov.kpi.musteri)} sub="satış yapılan plaka" tone="from-violet-500 to-fuchsia-500" />
        <KpiCard icon={<UserPlus className="h-5 w-5" />} label="İlk Defa Gelen" value={tl(ov.kpi.ilkDefa)} sub="yeni plaka" tone="from-sky-500 to-blue-500" />
        <KpiCard icon={<Wallet className="h-5 w-5" />} label="Toplam Ciro" value={`₺${tl(ov.kpi.toplamCiro)}`} sub={`${tl(ov.kpi.toplamLitre)} litre`} tone="from-indigo-500 to-violet-500" />
        <KpiCard icon={<TrendingDown className="h-5 w-5" />} label="Vazgeçilen Ciro" value={`₺${tl(ov.kpi.iskontoCiro)}`} sub="liste fiyatından" tone="from-rose-500 to-red-500" />
        <KpiCard icon={<Percent className="h-5 w-5" />} label="İskontolu Oran" value={`%${ov.kpi.iskontoluOran}`} sub="iskontolu satış payı" tone="from-amber-500 to-orange-500" />
        <KpiCard icon={<Repeat className="h-5 w-5" />} label="Ort. İskonto" value={`${ov.kpi.ortIskonto} kr/lt`} sub="litre başına" tone="from-emerald-500 to-green-500" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Günlük trend */}
        <Panel className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Günlük Vazgeçilen Ciro (son 7 gün)</p>
          </div>
          <div className="flex items-end gap-3" style={{ height: 140 }}>
            {ov.dailyTrend.map((d) => (
              <div key={d.iso} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${d.iso} — ₺${tl(d.ciro)}`}>
                <span className="text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100">₺{tl(d.ciro)}</span>
                <div className="w-full rounded-t bg-gradient-to-t from-rose-500/50 to-red-500 transition-opacity group-hover:opacity-80" style={{ height: `${(d.ciro / maxTrend) * 110}px` }} />
                <span className="text-[10px] text-muted-foreground">{d.gun}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Yakıt talebi */}
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Fuel className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Yakıt Talebi</p>
          </div>
          {ov.fuelDemand.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu dönemde peşin satış yok.</p>
          ) : (
            <div className="space-y-3">
              {ov.fuelDemand.map((f) => {
                const tone = fuelTone(f.yakit);
                return (
                  <div key={f.yakit}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${tone}`} />
                        {f.yakit}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        %{f.pct} · {tl(f.litre)} lt
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${f.pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="border-t pt-3 text-xs text-muted-foreground">Toplam {tl(totalDemand)} litre</p>
            </div>
          )}
        </Panel>
      </div>

      {/* Segment özeti */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SEG_CARDS.map((s) => {
          const Icon = s.icon;
          return (
            <Panel key={s.key}>
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${s.tone} text-white`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold tabular-nums">
                    {tl(ov.segments[s.key])} <span className="text-xs font-normal text-muted-foreground">plaka</span>
                  </p>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* En çok iskonto alan plakalar (kısa) */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <Car className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">En Çok İskonto Alan Plakalar</p>
          <span className="text-xs text-muted-foreground">— satır seç → profil</span>
        </div>
        {ov.topPlates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu dönemde peşin satış yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Plaka</th>
                  <th className="px-3 py-2 text-center font-medium">Segment</th>
                  <th className="px-3 py-2 text-right font-medium">Ziyaret</th>
                  <th className="px-3 py-2 text-right font-medium">Ciro</th>
                  <th className="px-3 py-2 text-right font-medium">İskonto</th>
                  <th className="py-2 pl-3 text-right font-medium">Son</th>
                </tr>
              </thead>
              <tbody>
                {ov.topPlates.slice(0, 8).map((p) => (
                  <tr key={p.plaka} onClick={() => router.push(plateHref(p.plaka))} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2.5 pr-3 font-medium">{p.plaka}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Pill tone={SEG_PILL[p.segment].tone}>{SEG_PILL[p.segment].label}</Pill>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.ziyaret}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">₺{tl(p.ciro)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-rose-600">₺{tl(p.iskonto)}</td>
                    <td className="py-2.5 pl-3 text-right text-xs text-muted-foreground">{p.sonZiyaret}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
