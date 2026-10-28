import { NextRequest, NextResponse } from "next/server";
import { fleetNameMap, listPurchases, salesSummary, withGroups, type YoFleetName } from "@/lib/yakit-ofisi";

// Satışlar ekranının verisi (yalnız okuma).
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (ikisi de dahil) &type=Fuel|AdBlue|Toll (boş = hepsi)
// &group=Customer|City|Dealer|Plate  — özet, grafik serisi ve kırılım tablosu
// &view=purchases — tek tek satış hareketleri. &fresh=1 önbelleği atlar.

const GROUPS = new Set(["Customer", "City", "Dealer", "Plate"]);
const TYPES = new Set(["Fuel", "AdBlue", "Toll"]);
const MAX_DAYS = 366 * 2;

type Section<T> = { data: T | null; error: string | null };

async function section<T>(p: Promise<T>): Promise<Section<T>> {
  try {
    return { data: await p, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Veri alınamadı." };
  }
}

const parse = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const fresh = p.get("fresh") === "1";
  const from = parse(p.get("from"));
  const toIncl = parse(p.get("to"));
  if (!from || !toIncl || toIncl < from) {
    return NextResponse.json({ error: "Tarih aralığı geçersiz." }, { status: 400 });
  }
  const days = Math.round((toIncl.getTime() - from.getTime()) / 86400_000) + 1;
  if (days > MAX_DAYS) return NextResponse.json({ error: "En fazla iki yıllık aralık seçilebilir." }, { status: 400 });

  // Yakıt Ofisi'nde bitiş tarihi hariç; ekranda seçilen son gün dahil olsun diye bir gün eklenir.
  const to = addDays(toIncl, 1);
  const type = TYPES.has(p.get("type") ?? "") ? (p.get("type") as string) : undefined;

  if (p.get("view") === "purchases") {
    const result = await section(listPurchases(ymd(from), ymd(to), fresh));
    let names = new Map<number, YoFleetName>();
    if (result.data?.items) {
      try {
        names = await fleetNameMap(fresh);
      } catch {
        // adlar gelmezse kodla gösterilir
      }
    }
    const isType = (v: unknown) => !type || v === type || v === ["Fuel", "AdBlue", "Toll"].indexOf(type);
    return NextResponse.json({
      purchases: {
        error: result.error,
        data: result.data && {
          total: result.data.total,
          items:
            (await withGroups(
              result.data.items
                ?.filter((x) => isType(x.purchaseType))
                .map((x) => {
                  const f = names.get(x.fleetID);
                  return { ...x, fleetName: f ? f.customName || f.name || f.code : null };
                }),
              (x) => x.fleetID,
              fresh,
            )) ?? null,
        },
      },
      fetchedAt: Date.now(),
    });
  }

  // Karşılaştırma: hemen önceki aynı uzunlukta dönem.
  const compareFrom = addDays(from, -days);
  const range = { from: ymd(from), to: ymd(to), purchaseType: type };
  const compare = { compareFrom: ymd(compareFrom), compareTo: ymd(from) };
  const group = GROUPS.has(p.get("group") ?? "") ? (p.get("group") as string) : "Customer";
  const bucket = days > 62 ? "Month" : "Day";

  const totals = await section(salesSummary({ ...range, ...compare }, fresh));
  const series = await section(salesSummary({ ...range, timeBucket: bucket }, fresh));
  const groups = await section(salesSummary({ ...range, ...compare, groupBy: group }, fresh));

  return NextResponse.json({
    totals: { error: totals.error, data: totals.data?.[0] ?? null },
    series,
    // Müşteri kırılımında satırlara Yakıt Ofisi grubu eklenir (grup filtresi için).
    groups: group === "Customer" ? { ...groups, data: await withGroups(groups.data, (r) => r.dimensionID, fresh) } : groups,
    bucket,
    group,
    range: { from: ymd(from), to: ymd(toIncl), days },
    compareRange: { from: ymd(compareFrom), to: ymd(addDays(from, -1)) },
    fetchedAt: Date.now(),
  });
}
