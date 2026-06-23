import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getGeminiApiKey, getGeminiModel } from "@/lib/gemini";
import { getPlacesApiKey } from "@/lib/places";
import { getVrdDir, getVrdDirRaw, checkVrdDir } from "@/lib/vrd-sales";

function mask(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

// İstasyon bilgisi ayar anahtarları ve varsayılanları.
const STATION_DEFAULTS: Record<string, string> = {
  station_name: "Çark Petrol Ofisi",
  station_dealer_code: "",
  station_il: "Sakarya",
  station_ilce: "Serdivan",
  station_yetkili: "Patron",
};

function getStation() {
  const db = getDb();
  const out: Record<string, string> = {};
  for (const key of Object.keys(STATION_DEFAULTS)) {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    out[key] = row?.value ?? STATION_DEFAULTS[key];
  }
  return out;
}

export async function GET() {
  const key = getGeminiApiKey();
  const placesKey = getPlacesApiKey();
  const effectiveDir = getVrdDir();
  return NextResponse.json({
    configured: key.length > 0,
    masked: mask(key),
    model: getGeminiModel(),
    placesConfigured: placesKey.length > 0,
    placesMasked: mask(placesKey),
    vrdDir: getVrdDirRaw(),
    vrdDirEffective: effectiveDir,
    vrdCheck: checkVrdDir(effectiveDir),
    station: getStation(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );

    if (typeof body.apiKey === "string" && body.apiKey.trim().length > 0) {
      upsert.run("gemini_api_key", body.apiKey.trim());
    }
    if (typeof body.model === "string" && body.model.trim().length > 0) {
      upsert.run("gemini_model", body.model.trim());
    }
    if (
      typeof body.placesApiKey === "string" &&
      body.placesApiKey.trim().length > 0
    ) {
      upsert.run("google_places_api_key", body.placesApiKey.trim());
    }
    // VRD klasör yolu: boş gönderilirse varsayılana dönmek için kaydı siler.
    if (typeof body.vrdDir === "string") {
      const v = body.vrdDir.trim();
      if (v.length > 0) {
        upsert.run("vrd_dir", v);
      } else {
        db.prepare("DELETE FROM settings WHERE key = ?").run("vrd_dir");
      }
    }

    // İstasyon bilgileri: gönderilen alanları kaydeder.
    if (body.station && typeof body.station === "object") {
      for (const key of Object.keys(STATION_DEFAULTS)) {
        const v = body.station[key];
        if (typeof v === "string") {
          upsert.run(key, v.trim());
        }
      }
    }

    const key = getGeminiApiKey();
    const placesKey = getPlacesApiKey();
    const effectiveDir = getVrdDir();
    return NextResponse.json({
      success: true,
      configured: key.length > 0,
      masked: mask(key),
      model: getGeminiModel(),
      placesConfigured: placesKey.length > 0,
      placesMasked: mask(placesKey),
      vrdDir: getVrdDirRaw(),
      vrdDirEffective: effectiveDir,
      vrdCheck: checkVrdDir(effectiveDir),
      station: getStation(),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Ayar kaydedilemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
