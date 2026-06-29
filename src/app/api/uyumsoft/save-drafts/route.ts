import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  escapeXml,
  getDefaultUyumsoftServiceUrl,
  resolveEInvoiceRouting,
  saveUyumsoftDrafts,
  type UyumsoftEInvoiceUserResult,
  type UyumsoftSettings,
} from "@/lib/uyumsoft";

export const runtime = "nodejs";

type UttsRow = Record<string, unknown>;

const DEFAULT_VAT_RATE = 20;
const UYUMSOFT_UTTS_NOTE =
  "Açıklama:UTTS Kapsamında Düzenlenen Yetkilendirilmiş Firma Taşıt Montaj Faturasıdır.Fatura Tahsilatı  DARPANE VE DAMGA MATBAASI GENEL MÜDÜRĞÜ'nce yapılmıştır.Sevk Yeri ÖÇİFTÇİ ÇARKPETROL SANAYİ TİCARET LİMİTED ŞİRKETİ - CUMHURİYET MAHALLESİ FARABİ CADDESİ NO :8 ADAPAZARI/SAKARYA TÜRKİYE";

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

function getText(row: UttsRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getFirstText(row: UttsRow, keys: string[]) {
  for (const key of keys) {
    const value = getText(row, key);
    if (value) return value;
  }
  return "";
}

function getNumber(row: UttsRow, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;

  const cleaned = String(value)
    .replace(/TL/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFirstNumber(row: UttsRow, keys: string[]) {
  for (const key of keys) {
    const value = getNumber(row, key);
    if (value) return value;
  }
  return 0;
}

const TAX_NUMBER_KEYS = [
  "invoiceTaxNumber",
  "taxInfoNumber",
  "identificationNumberForInvoice",
  "vknTckn",
  "taxNumber",
  "identityNumber",
  "customerTaxNumber",
  "customerIdentityNumber",
];

function getTaxNumber(row: UttsRow) {
  return getFirstText(row, TAX_NUMBER_KEYS).replace(/\D/g, "");
}

// Bir satırda VKN (10 hane) ve TCKN (11 hane) ayrı alanlarda gelebiliyor.
// Tüm aday alanları tarayıp uzunluğa göre sınıflandırır.
function getVknTcknPair(row: UttsRow): { vkn: string; tckn: string } {
  let vkn = "";
  let tckn = "";
  for (const key of TAX_NUMBER_KEYS) {
    const value = getText(row, key).replace(/\D/g, "");
    if (!vkn && value.length === 10) vkn = value;
    if (!tckn && value.length === 11) tckn = value;
  }
  return { vkn, tckn };
}

function getBuyerName(row: UttsRow) {
  return getFirstText(row, [
    "invoiceBuyerName",
    "vehicleCompanyName",
    "customerName",
    "buyerName",
    "title",
    "name",
  ]);
}

function getBuyerSurname(row: UttsRow) {
  return getFirstText(row, [
    "invoiceBuyerSurname",
    "surname",
    "customerSurname",
    "buyerSurname",
    "lastName",
  ]);
}

function splitBuyerName(row: UttsRow) {
  const buyerName = getBuyerName(row);
  const explicitSurname = getBuyerSurname(row);
  const buyerType = getText(row, "invoiceBuyerType");
  const taxNumber = getTaxNumber(row);

  if (buyerType === "company") {
    return { name: buyerName, surname: "" };
  }

  if (explicitSurname || taxNumber.length !== 11) {
    return { name: buyerName, surname: explicitSurname };
  }

  const parts = buyerName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { name: buyerName, surname: "" };
  }

  return {
    name: parts.slice(0, -1).join(" "),
    surname: parts.at(-1) || "",
  };
}

function getEmail(row: UttsRow) {
  return getFirstText(row, [
    "invoiceEmail",
    "driverEmail",
    "email",
    "vehicleCompanyEmail",
    "customerEmail",
    "buyerEmail",
  ]);
}

function getPhone(row: UttsRow) {
  return getFirstText(row, [
    "invoicePhone",
    "driverPhoneNumber",
    "vehicleCompanyPhoneNumber",
    "phone",
    "phoneNumber",
    "mobilePhone",
    "gsm",
    "customerPhone",
    "vehicleCompanyPhone",
  ]);
}

function getTaxOffice(row: UttsRow) {
  return getFirstText(row, [
    "invoiceTaxOffice",
    "taxOffice",
    "taxOfficeName",
    "taxInfoOffice",
    "customerTaxOffice",
  ]);
}

function getCity(row: UttsRow) {
  return getFirstText(row, [
    "invoiceCity",
    "city",
    "cityName",
    "addressCity",
    "customerCity",
    "vehicleCompanyCity",
  ]);
}

function getDistrict(row: UttsRow) {
  return getFirstText(row, [
    "invoiceDistrict",
    "district",
    "districtName",
    "addressDistrict",
    "customerDistrict",
    "vehicleCompanyDistrict",
  ]);
}

function getAddress(row: UttsRow) {
  return getFirstText(row, [
    "invoiceAddress",
    "address",
    "fullAddress",
    "addressText",
    "customerAddress",
    "vehicleCompanyAddress",
    "streetName",
  ]);
}

function getProductName(row: UttsRow) {
  return (
    getFirstText(row, [
      "productName",
      "materialName",
      "deviceName",
      "deviceTypeName",
      "ttbTypeName",
      "montageTypeName",
      "installationTypeName",
      "serviceName",
      "stockName",
      "itemName",
    ]) || "UTTS Taşıt Montaj Hizmeti"
  );
}

function getPlate(row: UttsRow) {
  return getFirstText(row, ["licensePlate", "plate", "vehiclePlate"]);
}

function getUnitPrice(row: UttsRow) {
  return getFirstNumber(row, [
    "netSalePriceString",
    "unitPrice",
    "unitPriceString",
    "price",
    "priceString",
    "salePriceString",
  ]);
}

function formatAmount(value: number) {
  return value.toFixed(2);
}

function normalizeInvoiceDate(value: string) {
  const normalized = value || new Date().toISOString().slice(0, 10);
  return normalized.split("T")[0].slice(0, 10);
}

function getIssueDateTime(invoiceDate: string) {
  const date = normalizeInvoiceDate(invoiceDate);
  return {
    issueDate: date,
    issueTime: "12:00:00",
  };
}

function getSellerName(settings: UyumsoftSettings) {
  return settings.username || "UTTS Yetkili Montaj Firması";
}

function buildGroups(rows: UttsRow[], mergeByBuyer: boolean) {
  if (!mergeByBuyer) {
    return rows.map((row) => [row]);
  }

  const groups = new Map<string, UttsRow[]>();
  rows.forEach((row, index) => {
    const taxNumber = getTaxNumber(row);
    const key = /^\d{10,11}$/.test(taxNumber)
      ? `tax-${taxNumber}`
      : `single-${index}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });

  return Array.from(groups.values());
}

function buildPartyXml(input: {
  taxNumber: string;
  title: string;
  surname?: string;
  taxOffice?: string;
  city?: string;
  district?: string;
  address?: string;
  email?: string;
  phone?: string;
}) {
  const scheme = input.taxNumber.length === 11 ? "TCKN" : "VKN";
  const isPerson = scheme === "TCKN";
  const safeTitle = input.title || "Alıcı";
  const safeSurname = input.surname || "";

  return `<cac:Party>
          <cbc:WebsiteURI/>
          <cac:PartyIdentification>
            <cbc:ID schemeID="${scheme}">${escapeXml(input.taxNumber)}</cbc:ID>
          </cac:PartyIdentification>
          <cac:PartyName>
            <cbc:Name>${escapeXml(isPerson ? `${safeTitle} ${safeSurname}`.trim() : safeTitle)}</cbc:Name>
          </cac:PartyName>
          <cac:PostalAddress>
            <cbc:StreetName>${escapeXml(input.address || "")}</cbc:StreetName>
            <cbc:CitySubdivisionName>${escapeXml(input.district || "")}</cbc:CitySubdivisionName>
            <cbc:CityName>${escapeXml(input.city || "")}</cbc:CityName>
            <cac:Country>
              <cbc:Name>Türkiye</cbc:Name>
            </cac:Country>
          </cac:PostalAddress>
          <cac:PartyTaxScheme>
            <cac:TaxScheme>
              <cbc:Name>${escapeXml(input.taxOffice || "")}</cbc:Name>
            </cac:TaxScheme>
          </cac:PartyTaxScheme>
          ${
            isPerson
              ? `<cac:Person>
            <cbc:FirstName>${escapeXml(safeTitle)}</cbc:FirstName>
            <cbc:FamilyName>${escapeXml(safeSurname || safeTitle)}</cbc:FamilyName>
          </cac:Person>`
              : ""
          }
          <cac:Contact>
            <cbc:Telephone>${escapeXml(input.phone || "")}</cbc:Telephone>
            <cbc:ElectronicMail>${escapeXml(input.email || "")}</cbc:ElectronicMail>
          </cac:Contact>
        </cac:Party>`;
}

function buildInvoiceLineXml(row: UttsRow, index: number) {
  const unitPrice = getUnitPrice(row);
  const taxAmount = unitPrice * (DEFAULT_VAT_RATE / 100);
  const productName = getProductName(row);
  const plate = getPlate(row);
  const note = plate ? `${productName} - Plaka: ${plate}` : productName;

  return `<cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:Note>${escapeXml(note)}</cbc:Note>
      <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="TRY">${formatAmount(unitPrice)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="TRY">${formatAmount(taxAmount)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="TRY">${formatAmount(unitPrice)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="TRY">${formatAmount(taxAmount)}</cbc:TaxAmount>
          <cbc:Percent>${DEFAULT_VAT_RATE}</cbc:Percent>
          <cac:TaxCategory>
            <cac:TaxScheme>
              <cbc:Name>KDV</cbc:Name>
              <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${escapeXml(productName)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="TRY">${formatAmount(unitPrice)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
}

function getInvoiceNoteRows(group: UttsRow[]) {
  return group
    .map((row, index) => {
      const noteParts = [
        getPlate(row),
        getText(row, "installationCode"),
        getProductName(row),
      ].filter(Boolean);

      if (noteParts.length === 0) return "";
      return group.length > 1
        ? `${index + 1}. ${noteParts.join(" | ")}`
        : noteParts.join(" | ");
    })
    .filter(Boolean);
}

function buildInvoiceNotesXml(group: UttsRow[]) {
  const notes = [UYUMSOFT_UTTS_NOTE, ...getInvoiceNoteRows(group)];

  return notes
    .map((note) => `            <cbc:Note>${escapeXml(note)}</cbc:Note>`)
    .join("\n");
}

function getProfileId(profile: string) {
  return ["TEMELFATURA", "TICARIFATURA", "EARSIVFATURA"].includes(profile)
    ? profile
    : "TICARIFATURA";
}

function buildInvoiceInfoXml(input: {
  group: UttsRow[];
  groupIndex: number;
  invoiceDate: string;
  profileId: string;
  recipientTaxNumber: string;
  settings: UyumsoftSettings;
}) {
  const buyerRow = input.group[0];
  const buyer = splitBuyerName(buyerRow);
  const buyerTaxNumber =
    input.recipientTaxNumber.replace(/\D/g, "") || getTaxNumber(buyerRow);
  const sellerTaxNumber = (input.settings.vknTckn || "").replace(/\D/g, "");
  const sellerName = getSellerName(input.settings);
  const { issueDate, issueTime } = getIssueDateTime(input.invoiceDate);
  const uuid = randomUUID();
  const localDocumentId = `UTTS-${issueDate.replace(/\D/g, "")}-${input.groupIndex + 1}`;
  const profileId = getProfileId(input.profileId);
  const lineTotal = input.group.reduce((sum, row) => sum + getUnitPrice(row), 0);
  const taxTotal = lineTotal * (DEFAULT_VAT_RATE / 100);
  const payableTotal = lineTotal + taxTotal;
  const invoiceLines = input.group
    .map((row, index) => buildInvoiceLineXml(row, index))
    .join("\n");
  const invoiceNotes = buildInvoiceNotesXml(input.group);

  const sellerParty = buildPartyXml({
    taxNumber: sellerTaxNumber,
    title: sellerName,
  });
  const buyerParty = buildPartyXml({
    taxNumber: buyerTaxNumber,
    title: buyer.name,
    surname: buyer.surname,
    taxOffice: getTaxOffice(buyerRow),
    city: getCity(buyerRow),
    district: getDistrict(buyerRow),
    address: getAddress(buyerRow),
    email: getEmail(buyerRow),
    phone: getPhone(buyerRow),
  });

  return `        <InvoiceInfo LocalDocumentId="${escapeXml(localDocumentId)}" ExtraInformation="UTTS">
          <Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
            <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
            <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
            <cbc:ProfileID>${profileId}</cbc:ProfileID>
            <cbc:ID/>
            <cbc:UUID>${uuid}</cbc:UUID>
            <cbc:IssueDate>${issueDate}</cbc:IssueDate>
            <cbc:IssueTime>${issueTime}</cbc:IssueTime>
            <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
${invoiceNotes}
            <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
            <cbc:LineCountNumeric>${input.group.length}</cbc:LineCountNumeric>
            <cac:AccountingSupplierParty>
              ${sellerParty}
            </cac:AccountingSupplierParty>
            <cac:AccountingCustomerParty>
              ${buyerParty}
            </cac:AccountingCustomerParty>
            <cac:TaxTotal>
              <cbc:TaxAmount currencyID="TRY">${formatAmount(taxTotal)}</cbc:TaxAmount>
              <cac:TaxSubtotal>
                <cbc:TaxableAmount currencyID="TRY">${formatAmount(lineTotal)}</cbc:TaxableAmount>
                <cbc:TaxAmount currencyID="TRY">${formatAmount(taxTotal)}</cbc:TaxAmount>
                <cbc:Percent>${DEFAULT_VAT_RATE}</cbc:Percent>
                <cac:TaxCategory>
                  <cac:TaxScheme>
                    <cbc:Name>KDV</cbc:Name>
                    <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
                  </cac:TaxScheme>
                </cac:TaxCategory>
              </cac:TaxSubtotal>
            </cac:TaxTotal>
            <cac:LegalMonetaryTotal>
              <cbc:LineExtensionAmount currencyID="TRY">${formatAmount(lineTotal)}</cbc:LineExtensionAmount>
              <cbc:TaxExclusiveAmount currencyID="TRY">${formatAmount(lineTotal)}</cbc:TaxExclusiveAmount>
              <cbc:TaxInclusiveAmount currencyID="TRY">${formatAmount(payableTotal)}</cbc:TaxInclusiveAmount>
              <cbc:AllowanceTotalAmount currencyID="TRY">0.00</cbc:AllowanceTotalAmount>
              <cbc:PayableAmount currencyID="TRY">${formatAmount(payableTotal)}</cbc:PayableAmount>
            </cac:LegalMonetaryTotal>
            ${invoiceLines}
          </Invoice>
          <TargetCustomer VknTckn="${escapeXml(buyerTaxNumber)}" Title="${escapeXml(
            `${buyer.name} ${buyer.surname}`.trim()
          )}"/>
          <Scenario>Automated</Scenario>
          <CreateDateUtc>${new Date().toISOString()}</CreateDateUtc>
        </InvoiceInfo>`;
}

function getDraftIssues(rows: UttsRow[], settings: UyumsoftSettings) {
  const issues: string[] = [];
  const sellerTaxNumber = (settings.vknTckn || "").replace(/\D/g, "");

  if (!/^\d{10,11}$/.test(sellerTaxNumber)) {
    issues.push("Uyumsoft ayarlarında satıcı VKN/TCKN 10 veya 11 haneli olmalı");
  }

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const buyerTaxNumber = getTaxNumber(row);
    const buyer = splitBuyerName(row);

    if (!/^\d{10,11}$/.test(buyerTaxNumber)) {
      issues.push(`${rowNo}. satırda alıcı VKN/TCKN eksik veya hatalı`);
    }
    if (!buyer.name) issues.push(`${rowNo}. satırda alıcı adı/ünvanı eksik`);
    if (buyerTaxNumber.length === 11 && !buyer.surname) {
      issues.push(`${rowNo}. satırda şahıs alıcı soyadı eksik`);
    }
    if (!getCity(row)) issues.push(`${rowNo}. satırda şehir eksik`);
    if (!getDistrict(row)) issues.push(`${rowNo}. satırda ilçe eksik`);
    if (!getAddress(row)) issues.push(`${rowNo}. satırda adres eksik`);
    if (!getTaxOffice(row)) issues.push(`${rowNo}. satırda vergi dairesi eksik`);
    if (!getUnitPrice(row)) issues.push(`${rowNo}. satırda birim fiyat eksik`);
  });

  return Array.from(new Set(issues));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? (body.rows as UttsRow[]) : [];
    const invoiceDate = String(
      body.invoiceDate || new Date().toISOString().slice(0, 10)
    );
    const profile = String(body.profile || "TICARIFATURA");
    const mergeByBuyer = Boolean(body.mergeByBuyer);
    const dryRun = Boolean(body.dryRun);
    const settings = getSettings();

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Taslak oluşturmak için uygun fatura adayı yok" },
        { status: 400 }
      );
    }

    const issues = getDraftIssues(rows, settings);
    if (issues.length > 0) {
      return NextResponse.json(
        { error: "Taslak oluşturulmadan önce eksik alanlar tamamlanmalı", issues },
        { status: 400 }
      );
    }

    const groups = buildGroups(rows, mergeByBuyer);

    // Kullanıcının e-fatura tercihi (TEMEL/TICARI); kayıtlı olmayan alıcılar
    // mecburen E-Arşiv'e yönlendirilir.
    const eInvoiceProfile = profile === "TEMELFATURA" ? "TEMELFATURA" : "TICARIFATURA";
    const routingCache = new Map<string, UyumsoftEInvoiceUserResult>();

    // Yalnızca hem VKN hem TCKN'si olan gruplar için sorgu yapıyoruz; bu
    // kayıtlarda faturaya hangi numarayı yazacağımıza biz karar veririz.
    // Tek numaralı kayıtlarda seçim yok; numarayı gönderir, Uyumsoft'un
    // E-Fatura/E-Arşiv'i otomatik belirlemesine bırakırız.
    const groupPairs = groups.map((group) => getVknTcknPair(group[0]));
    const dualIndexes = groups
      .map((_, index) => index)
      .filter((index) => groupPairs[index].vkn && groupPairs[index].tckn);

    // Sorgular sırayla yapılırsa yavaş; sınırlı eşzamanlılıkla paralel çözüyoruz.
    const routings = new Array<
      Awaited<ReturnType<typeof resolveEInvoiceRouting>> | undefined
    >(groups.length);
    const CONCURRENCY = 10;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, dualIndexes.length) }, async () => {
        while (cursor < dualIndexes.length) {
          const index = dualIndexes[cursor++];
          routings[index] = await resolveEInvoiceRouting(
            settings,
            groupPairs[index],
            routingCache
          );
        }
      })
    );

    const invoiceInfoXml = groups
      .map((group, groupIndex) => {
        const routing = routings[groupIndex];
        const pair = groupPairs[groupIndex];
        return buildInvoiceInfoXml({
          group,
          groupIndex,
          invoiceDate,
          profileId: routing
            ? routing.isEInvoice
              ? eInvoiceProfile
              : "EARSIVFATURA"
            : profile,
          recipientTaxNumber: routing
            ? routing.taxNumber
            : pair.vkn || pair.tckn || getTaxNumber(group[0]),
          settings,
        });
      })
      .join("\n");

    if (dryRun) {
      return NextResponse.json({
        success: true,
        draftCount: groups.length,
        lineCount: rows.length,
      });
    }

    const result = await saveUyumsoftDrafts(settings, invoiceInfoXml);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.message,
          rawResponse: result.rawResponse,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      drafts: result.drafts,
      draftCount: result.drafts.length || groups.length,
      lineCount: rows.length,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Uyumsoft taslak oluşturma sırasında hata oluştu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
