import { NextRequest, NextResponse } from "next/server";
import {
  getCalendar,
  summarizeFiles,
  getVrdDir,
} from "@/lib/vrd-sales";

export const maxDuration = 60;

// GET: gün bazlı takvim (her gün + vardiyaları) + yapılandırma durumu.
export async function GET() {
  try {
    const calendar = getCalendar();
    return NextResponse.json({
      calendar,
      vrdDir: getVrdDir(),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Satış verisi okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST:
//  { action:"summary", files:[...] }            -> seçili vardiyaların birleşik özeti
// NOT: AI yorumu ("analyze") kaldırıldı; satış raporu artık Gemini kullanmaz.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const files: string[] = Array.isArray(body.files)
      ? body.files.map(String)
      : [];

    if (action === "summary") {
      const summary = summarizeFiles(files);
      return NextResponse.json({ summary });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "İşlem sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
