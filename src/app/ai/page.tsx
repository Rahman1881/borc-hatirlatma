import { Panel, SectionTitle, Pill } from "@/components/ai/ui";
import { WeeklyAreaChart, FuelMixChart } from "@/components/ai/charts";
import { kpis, alerts, shifts } from "@/lib/ai-mock";
import {
  ArrowUpRight,
  ArrowDownRight,
  TriangleAlert,
  CircleCheck,
  Flame,
  Sparkles,
} from "lucide-react";

const toneIcon = {
  warning: <TriangleAlert className="h-4 w-4 text-amber-500" />,
  negative: <Flame className="h-4 w-4 text-red-500" />,
  positive: <CircleCheck className="h-4 w-4 text-emerald-500" />,
};

export default function AiDashboardPage() {
  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">AI Günlük Özet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bugün toplam ciro <b className="text-foreground">₺549.430</b> ile dünü
              %7,4 geçti. En güçlü kalem motorin. LPG satışındaki düşüş ve Tank 2
              seviyesi takip edilmeli. Hafta sonu için yoğun talep bekleniyor.
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Panel key={k.key}>
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{k.value}</p>
            <div className="mt-3 flex items-center justify-between">
              <span
                className={`inline-flex items-center gap-1 text-sm font-medium ${
                  k.positive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {k.positive ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {k.change}
              </span>
              <span className="text-xs text-muted-foreground">{k.sub}</span>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionTitle
            title="Haftalık Satış Trendi (bin ₺)"
            action={<Pill tone="primary">Son 7 gün</Pill>}
          />
          <WeeklyAreaChart />
        </Panel>
        <Panel>
          <SectionTitle title="Yakıt Dağılımı" />
          <FuelMixChart />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionTitle title="Vardiya Performansı" action={<Pill>Bugün</Pill>} />
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Vardiya</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ciro</th>
                  <th className="px-4 py-2.5 text-right font-medium">Litre</th>
                  <th className="px-4 py-2.5 text-right font-medium">Müşteri</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.name} className="border-t">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-right">{s.ciro}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{s.litre}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{s.musteri}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <SectionTitle title="Akıllı Uyarılar" />
          <div className="space-y-3">
            {alerts.map((a) => (
              <div key={a.title} className="flex gap-3 rounded-lg border bg-muted/50 p-3">
                <span className="mt-0.5">{toneIcon[a.tone]}</span>
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
