import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { loginUtts, UttsApiError } from "@/lib/utts";

function getSavedCredentials() {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('utts_email', 'utts_password')")
    .all() as { key: string; value: string }[];

  const settings = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  if (!settings.utts_email || !settings.utts_password) return null;
  return {
    email: settings.utts_email,
    password: settings.utts_password,
  };
}

function saveLoginSession(login: Awaited<ReturnType<typeof loginUtts>>) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );
  const expiresAt = Date.now() + ((login.expiresIn || 0) - 30) * 1000;

  upsert.run("utts_access_token", login.accessToken);
  upsert.run("utts_token_type", login.tokenType || "Bearer");
  upsert.run("utts_refresh_token", login.refreshToken || "");
  upsert.run("utts_token_expires_at", String(expiresAt));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const credentials =
      body.email && body.password
        ? { email: String(body.email), password: String(body.password) }
        : getSavedCredentials();

    if (!credentials) {
      return NextResponse.json(
        { error: "UTTS e-posta ve şifre bilgisi gerekli" },
        { status: 400 }
      );
    }

    const login = await loginUtts(credentials);
    saveLoginSession(login);

    const db = getDb();
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    upsert.run("utts_email", credentials.email);
    upsert.run("utts_password", credentials.password);

    return NextResponse.json({
      success: true,
      expiresIn: login.expiresIn || null,
      user: login.user || null,
    });
  } catch (err: unknown) {
    if (err instanceof UttsApiError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.status }
      );
    }

    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
