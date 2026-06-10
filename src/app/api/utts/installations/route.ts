import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  fetchUttsInstallations,
  loginUtts,
  UttsApiError,
  UttsInstallationQuery,
} from "@/lib/utts";

function getSettingMap() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];

  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function saveToken(accessToken: string, expiresIn?: number) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  );
  const expiresAt = Date.now() + ((expiresIn || 0) - 30) * 1000;

  upsert.run("utts_access_token", accessToken);
  upsert.run("utts_token_expires_at", String(expiresAt));
}

async function getAccessToken() {
  const settings = getSettingMap();
  const savedToken = settings.utts_access_token;
  const expiresAt = Number(settings.utts_token_expires_at || 0);

  if (savedToken && expiresAt > Date.now()) {
    return savedToken;
  }

  if (!settings.utts_email || !settings.utts_password) {
    throw new UttsApiError("UTTS giriş bilgileri kayıtlı değil", 400);
  }

  const login = await loginUtts({
    email: settings.utts_email,
    password: settings.utts_password,
  });
  saveToken(login.accessToken, login.expiresIn);
  return login.accessToken;
}

function getQuery(req: NextRequest): UttsInstallationQuery {
  const url = new URL(req.url);
  return {
    pageNumber: Number(
      url.searchParams.get("pageNumber") ||
        url.searchParams.get("PageNumber") ||
        1
    ),
    pageSize: Number(
      url.searchParams.get("pageSize") ||
        url.searchParams.get("PageSize") ||
        100
    ),
    installationCode:
      url.searchParams.get("installationCode") ||
      url.searchParams.get("InstallationCode") ||
      "",
    licensePlate:
      url.searchParams.get("licensePlate") ||
      url.searchParams.get("LicensePlate") ||
      "",
    startActivationDate:
      url.searchParams.get("startActivationDate") ||
      url.searchParams.get("StartActivationDate") ||
      "",
    endActivationDate:
      url.searchParams.get("endActivationDate") ||
      url.searchParams.get("EndActivationDate") ||
      "",
    referenceNumber:
      url.searchParams.get("referenceNumber") ||
      url.searchParams.get("ReferenceNumber") ||
      "",
    vehicleOrderInstallationStatus:
      url.searchParams.get("vehicleOrderInstallationStatus") ||
      url.searchParams.get("VehicleOrderInstallationStatus") ||
      "",
  };
}

export async function GET(req: NextRequest) {
  try {
    const token = await getAccessToken();
    const data = await fetchUttsInstallations(token, getQuery(req));
    return NextResponse.json({ success: true, data });
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
