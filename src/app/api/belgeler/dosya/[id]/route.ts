import { NextRequest, NextResponse } from "next/server";
import { readDosya } from "@/lib/belgeler";

export const dynamic = "force-dynamic";

// Yüklenmiş dosyayı verir. PDF ve resimler tarayıcıda açılır, diğerleri (ya da ?indir=1) iner.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dosya = readDosya(Number(id));
  if (!dosya) return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 404 });
  const inline = (dosya.tip === "application/pdf" || dosya.tip.startsWith("image/")) && !new URL(req.url).searchParams.has("indir");
  const ascii = dosya.ad.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(dosya.data), {
    headers: {
      "Content-Type": dosya.tip,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(dosya.ad)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
