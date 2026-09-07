import { NextResponse } from "next/server";
import { syncVrd } from "@/lib/vrd-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// VRD → SQLite senkronunu başlatır ve ilerlemeyi NDJSON akışı olarak döner.
// İlk açılışta tüm arşiv (backfill), sonraki çağrılarda yalnız yeni/değişmiş
// dosyalar işlenir. Her birkaç dosyada bir event loop'a dönerek akış flush edilir.
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        let lastFlush = 0;
        const result = await syncVrd(async (p) => {
          // Her dosyada satır yazmak yerine ~10 dosyada bir ilerleme yolla
          // (ağ ve render yükünü azaltır); ilk dosyayı da hemen bildir.
          if (p.processed - lastFlush >= 10 || p.processed === 1) {
            lastFlush = p.processed;
            write({ type: "progress", ...p });
            // event loop'a dön: chunk flush olsun, sqlite bloğu nefes alsın
            await new Promise((r) => setImmediate(r));
          }
        });
        write({ type: "done", ...result });
      } catch (err) {
        write({
          type: "error",
          error: err instanceof Error ? err.message : "Senkron sırasında hata oluştu",
        });
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
}

// Basit durum ucu: veri aktarılmış mı?
export function GET() {
  return NextResponse.json({ ok: true });
}
