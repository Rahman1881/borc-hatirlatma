import { NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  const db = getDb();

  const customerStats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN total_debt > 0 THEN 1 ELSE 0 END) as with_debt,
        SUM(CASE WHEN overdue_debt > 0 THEN 1 ELSE 0 END) as with_overdue,
        SUM(CASE WHEN phone != '' AND phone IS NOT NULL THEN 1 ELSE 0 END) as with_phone,
        SUM(CASE WHEN total_debt > 0 AND phone != '' AND phone IS NOT NULL THEN 1 ELSE 0 END) as sendable,
        COALESCE(SUM(total_debt), 0) as total_debt_sum,
        COALESCE(SUM(CASE WHEN total_debt > 0 THEN total_debt ELSE 0 END), 0) as positive_debt_sum,
        COALESCE(SUM(CASE WHEN overdue_debt > 0 THEN overdue_debt ELSE 0 END), 0) as overdue_debt_sum
      FROM customers`
    )
    .get() as Record<string, number>;

  const messageStats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM messages`
    )
    .get() as Record<string, number>;

  const recentMessages = db
    .prepare(
      "SELECT * FROM messages ORDER BY sent_at DESC LIMIT 10"
    )
    .all();

  const lastUpload = db
    .prepare("SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT 1")
    .get();

  return NextResponse.json({
    customerStats,
    messageStats,
    recentMessages,
    lastUpload,
  });
}
