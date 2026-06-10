import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

const UTTS_SETTING_KEYS = [
  "utts_email",
  "utts_password",
  "utts_access_token",
  "utts_token_expires_at",
];

function getSettings() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${UTTS_SETTING_KEYS.map(
        () => "?"
      ).join(",")})`
    )
    .all(...UTTS_SETTING_KEYS) as { key: string; value: string }[];

  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export async function GET() {
  const settings = getSettings();
  return NextResponse.json({
    email: settings.utts_email || "",
    password: settings.utts_password || "",
    hasCredentials: Boolean(settings.utts_email && settings.utts_password),
    isConnected: Boolean(
      settings.utts_access_token &&
        Number(settings.utts_token_expires_at || 0) > Date.now()
    ),
    tokenExpiresAt: settings.utts_token_expires_at || "",
  });
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "UTTS e-posta ve şifre bilgisi gerekli" },
      { status: 400 }
    );
  }

  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );

  upsert.run("utts_email", String(email));
  upsert.run("utts_password", String(password));

  return NextResponse.json({ success: true });
}
