import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function PUT(req: NextRequest) {
  const { id, field, value } = await req.json();

  if (!id || !field) {
    return NextResponse.json({ error: "Eksik parametre" }, { status: 400 });
  }

  const allowedFields = ["name", "phone", "total_debt", "overdue_debt", "city", "district", "filo_group"];
  if (!allowedFields.includes(field)) {
    return NextResponse.json({ error: "Geçersiz alan" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(`UPDATE customers SET ${field} = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(value, id);

  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "all";
  const search = url.searchParams.get("search") || "";
  const group = url.searchParams.get("group") || "";
  const phoneOnly = url.searchParams.get("phone_only") === "1";
  const minDebt = parseFloat(url.searchParams.get("min_debt") || "0");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  let where = "1=1";

  if (phoneOnly) {
    where += " AND phone LIKE '905%'";
  }
  const params: (string | number)[] = [];

  if (minDebt > 0) {
    where += " AND total_debt >= ?";
    params.push(minDebt);
  }

  if (filter === "debt") {
    where += " AND total_debt > 0";
  } else if (filter === "overdue") {
    where += " AND overdue_debt > 0";
  } else if (filter === "with_phone") {
    where += " AND phone LIKE '905%'";
  } else if (filter === "no_phone") {
    where += " AND (phone = '' OR phone IS NULL OR phone NOT LIKE '905%')";
  }

  if (group) {
    const groupList = group.split(",").filter(Boolean);
    if (groupList.length > 0) {
      const placeholders = groupList.map(() => "?").join(",");
      where += ` AND filo_group IN (${placeholders})`;
      params.push(...groupList);
    }
  }

  if (search) {
    where += " AND (name LIKE ? OR phone LIKE ? OR city LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM customers WHERE ${where}`)
    .get(...params) as { count: number };

  const customers = db
    .prepare(
      `SELECT * FROM customers WHERE ${where} ORDER BY total_debt DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN total_debt > 0 THEN 1 ELSE 0 END) as with_debt,
        SUM(CASE WHEN overdue_debt > 0 THEN 1 ELSE 0 END) as with_overdue,
        SUM(CASE WHEN phone LIKE '905%' THEN 1 ELSE 0 END) as with_phone,
        SUM(CASE WHEN phone = '' OR phone IS NULL OR phone NOT LIKE '905%' THEN 1 ELSE 0 END) as no_phone,
        SUM(total_debt) as total_debt_sum,
        SUM(overdue_debt) as overdue_debt_sum
      FROM customers`
    )
    .get();

  // Get unique groups
  const groups = db
    .prepare(
      `SELECT filo_group, COUNT(*) as count FROM customers
       WHERE filo_group != '' AND filo_group IS NOT NULL
       GROUP BY filo_group ORDER BY count DESC`
    )
    .all() as { filo_group: string; count: number }[];

  return NextResponse.json({
    customers,
    total: total.count,
    page,
    limit,
    stats,
    groups,
  });
}
