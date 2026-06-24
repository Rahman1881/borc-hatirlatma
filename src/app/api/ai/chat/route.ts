import { NextRequest, NextResponse } from "next/server";
import { askGemini, type ChatMessage } from "@/lib/gemini";
import { buildRealStationContext } from "@/lib/station-report";

// Sohbet bağlamı yalnızca gerçek pompa (VRD) satış verisinden üretilir.
// Market/tank gibi henüz bağlı olmayan veriler için AI dürüstçe "bağlı değil" der.
function buildBusinessContext(): string {
  try {
    return buildRealStationContext();
  } catch {
    return "GÜNCEL VERİ: Pompa satış verisi (VRD) henüz okunamadı.";
  }
}

const SYSTEM_PROMPT_BASE = `Sen "Çark Petrol AI"sın — bir Petrol Ofisi akaryakıt istasyonunun patronu için çalışan iş zekası asistanısın.

Görevin: istasyonun satışları, kârlılığı, yakıt ve market cirosu, vardiyalar, tank seviyeleri ve müşterileri hakkında soruları Türkçe, net ve kısa cevaplamak.

Kurallar:
- Sadece sana verilen GERÇEK satış verilerine dayan. ASLA rakam uydurma.
- Market cirosu, tank/stok seviyeleri ve dış uyarılar HENÜZ bağlı DEĞİL. Bunlar sorulursa
  dürüstçe "bu veri henüz bağlı değil (SiberPet/Uyumsoft entegrasyonu)" de; tahmini sayı verme.
- "En yoğun saat/vardiya" sorulursa verideki saatlik satış ve vardiya kırılımını kullan.
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
