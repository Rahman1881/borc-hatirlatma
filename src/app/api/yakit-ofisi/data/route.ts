import { NextRequest, NextResponse } from "next/server";
import {
  fleetNameMap,
  listCardErrorLimits,
  listChurnRisk,
  listDebtHolders,
  listLimitRunway,
  listRejectedAttempts,
  withGroups,
  type YoFleet,
  type YoFleetName,
} from "@/lib/yakit-ofisi";

// Yakıt Ofisi ekranlarının verisi (yalnız okuma).
// ?view=ozet|borclar|limit|churn|rejected|cards, &fresh=1 önbelleği atlar, rejected için &days=1..30.
// Her bölüm ayrı çekilir; biri hata verirse (ör. yetki yok) diğerleri yine gelir.

type Section<T> = { data: T | null; error: string | null };

async function section<T>(p: Promise<T>): Promise<Section<T>> {
  try {
    return { data: await p, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Veri alınamadı." };
  }
}

// Ad eşlemesi alınamazsa liste yine gösterilir, yalnız adlar boş kalır.
async function names(fresh: boolean): Promise<Map<number, YoFleetName>> {
  try {
    return await fleetNameMap(fresh);
  } catch {
    return new Map();
  }
}

const label = (f?: YoFleetName) => (f ? f.customName || f.name || f.code || null : null);

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const view = params.get("view") || "ozet";
  const fresh = params.get("fresh") === "1";
  const at = Date.now();

  if (view === "borclar") {
    const fleets = await section(listDebtHolders(fresh));
    return NextResponse.json({ fleets: { ...fleets, data: await withGroups(fleets.data, (f) => f.id, fresh) }, fetchedAt: at });
  }
  if (view === "limit") {
    const runway = await section(listLimitRunway(fresh));
    const fleets = await withGroups(runway.data?.fleets, (r) => r.fleetId, fresh);
    return NextResponse.json({ runway: { ...runway, data: runway.data && { ...runway.data, fleets } }, fetchedAt: at });
  }
  if (view === "churn") {
    const churn = await section(listChurnRisk(fresh));
    return NextResponse.json({ churn: { ...churn, data: await withGroups(churn.data, (c) => c.fleetId, fresh) }, fetchedAt: at });
  }
  if (view === "rejected") {
    const days = Math.min(30, Math.max(1, Number(params.get("days")) || 3));
    const rejected = await section(listRejectedAttempts(days, fresh));
    const map = rejected.data ? await names(fresh) : new Map<number, YoFleetName>();
    const rows = rejected.data?.map((r) => ({ ...r, fleetName: label(map.get(r.fleetID)) }));
    return NextResponse.json({
      rejected: { error: rejected.error, data: await withGroups(rows, (r) => r.fleetID, fresh) },
      days,
      fetchedAt: at,
    });
  }
  if (view === "cards") {
    const cards = await section(listCardErrorLimits(fresh));
    const map = cards.data ? await names(fresh) : new Map<number, YoFleetName>();
    const rows = cards.data?.map((c) => ({
      ...c,
      fleetName: label(map.get(c.fleetID)),
      fleetCode: map.get(c.fleetID)?.code ?? null,
    }));
    return NextResponse.json({
      cards: { error: cards.error, data: await withGroups(rows, (c) => c.fleetID, fresh) },
      fetchedAt: at,
    });
  }

  const debt = await section(listDebtHolders(fresh));
  const runway = await section(listLimitRunway(fresh));
  const churn = await section(listChurnRisk(fresh));
  const rejected = await section(listRejectedAttempts(3, fresh));
  const cards = await section(listCardErrorLimits(fresh));

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const overdue = debt.data?.filter((f) => (f.totalDebtDiscountedDueBeforeToday ?? 0) > 0) ?? [];
  const notDue = (f: YoFleet) => (f.totalDebtDiscounted ?? 0) - (f.totalDebtDiscountedDueBeforeToday ?? 0);
  const upcoming = debt.data?.filter((f) => notDue(f) > 0.5) ?? [];
  return NextResponse.json({
    overdue: {
      error: debt.error,
      data: debt.data && {
        count: overdue.length,
        dueBeforeToday: sum(overdue.map((f) => f.totalDebtDiscountedDueBeforeToday ?? 0)),
        pastDue: sum(overdue.map((f) => f.totalDebtDiscountedPastDue ?? 0)),
      },
    },
    upcoming: {
      error: debt.error,
      data: debt.data && { count: upcoming.length, amount: sum(upcoming.map(notDue)) },
    },
    runway: { error: runway.error, data: runway.data && { count: runway.data.fleets.length, critical: runway.data.criticalCount } },
    churn: { error: churn.error, data: churn.data && { count: churn.data.length } },
    rejected: { error: rejected.error, data: rejected.data && { count: rejected.data.length } },
    cardErrors: { error: cards.error, data: cards.data && { count: cards.data.length } },
    fetchedAt: at,
  });
}
