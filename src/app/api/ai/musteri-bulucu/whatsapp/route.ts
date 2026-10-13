import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getWAState, sendWhatsAppMessage, NOT_ON_WHATSAPP } from "@/lib/whatsapp";
import { toWhatsAppNumber } from "@/lib/phone";

// Müşteri Bulucu → WhatsApp ilk tanıtım mesajı.
//
// Bilinçli olarak TEK TEK gönderim: her mesaj kullanıcının butona basmasıyla gider.
// Mesajlar borç hatırlatmalarıyla aynı numaradan çıktığı için toplu soğuk mesaj
// numaranın engellenme riskini artırır; bu yüzden toplu gönderim yok, aynı
// işletmeye/numaraya ikinci kez (onaysız) ve "İlgilenmiyor" işaretlenmiş işletmeye
// gönderim engellenir.
//
// GET  -> { templates, firma, sentToday }
// POST -> action: send | saveTemplate | deleteTemplate

type Template = { id: number; name: string; body: string };
type SavedRow = { data: string };

// Gönderimi süren numaralar: çift tıklamada aynı kişiye iki mesaj gitmesin.
const inFlight = new Set<string>();

// Şablon değişkenleri: {isletme} = karşı işletmenin adı, {firma} = bizim işletme adımız.
// Her şablonda gönderen kimliği ({firma}) ve "istemiyorsanız RET yazın" satırı var:
// ticari iletilerde gönderen bilgisi ve ret imkânı sunulması gerekiyor.
const DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  {
    name: "Kurumsal Tanışma",
    body:
      "Merhaba, {isletme} yetkilisi,\n\n" +
      "{firma} olarak bölgemizdeki firmalara kurumsal akaryakıt hizmeti veriyoruz. " +
      "Araçlarınız için cari hesapla aylık faturalı çalışma ve kurumsal müşterilerimize " +
      "sunduğumuz avantajlar hakkında kısaca bilgi vermek isteriz.\n\n" +
      "Uygun olursanız sizi arayalım ya da detayları buradan iletelim.\n" +
      "İyi çalışmalar dileriz.\n\n" +
      "(Bu tür mesajlar almak istemiyorsanız RET yazmanız yeterli.)",
  },
  {
    name: "Taşıt Tanıma Sistemi",
    body:
      "Merhaba, {isletme} yetkilisi,\n\n" +
      "{firma} olarak firma araçlarına taşıt tanıma sistemi kuruyoruz. Yakıt alımları " +
      "otomatik kaydedilir, araç bazında raporlanır; fiş ve nakit takibiyle uğraşmazsınız.\n\n" +
      "Detayları paylaşmamızı ister misiniz?\n\n" +
      "(Bu tür mesajlar almak istemiyorsanız RET yazmanız yeterli.)",
  },
  {
    name: "Kısa Tanışma",
    body:
      "Merhaba, {firma} olarak yazıyoruz.\n\n" +
      "{isletme} araçlarının akaryakıt ihtiyacı için kurumsal çalışma imkânlarımızı " +
      "kısaca anlatmak isteriz. Uygun olduğunuz bir zamanda sizi arayabilir miyiz?\n\n" +
      "(İstemiyorsanız RET yazmanız yeterli.)",
  },
];

const SEEDED_KEY = "prospect_templates_seeded";

// İlk açılışta hazır şablonları bir kez ekler. Bayrak sayesinde kullanıcı hepsini
// silerse bir daha geri gelmezler.
function ensureTemplates(): void {
  const db = getDb();
  const seeded = db.prepare("SELECT value FROM settings WHERE key = ?").get(SEEDED_KEY);
  if (seeded) return;
  const insert = db.prepare("INSERT INTO prospect_templates (name, body) VALUES (?, ?)");
  db.transaction(() => {
    for (const t of DEFAULT_TEMPLATES) insert.run(t.name, t.body);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").run(SEEDED_KEY);
  })();
}

function getFirma(): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'business_name'")
    .get() as { value: string } | undefined;
  return row?.value?.trim() || "Çark Petrol";
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function countSentToday(): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM musteri_saved WHERE json_extract(data, '$.waSentAt') >= ?"
    )
    .get(startOfTodayMs()) as { n: number };
  return row.n;
}

export async function GET() {
  try {
    ensureTemplates();
    const templates = getDb()
      .prepare("SELECT id, name, body FROM prospect_templates ORDER BY id")
      .all() as Template[];
    return NextResponse.json({ templates, firma: getFirma(), sentToday: countSentToday() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Şablonlar okunamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const db = getDb();

    if (action === "saveTemplate") {
      const name = String(body?.name ?? "").trim();
      const text = String(body?.body ?? "").trim();
      if (!name || !text) {
        return NextResponse.json({ error: "Şablon adı ve metni gerekli." }, { status: 400 });
      }
      const id = Number(body?.id);
      if (Number.isInteger(id) && id > 0) {
        db.prepare("UPDATE prospect_templates SET name = ?, body = ? WHERE id = ?").run(
          name,
          text,
          id
        );
        return NextResponse.json({ ok: true, id });
      }
      const r = db
        .prepare("INSERT INTO prospect_templates (name, body) VALUES (?, ?)")
        .run(name, text);
      return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (action === "deleteTemplate") {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) {
        return NextResponse.json({ error: "Eksik id." }, { status: 400 });
      }
      db.prepare("DELETE FROM prospect_templates WHERE id = ?").run(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "send") {
      const lead = body?.lead;
      const text = String(body?.message ?? "").trim();
      const region = String(body?.region ?? "");
      if (!lead || typeof lead.id !== "string" || !text) {
        return NextResponse.json({ error: "İşletme ve mesaj gerekli." }, { status: 400 });
      }

      const phone = toWhatsAppNumber(String(lead.phone ?? ""));
      if (!phone) {
        return NextResponse.json(
          { error: "Bu numara bir cep telefonu değil; WhatsApp mesajı gönderilemez." },
          { status: 400 }
        );
      }

      const row = db
        .prepare("SELECT data FROM musteri_saved WHERE id = ?")
        .get(lead.id) as SavedRow | undefined;
      const existing = row ? JSON.parse(row.data) : null;

      // Takip numara üzerinden de yapılır: Google'da aynı firmanın birden çok kaydı
      // olabiliyor (ör. "X Lojistik" ve "X Lojistik Depo") ve aynı numarayı
      // kullanıyorlar. Başka kayıt üzerinden mesaj gitmişse ya da RET yazılmışsa
      // bu kayıt yeni görünse bile aynı kişidir.
      const samePhone = (
        db.prepare("SELECT data FROM musteri_saved WHERE id != ?").all(lead.id) as SavedRow[]
      )
        .map((r) => JSON.parse(r.data))
        .filter((c) => toWhatsAppNumber(String(c.phone ?? "")) === phone);

      // Ret yazmış (İlgilenmiyor) işletmeye/numaraya bir daha yazılmaz — zorlansa bile.
      if (existing?.status === "İlgilenmiyor") {
        return NextResponse.json(
          { error: "Bu işletme 'İlgilenmiyor' olarak işaretli; mesaj gönderilmez." },
          { status: 409 }
        );
      }
      const optedOut = samePhone.find((c) => c.status === "İlgilenmiyor");
      if (optedOut) {
        return NextResponse.json(
          {
            error: `Bu numara "${optedOut.name}" kaydında 'İlgilenmiyor' olarak işaretli; mesaj gönderilmez.`,
          },
          { status: 409 }
        );
      }

      // Aynı işletmeye/numaraya ikinci mesaj yalnızca kullanıcı bilerek onaylarsa gider.
      if (body?.force !== true) {
        if (existing?.waSentAt) {
          return NextResponse.json(
            { error: "already_sent", waSentAt: existing.waSentAt },
            { status: 409 }
          );
        }
        const prev = samePhone
          .filter((c) => c.waSentAt)
          .sort((a, b) => b.waSentAt - a.waSentAt)[0];
        if (prev) {
          return NextResponse.json(
            { error: "already_sent", waSentAt: prev.waSentAt, otherName: prev.name },
            { status: 409 }
          );
        }
      }

      if (getWAState().status !== "ready") {
        return NextResponse.json(
          { error: "WhatsApp bağlı değil. Ayarlar'dan bağlanın." },
          { status: 503 }
        );
      }
      if (inFlight.has(phone)) {
        return NextResponse.json(
          { error: "Bu numaraya mesaj zaten gönderiliyor." },
          { status: 409 }
        );
      }

      inFlight.add(phone);
      let result: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
      try {
        result = await sendWhatsAppMessage(phone, text);
      } finally {
        inFlight.delete(phone);
      }
      if (!result.success) {
        // Numara WhatsApp'ta yoksa kayıtlı müşteride işaretle; buton bir daha görünmesin.
        const waMissing = result.error === NOT_ON_WHATSAPP;
        if (existing && waMissing) {
          db.prepare("UPDATE musteri_saved SET data = ? WHERE id = ?").run(
            JSON.stringify({ ...existing, waStatus: "yok" }),
            lead.id
          );
        }
        return NextResponse.json(
          { error: result.error || "Gönderilemedi.", waMissing },
          { status: 502 }
        );
      }

      // Gönderilen işletme Kayıtlı Müşteriler'e "Mesaj Atıldı" durumuyla eklenir
      // (zaten kayıtlıysa güncellenir); takip oradan sürdürülür.
      const now = Date.now();
      const customer = {
        ...lead,
        ...(existing ?? { savedAt: now, region, note: "" }),
        status: "Mesaj Atıldı",
        waSentAt: now,
        waMessage: text,
      };
      db.prepare(
        "INSERT OR REPLACE INTO musteri_saved (id, saved_at, data) VALUES (?, ?, ?)"
      ).run(lead.id, customer.savedAt ?? now, JSON.stringify(customer));

      return NextResponse.json({ ok: true, customer, sentToday: countSentToday() });
    }

    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem başarısız.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
