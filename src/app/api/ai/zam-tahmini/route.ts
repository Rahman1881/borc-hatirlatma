import { NextRequest, NextResponse } from "next/server";
import {
  bootstrapForecast,
  buildStatusText,
  computeForecast,
  fetchTimeTr,
  getForecastConfig,
  listPrices,
  refreshMarket,
  refreshPumpPrices,
  saveForecastConfig,
  setChangeIgnored,
  type Fuel,
} from "@/lib/fuel-forecast";

// Portal → Zam/İndirim Tahmini sayfası.
//  GET  → durum, piyasa verisi, gerçekleşen değişiklikler, ayarlar
//  POST { action: "refresh" } → Yahoo + Opet'ten şimdi çek
//       { action: "config", ...ayarlar } | { action: "ignore", tarih, yakit, ignored }

function snapshot() {
  const config = getForecastConfig();
  const calc = computeForecast(config);
  const byDate = (f: Fuel) => new Map(calc[f].rows.map((r) => [r.tarih, r]));
  const m = byDate("motorin");
  const b = byDate("benzin");
  const prices = listPrices();
  const rows = prices
    .slice()
    .reverse()
    .slice(0, 60)
    .map((q) => ({ ...q, motorin: m.get(q.tarih) ?? null, benzin: b.get(q.tarih) ?? null }));
  const changes = [...calc.motorin.changes, ...calc.benzin.changes]
    .sort((x, y) => y.tarih.localeCompare(x.tarih))
    .slice(0, 30);
  return {
    config,
    fetchTime: fetchTimeTr(),
    lastFetched: prices.reduce((a, p) => Math.max(a, p.fetched_at), 0) || null,
    latest: { motorin: calc.motorin.latest, benzin: calc.benzin.latest },
    lastChange: { motorin: calc.motorin.lastChange, benzin: calc.benzin.lastChange },
    rows,
    changes,
    statusText: buildStatusText(config),
  };
}

export async function GET() {
  try {
    return NextResponse.json(snapshot());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Veriler okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "refresh") {
      // İlk kurulumda geçmişi doldurur; sonra son günleri tazeler. Telegram'a göndermez.
      await bootstrapForecast();
      await refreshPumpPrices(30);
      await refreshMarket();
      return NextResponse.json(snapshot());
    }
    if (body.action === "config") {
      saveForecastConfig(body);
      return NextResponse.json(snapshot());
    }
    if (body.action === "ignore") {
      const yakit = body.yakit === "benzin" ? "benzin" : "motorin";
      setChangeIgnored(String(body.tarih || ""), yakit, Boolean(body.ignored));
      return NextResponse.json(snapshot());
    }
    return NextResponse.json({ error: "Bilinmeyen işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
