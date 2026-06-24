import { NextRequest, NextResponse } from "next/server";
import { askGemini, type ChatMessage } from "@/lib/gemini";
import { kpis, weeklySales, fuelMix, shifts, alerts } from "@/lib/ai-mock";
import { buildRealStationContext } from "@/lib/station-report";

// Pompa (VRD) satış verisi gerçek; market/tank gibi henüz bağlı olmayan kısımlar
// için örnek (mock) veri tamamlayıcı olarak eklenir.
function buildBusinessContext(): string {
  const kpiLines = kpis
    .map((k) => `- ${k.label}: ${k.value} (değişim ${k.change}, ${k.sub})`)
    .join("\n");

  const weekLines = weeklySales
    .map(
      (d) =>
        `- ${d.gun}: motorin ${d.motorin}, benzin ${d.benzin}, lpg ${d.lpg}, market ${d.market} (bin ₺)`
    )
    .join("\n");

  const mixLines = fuelMix.map((f) => `- ${f.name}: %${f.value}`).join("\n");

  const shiftLines = shifts
    .map((s) => `- ${s.name}: ciro ${s.ciro}, ${s.litre}, ${s.musteri} müşteri`)
    .join("\n");

  const alertLines = alerts
    .map((a) => `- [${a.tone}] ${a.title}: ${a.detail} (${a.time})`)
    .join("\n");

  // Gerçek pompa satış verisi (VRD) — varsa bağlamın başına eklenir.
  let realData = "";
  try {
    realData = buildRealStationContext();
  } catch {
    realData = "";
  }

  return `${realData ? realData + "\n\n---\n\n" : ""}TAMAMLAYICI ÖRNEK VERİLER (market/tank/uyarılar henüz canlı bağlı değil — örnek/mock):

Günlük KPI'lar:
${kpiLines}

Haftalık satış (bin ₺):
${weekLines}

Yakıt dağılımı (ciro payı):
${mixLines}

Vardiya özeti:
${shiftLines}

Aktif uyarılar:
${alertLines}`;
}

const SYSTEM_PROMPT_BASE = `Sen "Çark Petrol AI"sın — bir Petrol Ofisi akaryakıt istasyonunun patronu için çalışan iş zekası asistanısın.

Görevin: istasyonun satışları, kârlılığı, yakıt ve market cirosu, vardiyalar, tank seviyeleri ve müşterileri hakkında soruları Türkçe, net ve kısa cevaplamak.

Kurallar:
- Sadece sana verilen verilere dayan. Veride olmayan bir şey sorulursa dürüstçe "bu veri henüz bağlı değil (SiberPet/Uyumsoft entegrasyonu)" de.
- Rakamları Türk Lirası (₺) ve binlik ayraçla, kısa ve okunur biçimde ver.
- Patron gibi pratik konuş: önce cevap, sonra kısa gerekçe, gerekirse 1 öneri.
- Gereksiz uzun açıklama yapma; mobil/Telegram'da okunacak gibi yaz.
- BİÇİMLENDİRME: Düz metin yaz. Markdown KULLANMA. Kalın yazı için ** veya __ KULLANMA,
  başlık için # kullanma. Liste gerekiyorsa satır başına "• " koy (yıldız * değil).
  Vurgu gerekiyorsa kelimeyi olduğu gibi yaz; yıldız/alt çizgi ekleme.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming = Array.isArray(body?.messages) ? body.messages : [];

    const messages: ChatMessage[] = incoming
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof (m as ChatMessage).text === "string" &&
          ((m as ChatMessage).role === "user" ||
            (m as ChatMessage).role === "model")
      )
      .map((m: ChatMessage) => ({ role: m.role, text: m.text }));

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mesaj boş." }, { status: 400 });
    }

    const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${buildBusinessContext()}`;
    const reply = await askGemini(messages, systemPrompt);

    return NextResponse.json({ reply });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "AI isteği sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
