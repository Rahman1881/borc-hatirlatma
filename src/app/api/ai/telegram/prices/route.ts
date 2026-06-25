import { NextResponse } from "next/server";
import { buildPriceReport } from "@/lib/price-report";

export const maxDuration = 60;

// Worker (telegram-bot.mjs) rakip fiyat saatinde bu ucu çağırır. Belli başlı
// markaların benzin ve motorin fiyatlarını pahalıdan ucuza sıralı döndürür.
export async function GET() {
  try {
    const result = await buildPriceReport();
    return NextResponse.json({ ok: result.ok, text: result.text });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Rakip fiyat raporu üretilemedi.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
