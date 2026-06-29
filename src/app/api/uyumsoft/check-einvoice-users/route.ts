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

    const validPairs = pairs.filter((pair) => pair.key);
    const cache = new Map<string, UyumsoftEInvoiceUserResult>();
    const encoder = new TextEncoder();

    // Sonuçları NDJSON akışı olarak gönderiyoruz: her kayıt çözüldükçe bir
    // satır yazıyoruz. Böylece istemci ilerlemeyi gerçek zamanlı gösterebilir.
    // Sorgular sınırlı eşzamanlılıkla paralel; cache aynı numarayı tekrar sormaz.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        try {
          write({ type: "start", total: validPairs.length });

          const CONCURRENCY = 10;
          let cursor = 0;
          await Promise.all(
            Array.from(
              { length: Math.min(CONCURRENCY, validPairs.length) },
              async () => {
                while (cursor < validPairs.length) {
                  const pair = validPairs[cursor++];
                  let routing: EInvoiceRouting;
                  try {
                    routing = await resolveEInvoiceRouting(
                      settings,
                      { vkn: pair.vkn, tckn: pair.tckn },
                      cache
                    );
                  } catch {
                    // Tek bir kayıttaki hata tüm akışı durdurmasın; güvenli
                    // tarafta kalıp E-Arşiv kabul ediyoruz.
                    routing = {
                      taxNumber: (pair.vkn || pair.tckn || "").replace(
                        /\D/g,
                        ""
                      ),
                      scheme: pair.vkn ? "VKN" : "TCKN",
                      isEInvoice: false,
                      via: "none",
                      checked: false,
                    };
                  }
                  write({ type: "result", key: pair.key, routing });
                }
              }
            )
          );

          write({ type: "done" });
        } catch (err: unknown) {
          const message =
            err instanceof Error
              ? err.message
              : "Mükellef sorgusu sırasında hata oluştu";
          write({ type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Mükellef sorgusu sırasında hata oluştu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
