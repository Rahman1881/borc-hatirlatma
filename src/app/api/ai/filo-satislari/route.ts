import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  CUSTOMER_LABELS,
  FUEL_LABELS,
  fleetSalesOf,
  salePlate,
  summarizeFleets,
  summarizePlates,
  type FleetSaleRow,
} from "@/lib/vrd-sales";

export const runtime = "nodejs";
export const maxDuration = 60;

// 'YYYY-AA-GG SS:DD:SS' -> 'GG.AA.YYYY SS:DD'
function fmtWhen(when: string): string {
  const [d, t = ""] = when.split(" ");
  const [y, m, g] = d.split("-");
  return `${g}.${m}.${y} ${t.slice(0, 5)}`.trim();
}

function fmtIso(iso: string): string {
  const [y, m, g] = iso.split("-");
  return `${g}.${m}.${y}`;
}

// Excel için güvenli sayfa/dosya adı.
function safeName(s: string, max: number): string {
  return s.replace(/[\\/:*?"<>|[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "Filo";
}

function sheet(rows: Record<string, string | number>[], headers: string[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws["!cols"] = headers.map((h) => {
    const longest = rows.reduce((n, r) => Math.max(n, String(r[h] ?? "").length), h.length);
    return { wch: Math.min(Math.max(longest + 2, 8), 40) };
  });
  return ws;
}

// Fiş (tek tek satış) satırları; filo adı tüm filolar dökümünde eklenir.
function saleRows(sales: FleetSaleRow[], withFleet: boolean) {
  return sales.map((s) => ({
    Tarih: fmtIso(s.iso),
    Saat: s.saat,
    ...(withFleet ? { Filo: s.filoAdi.trim() } : {}),
    "Filo Kodu": s.kodu,
    Plaka: salePlate(s),
    Yakıt: FUEL_LABELS[s.yakit],
    "Yakıt (POAS)": s.yakitRaw,
    Litre: s.litre,
    "Birim Fiyat": s.fiyat,
    Tutar: s.tutar,
    Pompa: s.pompa,
    Tabanca: s.tabanca,
    "Fiş No": s.fisNo,
  }));
}

const SALE_HEADERS = [
  "Tarih", "Saat", "Filo", "Filo Kodu", "Plaka", "Yakıt", "Yakıt (POAS)",
  "Litre", "Birim Fiyat", "Tutar", "Pompa", "Tabanca", "Fiş No",
];

function buildExcel(files: string[], fleet: string | undefined, label: string) {
  const wb = XLSX.utils.book_new();
  const sales = fleetSalesOf(files, fleet);

  if (fleet) {
    const plates = summarizePlates(sales).map((p) => ({
      Plaka: p.plaka,
      "Fiş Adedi": p.adet,
      Litre: p.litre,
      Tutar: p.tutar,
      Yakıtlar: p.yakitlar,
      "İlk Alım": fmtWhen(p.ilkAlim),
      "Son Alım": fmtWhen(p.sonAlim),
    }));
    XLSX.utils.book_append_sheet(
      wb,
      sheet(plates, ["Plaka", "Fiş Adedi", "Litre", "Tutar", "Yakıtlar", "İlk Alım", "Son Alım"]),
      "Plakalar"
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheet(saleRows(sales, false), SALE_HEADERS.filter((h) => h !== "Filo")),
      "Fişler"
    );
  } else {
    const fleets = summarizeFleets(sales).map((f) => ({
      Filo: f.ad,
      "Filo Kodu": f.kodlar.join(", "),
      Tip: CUSTOMER_LABELS[f.musteri],
      "Plaka Sayısı": f.plakaSayisi,
      "Fiş Adedi": f.adet,
      Litre: f.litre,
      Tutar: f.tutar,
      "İlk Alım": fmtWhen(f.ilkAlim),
      "Son Alım": fmtWhen(f.sonAlim),
    }));
    XLSX.utils.book_append_sheet(
      wb,
      sheet(fleets, ["Filo", "Filo Kodu", "Tip", "Plaka Sayısı", "Fiş Adedi", "Litre", "Tutar", "İlk Alım", "Son Alım"]),
      "Filolar"
    );
    XLSX.utils.book_append_sheet(wb, sheet(saleRows(sales, true), SALE_HEADERS), "Fişler");
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const fileName = `${safeName(fleet ? `Filo - ${fleet}` : "Filo Satislari", 60)} - ${safeName(label, 60)}.xlsx`;

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="filo-satislari.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

// POST:
//  { action:"list",   files:[...] }                 -> dönemdeki tüm filolar
//  { action:"plates", files:[...], fleet }          -> filonun plaka dökümü + fişleri
//  { action:"excel",  files:[...], fleet?, label }  -> .xlsx (fleet yoksa tüm filolar)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const files: string[] = Array.isArray(body.files) ? body.files.map(String) : [];
    const fleet = typeof body.fleet === "string" && body.fleet.trim() ? body.fleet.trim() : undefined;

    if (action === "list") {
      return NextResponse.json({ filolar: summarizeFleets(fleetSalesOf(files)) });
    }

    if (action === "plates") {
      if (!fleet) return NextResponse.json({ error: "Filo seçilmedi." }, { status: 400 });
      const sales = fleetSalesOf(files, fleet);
      return NextResponse.json({
        plakalar: summarizePlates(sales),
        fisler: sales.map((s) => ({
          iso: s.iso,
          saat: s.saat,
          plaka: salePlate(s),
          yakit: FUEL_LABELS[s.yakit],
          litre: s.litre,
          fiyat: s.fiyat,
          tutar: s.tutar,
          pompa: s.pompa,
          fisNo: s.fisNo,
        })),
      });
    }

    if (action === "excel") {
      return buildExcel(files, fleet, String(body.label || ""));
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem sırasında hata oluştu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
