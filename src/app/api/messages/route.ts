import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { sendBulkMessages, fillTemplate } from "@/lib/whatsapp";

export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "list";
  const date = url.searchParams.get("date") || "";

  // Tarihe göre gruplu özet
  if (view === "dates") {
    const dates = db.prepare(`
      SELECT
        date(sent_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        MIN(sent_at) as first_at,
        MAX(sent_at) as last_at
      FROM messages
      GROUP BY date(sent_at)
      ORDER BY date(sent_at) DESC
    `).all();
    return NextResponse.json({ dates });
  }

  // Belirli bir tarihin mesajları
  if (date) {
    const messages = db.prepare(`
      SELECT * FROM messages
      WHERE date(sent_at) = ?
      ORDER BY sent_at DESC
    `).all(date);
    return NextResponse.json({ messages, total: messages.length });
  }

  // Eski uyumluluk: sayfalı liste
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  const total = db.prepare("SELECT COUNT(*) as count FROM messages").get() as {
    count: number;
  };
  const messages = db
    .prepare("SELECT * FROM messages ORDER BY sent_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset);

  return NextResponse.json({ messages, total: total.count, page, limit });
}

export async function POST(req: NextRequest) {
  const { customerIds, templateId } = await req.json();

  if (!customerIds?.length || !templateId) {
    return NextResponse.json(
      { error: "Müşteri ve şablon seçimi gerekli" },
      { status: 400 }
    );
  }

  const db = getDb();
  const template = db
    .prepare("SELECT * FROM templates WHERE id = ?")
    .get(templateId) as { id: number; name: string; body: string } | undefined;

  if (!template) {
    return NextResponse.json(
      { error: "Şablon bulunamadı" },
      { status: 404 }
    );
  }

  const placeholders = customerIds.map(() => "?").join(",");
  const customers = db
    .prepare(
      `SELECT * FROM customers WHERE id IN (${placeholders}) AND phone LIKE '905%'`
    )
    .all(...customerIds) as {
    id: number;
    name: string;
    phone: string;
    total_debt: number;
    overdue_debt: number;
    toplam_alacak: number;
    tarihli_bakiye: number;
    son_durum: number;
    toplam_risk: number;
  }[];

  const bulkMessages = customers.map((customer) => ({
    phone: customer.phone,
    body: fillTemplate(template.body, {
      name: customer.name,
      totalDebt: customer.total_debt,
      overdueDebt: customer.overdue_debt,
      toplamAlacak: customer.toplam_alacak,
      tarihliBakiye: customer.tarihli_bakiye,
      sonDurum: customer.son_durum,
      toplamRisk: customer.toplam_risk,
    }),
    customerId: customer.id,
    customerName: customer.name,
  }));

  const insertMessage = db.prepare(`
    INSERT INTO messages (customer_id, customer_name, phone, template_id, body, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = await sendBulkMessages(bulkMessages, (progress) => {
    const msg = bulkMessages.find((m) => m.customerId === progress.customerId);
    insertMessage.run(
      progress.customerId,
      progress.customerName,
      msg?.phone || "",
      template.id,
      msg?.body || "",
      progress.status,
      progress.error || null
    );
  });

  return NextResponse.json({
    total: customers.length,
    sent: result.sent,
    failed: result.failed,
  });
}
