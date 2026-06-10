import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  getDefaultUyumsoftServiceUrl,
  testUyumsoftConnection,
} from "@/lib/uyumsoft";

function saveTestResult(success: boolean, message: string) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );

  upsert.run("uyumsoft_last_test_at", new Date().toISOString());
  upsert.run("uyumsoft_last_test_success", String(success));
  upsert.run("uyumsoft_last_test_message", message);
}

function saveCredentials(input: {
  serviceUrl?: string;
  username?: string;
  password?: string;
  vknTckn?: string;
}) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );

  upsert.run(
    "uyumsoft_service_url",
    String(input.serviceUrl || getDefaultUyumsoftServiceUrl()).trim()
  );
  upsert.run("uyumsoft_username", String(input.username || "").trim());
  upsert.run("uyumsoft_password", String(input.password || ""));
  upsert.run("uyumsoft_vkn_tckn", String(input.vknTckn || "").trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = {
      serviceUrl: String(body.serviceUrl || getDefaultUyumsoftServiceUrl()),
      username: String(body.username || ""),
      password: String(body.password || ""),
      vknTckn: String(body.vknTckn || ""),
    };

    saveCredentials(settings);

    const result = await testUyumsoftConnection(settings);
    saveTestResult(result.success, result.message);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      rawResponse: result.rawResponse,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Uyumsoft bağlantı testi sırasında hata oluştu";
    saveTestResult(false, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
