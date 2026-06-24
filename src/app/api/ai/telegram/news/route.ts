import { NextRequest, NextResponse } from "next/server";
import { buildNewsReport } from "@/lib/news";

export const maxDuration = 60;

// Worker (telegram-bot.mjs) günlük haber saatinde bu ucu çağırır. Google Haberler
// RSS + Gemini ile 5 petrol/akaryakıt haberi özeti döndürür. Gün bazında önbelleklenir.
// ?force=1 ile önbelleği atlayıp yeniden üretir (test için).
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") === "1";
    const result = await buildNewsReport(force);
    return NextResponse.json({ ok: result.ok, text: result.text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Haber bülteni üretilemedi.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
