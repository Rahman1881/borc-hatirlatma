"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ai/ui";
import { Layers, Star, Sparkles, UserX } from "lucide-react";
import {
  AnalitikShell,
  useAnalitik,
  tl,
  plateHref,
  type Overview,
  type Segment,
  type PlateBrief,
} from "../shared";

const SEG_META: Record<Segment, { label: string; tone: string; icon: typeof Star; desc: string }> = {
  sadik: { label: "Sadık", tone: "from-emerald-500 to-green-500", icon: Star, desc: "İlk gelişi 30 günden eski, son 30 günde de gelmiş — düzenli müşteri" },
  yeni: { label: "Yeni", tone: "from-sky-500 to-blue-500", icon: Sparkles, desc: "İlk 30 gün içinde tanışılan müşteri" },
  kacan: { label: "Kaçan", tone: "from-rose-500 to-red-500", icon: UserX, desc: "30+ gündür uğramıyor — geri kazanım fırsatı" },
};

export default function SegmentlerPage() {
  const state = useAnalitik();
  return (
    <AnalitikShell
      state={state}
      title="Müşteri Segmentleri"
      subtitle="RFM mantığıyla plakalar Sadık / Yeni / Kaçan olarak sınıflanır (tüm veri)."
      icon={<Layers className="h-5 w-5" />}
      showPeriod={false}
    >
      {(ov) => <Content ov={ov} />}
    </AnalitikShell>
  );
}

function Content({ ov }: { ov: Overview }) {
  const router = useRouter();
  const [active, setActive] = useState<Segment>("kacan");
  const order: Segment[] = ["sadik", "yeni", "kacan"];
  const list = ov.segmentPlates[active];

  return (
    <div className="space-y-6">
      {/* Segment kartları — tıklanınca liste değişir */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {order.map((key) => {
          const m = SEG_META[key];
          const Icon = m.icon;
          const on = active === key;
          return (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`rounded-xl border p-4 text-left transition-colors ${on ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
            >
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${m.tone} text-white`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold tabular-nums">
                    {tl(ov.segments[key])} <span className="text-xs font-normal text-muted-foreground">plaka</span>
                  </p>
                  <p className="text-sm font-medium">{m.label}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Seçili segmentin plaka listesi */}
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <span className={`grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br ${SEG_META[active].tone} text-white`}>
            {(() => {
              const Icon = SEG_META[active].icon;
              return <Icon className="h-4 w-4" />;
            })()}
          </span>
          <p className="text-sm font-semibold">{SEG_META[active].label} Plakalar</p>
          <span className="text-xs text-muted-foreground">
            {active === "sadik" ? "— en çok ziyaret" : active === "yeni" ? "— en yeni" : "— en değerli (geri kazanım önceliği)"}
          </span>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu segmentte plaka yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Plaka</th>
                  <th className="px-3 py-2 text-right font-medium">Ziyaret</th>
                  <th className="px-3 py-2 text-right font-medium">Ciro</th>
                  <th className="px-3 py-2 text-right font-medium">İskonto</th>
                  {active === "yeni" ? (
                    <th className="py-2 pl-3 text-right font-medium">İlk Geliş</th>
                  ) : (
                    <th className="py-2 pl-3 text-right font-medium">Son Ziyaret</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {list.map((p: PlateBrief) => (
                  <tr key={p.plaka} onClick={() => router.push(plateHref(p.plaka))} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2.5 pr-3 font-medium">{p.plaka}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.ziyaret}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">₺{tl(p.ciro)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-rose-600">₺{tl(p.iskonto)}</td>
                    {active === "yeni" ? (
                      <td className="py-2.5 pl-3 text-right text-xs text-muted-foreground">{p.ilkZiyaret}</td>
                    ) : (
                      <td className="py-2.5 pl-3 text-right text-xs text-muted-foreground">
                        {p.sonZiyaret}
                        {active === "kacan" && <span className="ml-1 text-rose-500">({p.gunGecti}g)</span>}
                      </td>
                    )}
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
