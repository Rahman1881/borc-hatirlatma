import { NextRequest, NextResponse } from "next/server";
import {
  buildStatusText,
  computeForecast,
  defaultEntryDate,
  deleteQuote,
  getForecastConfig,
  listQuotes,
  parsePrice,
  settleVisibleTr,
  saveForecastConfig,
  saveQuote,
  setChangeIgnored,
  type Fuel,
} from "@/lib/fuel-forecast";
import { listChats } from "@/lib/telegram";

// Portal → Zam/İndirim Tahmini sayfası.
//  GET  → durum, girişler, gerçekleşen değişiklikler, ayarlar
//  POST { action: "save", tarih, z6, a3g } | { action: "delete", tarih }
//       { action: "config", ...ayarlar } | { action: "ignore", tarih, yakit, ignored }

function snapshot() {
  const config = getForecastConfig();
  const calc = computeForecast(config);
  const names = new Map(listChats().map((c) => [c.chatId, c.name]));
  const byDate = (f: Fuel) => new Map(calc[f].rows.map((r) => [r.tarih, r]));
  const m = byDate("motorin");
  const b = byDate("benzin");
  const quotes = listQuotes()
    .reverse()
    .slice(0, 60)
    .map((q) => ({
      ...q,
      enteredByName: q.entered_by === "portal" ? "Portal" : names.get(q.entered_by ?? "") || q.entered_by || "",
      motorin: m.get(q.tarih) ?? null,
      benzin: b.get(q.tarih) ?? null,
    }));
  const changes = [...calc.motorin.changes, ...calc.benzin.changes]
    .sort((x, y) => y.tarih.localeCompare(x.tarih))
    .slice(0, 20);
  return {
    config,
    defaultTarih: defaultEntryDate(),
    settleTime: settleVisibleTr(),
    latest: { motorin: calc.motorin.latest, benzin: calc.benzin.latest },
    lastChange: { motorin: calc.motorin.lastChange, benzin: calc.benzin.lastChange },
    quotes,
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

// Telegram girişiyle aynı kurallar: "1.025,3", "1,025.345", "985,3" ...
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return parsePrice(String(v)) ?? NaN;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "save") {
      const z6 = toNum(body.z6);
      const a3g = toNum(body.a3g);
      if (Number.isNaN(z6) || Number.isNaN(a3g))
        return NextResponse.json({ error: "Fiyatlar sayı olmalı." }, { status: 400 });
      const r = await saveQuote({ tarih: String(body.tarih || ""), z6, a3g, by: "portal" });
      if (!r.ok) return NextResponse.json({ error: r.text }, { status: 400 });
      return NextResponse.json({ ...snapshot(), broadcast: r.broadcast ?? 0 });
    }
    if (body.action === "delete") {
      deleteQuote(String(body.tarih || ""));
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
