import { Panel } from "@/components/ai/ui";

// Gösterge paneli VRD verisini sunucuda okurken gösterilen iskelet ekran.
// Gerçek sayfanın (page.tsx) yerleşimini birebir taklit eder; tıklama anında
// görünür, veri gelince gerçek içerikle değişir.
export default function AiDashboardLoading() {
  return (
    <div className="space-y-6">
      {/* AI Günlük Özet şeridi */}
      <Panel className="animate-pulse bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
          <div className="w-full space-y-2">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      </Panel>

      {/* KPI kartları */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Panel key={i} className="animate-pulse">
            <div className="h-4 w-1/2 rounded bg-muted" />
            <div className="mt-3 h-7 w-2/3 rounded bg-muted" />
            <div className="mt-4 flex items-center justify-between">
              <div className="h-4 w-16 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          </Panel>
        ))}
      </div>

      {/* Haftalık trend + yakıt dağılımı */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="animate-pulse lg:col-span-2">
          <div className="mb-4 h-4 w-48 rounded bg-muted" />
          <div className="h-56 w-full rounded-lg bg-muted" />
        </Panel>
        <Panel className="animate-pulse">
          <div className="mb-4 h-4 w-32 rounded bg-muted" />
          <div className="mx-auto h-40 w-40 rounded-full bg-muted" />
        </Panel>
      </div>

      {/* Vardiya performansı + akıllı uyarılar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="animate-pulse lg:col-span-2">
          <div className="mb-4 h-4 w-40 rounded bg-muted" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 w-full rounded bg-muted" />
            ))}
          </div>
        </Panel>
        <Panel className="animate-pulse">
          <div className="mb-4 h-4 w-32 rounded bg-muted" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 w-full rounded-lg bg-muted" />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
