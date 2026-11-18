import { NextRequest, NextResponse } from "next/server";
import { addDosya } from "@/lib/belgeler";

export const dynamic = "force-dynamic";

// Bir belgeye dosya yükler (multipart: belgeId + dosya[, dosya…]).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const belgeId = Number(form.get("belgeId"));
    const files = form.getAll("dosya").filter((f): f is File => typeof f !== "string");
    if (!belgeId || files.length === 0) return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 400 });
    const saved = [];
    for (const f of files) saved.push(await addDosya(belgeId, f));
    return NextResponse.json({ ok: true, dosyalar: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dosya yüklenemedi." }, { status: 400 });
  }
}
