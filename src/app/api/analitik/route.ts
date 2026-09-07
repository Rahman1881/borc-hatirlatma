import { NextRequest, NextResponse } from "next/server";
import { hasIngestedData } from "@/lib/vrd-ingest";
import { getOverview, getPlateProfile, type Period } from "@/lib/vrd-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["gun", "hafta", "ay", "ozel"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "overview";

  try {
    // Veri aktarılmış mı? (ilk açılış senkron ekranı için)
    if (view === "status") {
      return NextResponse.json({ hasData: hasIngestedData() });
    }

    // Tek plaka profili
    if (view === "plaka") {
      const q = url.searchParams.get("q") || "";
      const profile = getPlateProfile(q);
      if (!profile) {
        return NextResponse.json({ error: "Bu plakaya ait peşin satış bulunamadı." }, { status: 404 });
      }
      return NextResponse.json({ profile });
    }

    // Genel bakış
    const periodParam = (url.searchParams.get("period") || "gun") as Period;
    const period = PERIODS.includes(periodParam) ? periodParam : "gun";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const range =
      period === "ozel" && ISO_RE.test(from) && ISO_RE.test(to) ? { from, to } : undefined;
    return NextResponse.json({ hasData: hasIngestedData(), overview: getOverview(period, range) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analitik verisi alınamadı." },
      { status: 500 }
    );
  }
}
