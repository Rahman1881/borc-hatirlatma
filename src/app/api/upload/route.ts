import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { parseCSV, parseXLSX, CustomerRow } from "@/lib/csv-parser";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    let rows: CustomerRow[];

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      rows = parseXLSX(buffer);
    } else {
      const decoder = new TextDecoder("windows-1254");
      let content = decoder.decode(buffer);
      if (!content.includes(";")) {
        content = buffer.toString("utf-8");
      }
      rows = parseCSV(content);
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Dosyada geçerli veri bulunamadı" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Clear existing data and re-import
    db.exec("DELETE FROM messages");
    db.exec("DELETE FROM customers");

    const insert = db.prepare(`
      INSERT INTO customers (code, filo_code, name, phone, total_debt, overdue_debt, credit_limit, city, district, email, fuel_access, filo_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items: CustomerRow[]) => {
      for (const row of items) {
        insert.run(
          row.code,
          row.filoCode,
          row.name,
          row.phone,
          row.totalDebt,
          row.overdueDebt,
          row.creditLimit,
          row.city,
          row.district,
          row.email,
          row.fuelAccess,
          row.filoGroup
        );
      }
    });

    insertMany(rows);

    // Log the upload
    db.prepare(
      "INSERT INTO uploads (filename, total_rows, imported_rows) VALUES (?, ?, ?)"
    ).run(file.name, rows.length, rows.length);

    return NextResponse.json({
      success: true,
      imported: rows.length,
      withPhone: rows.filter((r) => r.phone).length,
      withDebt: rows.filter((r) => r.totalDebt > 0).length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
