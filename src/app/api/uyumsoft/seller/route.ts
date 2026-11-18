import { NextRequest, NextResponse } from "next/server";
import { getSellerInfo, saveSellerInfo } from "@/lib/uyumsoft-seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UTTS fatura taslaklarında gönderen olarak yazılan şirket bilgileri.
export async function GET() {
  return NextResponse.json(getSellerInfo());
}

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(saveSellerInfo((await req.json()) as Record<string, unknown>));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kaydedilemedi" }, { status: 400 });
  }
}
