import { NextRequest, NextResponse } from "next/server";
import { deleteYoKey, getYoSettings, saveYoSettings, testYoConnection } from "@/lib/yakit-ofisi";

// Yakıt Ofisi bağlantı ayarları. Anahtarın tamamı hiçbir zaman geri döndürülmez.
//  GET    → { baseUrl, hasKey, keyHint, lastTest }
//  POST   { apiKey?, baseUrl? } → kaydeder ve bağlantıyı dener
//  POST   { action: "test" }    → yalnız bağlantıyı dener
//  DELETE → anahtarı siler

export async function GET() {
  return NextResponse.json(getYoSettings());
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action !== "test") saveYoSettings(body);
    const test = getYoSettings().hasKey ? await testYoConnection() : null;
    return NextResponse.json({ ...getYoSettings(), test });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kaydedilemedi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  deleteYoKey();
  return NextResponse.json(getYoSettings());
}
