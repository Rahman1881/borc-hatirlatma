import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getDefaultUyumsoftServiceUrl } from "@/lib/uyumsoft";

const UYUMSOFT_SETTING_KEYS = [
  "uyumsoft_service_url",
  "uyumsoft_username",
  "uyumsoft_password",
  "uyumsoft_vkn_tckn",
  "uyumsoft_last_test_at",
  "uyumsoft_last_test_success",
  "uyumsoft_last_test_message",
];

function getSettings() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${UYUMSOFT_SETTING_KEYS.map(
        () => "?"
      ).join(",")})`
    )
    .all(...UYUMSOFT_SETTING_KEYS) as { key: string; value: string }[];

  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export async function GET() {
  const settings = getSettings();
  return NextResponse.json({
    serviceUrl:
      settings.uyumsoft_service_url || getDefaultUyumsoftServiceUrl(),
    username: settings.uyumsoft_username || "",
    password: settings.uyumsoft_password || "",
    vknTckn: settings.uyumsoft_vkn_tckn || "",
    hasCredentials: Boolean(
      settings.uyumsoft_username && settings.uyumsoft_password
    ),
    lastTestAt: settings.uyumsoft_last_test_at || "",
    lastTestSuccess: settings.uyumsoft_last_test_success === "true",
    lastTestMessage: settings.uyumsoft_last_test_message || "",
  });
}

export async function POST(req: NextRequest) {
  const { serviceUrl, username, password, vknTckn } = await req.json();

  if (!username || !password) {
    return NextResponse.json(
      { error: "Uyumsoft kullanıcı adı ve şifre bilgisi gerekli" },
      { status: 400 }
    );
  }

  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );

  upsert.run(
    "uyumsoft_service_url",
    String(serviceUrl || getDefaultUyumsoftServiceUrl()).trim()
  );
  upsert.run("uyumsoft_username", String(username).trim());
  upsert.run("uyumsoft_password", String(password));
  upsert.run("uyumsoft_vkn_tckn", String(vknTckn || "").trim());

  return NextResponse.json({ success: true });
}
