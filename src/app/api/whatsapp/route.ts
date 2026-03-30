import { NextRequest, NextResponse } from "next/server";
import { getWAState, initWhatsApp, disconnectWhatsApp } from "@/lib/whatsapp";

export async function GET() {
  const state = getWAState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const { action } = await req.json();

  if (action === "connect") {
    initWhatsApp();
    return NextResponse.json({ success: true, message: "Bağlantı başlatılıyor..." });
  }

  if (action === "disconnect") {
    await disconnectWhatsApp();
    return NextResponse.json({ success: true, message: "Bağlantı kesildi" });
  }

  return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
}
