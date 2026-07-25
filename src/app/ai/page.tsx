import { Panel, SectionTitle, Pill } from "@/components/ai/ui";
import { WeeklyAreaChart, FuelMixChart } from "@/components/ai/charts";
import { buildDashboardData, type DashboardData } from "@/lib/station-report";
import {
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  PlugZap,
} from "lucide-react";

// Gösterge paneli her istekte güncel VRD satış verisini okur (build anında dondurulmaz).
export const dynamic = "force-dynamic";

function loadDashboard(): DashboardData {
  try {
    return buildDashboardData();
  } catch {
    return {
      hasData: false,
      stationName: "",
      dateLabel: "",
      summary: "Gösterge paneli verisi okunamadı.",
      kpis: [],
      weekly: [],
      fuelMix: [],
      shifts: [],
    };
  }
}

export default function AiDashboardPage() {
  const data = loadDashboard();

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              AI Günlük Özet
              {data.dateLabel ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  · {data.dateLabel}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{data.summary}</p>
          </div>
        </div>
      </Panel>

      {!data.hasData ? (
        <Panel>
          <div className="flex items-start gap-3">
            <span className="mt-0.5">
              <PlugZap className="h-5 w-5 text-amber-500" />
            </span>
            <div>
              <p className="text-sm font-semibold">Pompa satış verisi bağlı değil</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Gösterge paneli gerçek pompa (VRD) satışından beslenir. Veri bulunamadı —
                Ayarlar&apos;dan VRD klasörü yolunu kontrol edin. Aşağıdaki modül durumları
                hangi entegrasyonların aktif olduğunu gösterir.
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.kpis.map((k) => (
              <Panel key={k.key}>
                <p className="text-sm text-muted-foreground">{k.label}</p>
                <p
                  className={`mt-2 text-2xl font-bold tracking-tight ${
                    k.connected ? "" : "text-muted-foreground"
                  }`}
                >
                  {k.value}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  {k.connected && k.change ? (
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
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <PlugZap className="h-3.5 w-3.5" /> Bağlı değil
                    </span>
                  )}
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
              <WeeklyAreaChart data={data.weekly} />
            </Panel>
            <Panel>
              <SectionTitle title="Yakıt Dağılımı" />
              <FuelMixChart data={data.fuelMix} />
            </Panel>
          </div>

          <Panel>
            <SectionTitle
              title="Vardiya Performansı"
              action={<Pill>{data.dateLabel}</Pill>}
            />
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Vardiya</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ciro</th>
                    <th className="px-4 py-2.5 text-right font-medium">Litre</th>
                    <th className="px-4 py-2.5 text-right font-medium">Fiş</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shifts.map((s) => (
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
        </>
      )}
    </div>
  );
}
