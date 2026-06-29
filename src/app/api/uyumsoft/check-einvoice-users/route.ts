import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  getDefaultUyumsoftServiceUrl,
  resolveEInvoiceRouting,
  type EInvoiceRouting,
  type UyumsoftEInvoiceUserResult,
  type UyumsoftSettings,
} from "@/lib/uyumsoft";

export const runtime = "nodejs";

const UYUMSOFT_SETTING_KEYS = [
  "uyumsoft_service_url",
  "uyumsoft_username",
  "uyumsoft_password",
  "uyumsoft_vkn_tckn",
];

function getSettings(): UyumsoftSettings {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${UYUMSOFT_SETTING_KEYS.map(
        () => "?"
      ).join(",")})`
    )
    .all(...UYUMSOFT_SETTING_KEYS) as { key: string; value: string }[];

  const settings = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  return {
    serviceUrl: settings.uyumsoft_service_url || getDefaultUyumsoftServiceUrl(),
    username: settings.uyumsoft_username || "",
    password: settings.uyumsoft_password || "",
    vknTckn: settings.uyumsoft_vkn_tckn || "",
  };
}

interface PairInput {
  key: string;
  vkn?: string;
  tckn?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pairs: PairInput[] = Array.isArray(body.pairs) ? body.pairs : [];

    if (pairs.length === 0) {
      return NextResponse.json(
        { error: "Sorgulanacak VKN/TCKN bilgisi yok" },
        { status: 400 }
      );
    }

    const settings = getSettings();
    if (!settings.username || !settings.password) {
      return NextResponse.json(
        { error: "Önce Uyumsoft web servis bilgilerini kaydedin" },
        { status: 400 }
      );
    }

    const cache = new Map<string, UyumsoftEInvoiceUserResult>();
    const results: Record<string, EInvoiceRouting> = {};
    const validPairs = pairs.filter((pair) => pair.key);

    // Sorgular sırayla yapılırsa çok kayıtta dakikalara çıkıyor; sınırlı
    // eşzamanlılıkla paralel çalıştırıyoruz. Cache aynı numarayı tekrar sormayı önler.
    const CONCURRENCY = 10;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, validPairs.length) }, async () => {
        while (cursor < validPairs.length) {
          const pair = validPairs[cursor++];
          results[pair.key] = await resolveEInvoiceRouting(
            settings,
            { vkn: pair.vkn, tckn: pair.tckn },
            cache
          );
        }
      })
    );

    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Mükellef sorgusu sırasında hata oluştu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
