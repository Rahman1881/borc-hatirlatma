import { NextRequest, NextResponse } from "next/server";
import {
  getCalendar,
  summarizeFiles,
  getVrdDir,
} from "@/lib/vrd-sales";
import { askGemini, isGeminiConfigured } from "@/lib/gemini";

export const maxDuration = 60;

// GET: gün bazlı takvim (her gün + vardiyaları) + yapılandırma durumu.
export async function GET() {
  try {
    const calendar = getCalendar();
    return NextResponse.json({
      calendar,
      vrdDir: getVrdDir(),
      geminiConfigured: isGeminiConfigured(),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Satış verisi okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST:
//  { action:"summary", files:[...] }            -> seçili vardiyaların birleşik özeti
//  { action:"analyze", files:[...], label }     -> seçimin AI yorumu
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

    if (action === "analyze") {
      if (!isGeminiConfigured()) {
        return NextResponse.json(
          {
            error:
              "Gemini API anahtarı tanımlı değil. Ayarlar > Yapay Zeka bölümünden anahtarı girin.",
          },
          { status: 400 }
        );
      }
      if (files.length === 0) {
        return NextResponse.json(
          { error: "Yorumlanacak vardiya seçilmedi." },
          { status: 400 }
        );
      }

      const label = String(body.label || "Seçili dönem");
      const summary = summarizeFiles(files);

      const systemPrompt = `Sen Sakarya/Serdivan'daki bir Petrol Ofisi akaryakıt istasyonunun satış analisti uzmanısın. Sana belirli bir dönemin (gün, vardiya, hafta veya ay) birleştirilmiş pompa satış özeti verilecek (yakıt bazlı litre/ciro, pompa dağılımı, saatlik yoğunluk, müşteri tipi dağılımı, en çok alan filolar). Görevin:
- Dönemin genel performansını kısaca özetlemek (ciro, litre, fiş adedi).
- En çok satan yakıtı ve en yoğun saatleri belirtmek.
- Filo/açık hesap satışlarının payı hakkında yorum yapmak.
- İstasyon için kısa, uygulanabilir 1-2 öneri vermek.
Türkçe, kısa ve madde madde yaz. Veride olmayan bilgiyi uydurma.`;

      const userText = JSON.stringify({
        donem: label,
        vardiyaSayisi: files.length,
        toplamCiro: summary.toplamTutar,
        toplamLitre: summary.toplamLitre,
        fisAdedi: summary.fisAdedi,
        yakitlar: summary.yakitlar,
        pompalar: summary.pompalar,
        saatlikYogunluk: summary.saatler,
        musteriTipi: summary.musteriTipi,
        enCokAlanFilolar: summary.topFilolar,
      });

      const analysis = await askGemini(
        [{ role: "user", text: userText }],
        systemPrompt
      );

      return NextResponse.json({ analysis });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "İşlem sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
