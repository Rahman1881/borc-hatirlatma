import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const LOGO_PATH = path.join(process.cwd(), "data", "logo-sirket.png");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // ?image=1 → resmi binary olarak döndür
  if (url.searchParams.get("image") === "1") {
    if (!fs.existsSync(LOGO_PATH)) {
      return new NextResponse(null, { status: 404 });
    }
    const buffer = fs.readFileSync(LOGO_PATH);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  }

  // Normal → sadece var/yok bilgisi
  const exists = fs.existsSync(LOGO_PATH);
  return NextResponse.json({ hasLogo: exists });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("logo") as File;

    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
    }

    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: "Sadece PNG, JPG veya WEBP formatı desteklenir" },
        { status: 400 }
      );
    }

    // data/ klasörü yoksa oluştur
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(LOGO_PATH, buffer);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  if (fs.existsSync(LOGO_PATH)) {
    fs.unlinkSync(LOGO_PATH);
  }
  return NextResponse.json({ success: true });
}
