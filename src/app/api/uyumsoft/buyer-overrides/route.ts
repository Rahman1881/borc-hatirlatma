import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export const runtime = "nodejs";

interface InvoiceBuyerOverrideRow {
  source_tax_number: string;
  tax_number: string;
  buyer_type: string;
  buyer_name: string;
  buyer_surname: string;
  tax_office: string;
  city: string;
  district: string;
  address: string;
  email: string;
  phone: string;
  updated_at: string;
}

function normalizeTaxNumber(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function toApi(row: InvoiceBuyerOverrideRow) {
  return {
    sourceTaxNumber: row.source_tax_number,
    taxNumber: row.tax_number,
    buyerType: row.buyer_type,
    buyerName: row.buyer_name,
    buyerSurname: row.buyer_surname,
    taxOffice: row.tax_office,
    city: row.city,
    district: row.district,
    address: row.address,
    email: row.email,
    phone: row.phone,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT source_tax_number, tax_number, buyer_type, buyer_name,
              buyer_surname, tax_office, city, district, address, email,
              phone, updated_at
         FROM invoice_buyer_overrides
        ORDER BY updated_at DESC`
    )
    .all() as InvoiceBuyerOverrideRow[];

  return NextResponse.json({ overrides: rows.map(toApi) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sourceTaxNumber =
    normalizeTaxNumber(body.sourceTaxNumber) || normalizeTaxNumber(body.taxNumber);
  const taxNumber = normalizeTaxNumber(body.taxNumber);
  const buyerType = normalizeText(body.buyerType);
  const buyerName = normalizeText(body.buyerName);
  const buyerSurname = normalizeText(body.buyerSurname);

  if (!sourceTaxNumber) {
    return NextResponse.json(
      { error: "Kaydetmek için kaynak VKN/TCKN gerekli" },
      { status: 400 }
    );
  }

  if (!/^\d{10,11}$/.test(taxNumber)) {
    return NextResponse.json(
      { error: "VKN/TCKN 10 veya 11 haneli olmalı" },
      { status: 400 }
    );
  }

  if (buyerType !== "company" && buyerType !== "person") {
    return NextResponse.json(
      { error: "Alıcı tipi şahıs veya tüzel olmalı" },
      { status: 400 }
    );
  }

  if (!buyerName) {
    return NextResponse.json(
      { error: "Ad/ünvan alanı gerekli" },
      { status: 400 }
    );
  }

  if (buyerType === "person" && !buyerSurname) {
    return NextResponse.json(
      { error: "Şahıs için soyad alanı gerekli" },
      { status: 400 }
    );
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO invoice_buyer_overrides (
       source_tax_number, tax_number, buyer_type, buyer_name, buyer_surname,
       tax_office, city, district, address, email, phone, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(source_tax_number) DO UPDATE SET
       tax_number = excluded.tax_number,
       buyer_type = excluded.buyer_type,
       buyer_name = excluded.buyer_name,
       buyer_surname = excluded.buyer_surname,
       tax_office = excluded.tax_office,
       city = excluded.city,
       district = excluded.district,
       address = excluded.address,
       email = excluded.email,
       phone = excluded.phone,
       updated_at = datetime('now','localtime')`
  ).run(
    sourceTaxNumber,
    taxNumber,
    buyerType,
    buyerName,
    buyerType === "person" ? buyerSurname : "",
    normalizeText(body.taxOffice),
    normalizeText(body.city),
    normalizeText(body.district),
    normalizeText(body.address),
    normalizeText(body.email),
    normalizeText(body.phone)
  );

  const row = db
    .prepare(
      `SELECT source_tax_number, tax_number, buyer_type, buyer_name,
              buyer_surname, tax_office, city, district, address, email,
              phone, updated_at
         FROM invoice_buyer_overrides
        WHERE source_tax_number = ?`
    )
    .get(sourceTaxNumber) as InvoiceBuyerOverrideRow;

  return NextResponse.json({ override: toApi(row) });
}
