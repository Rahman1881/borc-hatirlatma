import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type UttsRow = Record<string, unknown>;
type ExcelCell = string | number | Date;

const DEFAULT_VAT_RATE = 20;
const UYUMSOFT_UTTS_NOTE =
  "Açıklama:UTTS Kapsamında Düzenlenen Yetkilendirilmiş Firma Taşıt Montaj Faturasıdır.Fatura Tahsilatı  DARPANE VE DAMGA MATBAASI GENEL MÜDÜRĞÜ nce yapılmıştır.Sevk Yeri ÖÇİFTÇİ ÇARKPETROL SANAYİ TİCARET LİMİTED ŞİRKETİ - CUMHURİYET MAHALLESİ FARABİ CADDESİ NO :8 ADAPAZARI/SAKARYA TÜRKİYE";

const UYUMSOFT_HEADERS = [
  "Id",
  "Fatura Numarası",
  "ETTN",
  "Fatura Tarihi",
  "Fatura Saati",
  "Fatura Tipi",
  "Fatura Profili",
  "e-Arşiv İhracat Mı?",
  "Not1",
  "Not2",
  "Not3",
  "Not4",
  "Döviz Kodu",
  "Döviz Kuru",
  "İade Tarihi",
  "İade Fatura Numarası",
  "Sipariş Tarihi",
  "Sipariş Numarası",
  "İrsaliye Numarası",
  "İrsaliye Tarihi",
  "Alıcı VKN/TCKN",
  "Alıcı Ünvan/Adı | Yabancı Alıcı Ünvan/Adı | Turist Adı",
  "Alıcı Soyadı | Yabancı Alıcı Soyadı | Turist Soyadı ",
  "Alıcı Ülke | Yabancı Ülke | Turist Ülke",
  "Alıcı Şehir | Yabancı Şehir | Turist Şehir",
  "Alıcı İlçe | Yabancı İlçe | Turist İlçe",
  "Alıcı Sokak | Yabancı Sokak | Turist Sokak",
  "Alıcı Bina No | Yabancı Bina No | Turist Bina No",
  "Alıcı Kapı No | Yabancı Kapı No | Turist Kapı No",
  "Alıcı Eposta | Yabancı Eposta | Turist Eposta",
  "Alıcı Telefon | Yabancı Telefon | Turist Telefon",
  "Alıcı Vergi Dairesi",
  "Alıcı Posta Kutusu",
  "Yabancı Alıcı Ülkesindeki VKN",
  "Yabancı Alıcı Resmi Ünvan",
  "Turist Ülke Kodu",
  "Turist Pasaport No",
  "Pasaport Veriliş Tarihi",
  "Aracı Kurum Posta Kutusu",
  "Aracı Kurum VKN",
  "Aracı Kurum Adı",
  "Gönderim Türü",
  "Satışın Yapıldığı Web Sitesi",
  "Ödeme Tarihi",
  "Ödeme Türü",
  "Ödeyen Adı",
  "Taşıyıcı Ünvanı",
  "Taşıyıcı Tckn/Vkn",
  "Gönderim Tarihi",
  "Mal/Hizmet Adı",
  "Miktar",
  "Birim Kodu",
  "Birim Fiyat",
  "KDV Oranı",
  "KDV Muafiyet Kodu",
  "KDV Muafiyet Nedeni",
  "İskonto Oranı",
  "İskonto Açıklaması",
  "İskonto Oranı 2",
  "İskonto Açıklaması 2",
  "Satıcı Kodu (SellersItemIdentification)",
  "Alıcı Kodu (BuyersItemIdentification)",
  "Üretici Kodu (ManufacturersItemIdentification)",
  "Marka (BrandName)",
  "Model (ModelName)",
  "Menşei Kodu",
  "Mal/Hizmet İrsaliye Numarası",
  "Mal/Hizmet İrsaliye Tarihi",
  "Mal/Hizmet Sipariş Numarası ",
  "Mal/Hizmet Sipariş Tarihi ",
  "Açıklama (Description)",
  "Not (Note)",
  "Artırım Oranı",
  "Artırım Tutarı",
  "ÖTV Kodu",
  "ÖTV Oranı",
  "ÖTV Tutarı",
  "Tevkifat Kodu",
  "Tevkifat Oranı",
  "BSMV Oranı",
  "Enerji Fonu Vergi Oranı",
  "TRT Payı Vergi Oranı",
  "Elektrik ve Havagazı Tüketim Vergisi Oranı",
  "Konaklama Vergisi Oranı",
  "GTip No",
  "Teslim Şartı",
  "Gönderilme Şekli",
  "Gümrük Takip No",
  "Bulunduğu Kabın Markası",
  "Bulunduğu Kabın Cinsi",
  "Bulunduğu Kabın Numarası",
  "Bulunduğu Kabın Adedi",
  "İhracat Teslim ve Ödeme Yeri/Ülke",
  "İhracat Teslim ve Ödeme Yeri/Şehir",
  "İhracat Teslim ve Ödeme Yeri/Mahalle/İlçe",
  "Künye No",
  "Mal Sahibi Ad/Soyad/Ünvan",
  "Mal Sahibi Vkn/Tckn",
  "Mal Kalemi Brüt Kilogram",
  "Mal Kalemi Net Kilogram",
  "Fatura Teslim ve Ödeme Yeri/Ülke",
  "Fatura Teslim ve Ödeme Yeri/Şehir",
  "Fatura Teslim ve Ödeme Yeri/Mahalle/İlçe",
  "Fatura Teslim ve Ödeme Yeri/Kasaba/Köy",
  "Fatura Teslim ve Ödeme Yeri/Cadde/Sokak",
  "Fatura Teslim ve Ödeme Yeri/Posta Kodu",
  "Fatura Teslim ve Ödeme Yeri/Bina Adı",
  "Fatura Teslim ve Ödeme Yeri/Bina No",
  "Fatura Teslim ve Ödeme Yeri/Kapı No",
  "Fatura Teslim ve Ödeme Yeri/Teslim Şartı",
  "Fatura Teslim ve Ödeme Yeri/Gönderilme Şekli",
  "Toplam Kap Adedi",
  "Toplam Brüt Kilogram",
  "Toplam Net Kilogram",
  "GTIN No",
  "Parti Numarası",
  "Sıra Numarası",
  "Son Kullanma Tarihi",
  "UNO (Ürün Numarası)",
  "LNO (Lot/Batch Numarası)",
  "SNO (Seri/Sıra Numarası)",
  "URT (Üretim Tarihi)",
  "Teknolojik Cihaz Desteği",
  "IMEI1",
  "IMEI2",
  "IMEI3",
  "IMEI4",
];

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

function getTaxNumber(row: UttsRow) {
  return getFirstText(row, [
    "invoiceTaxNumber",
    "taxInfoNumber",
    "identificationNumberForInvoice",
    "vknTckn",
    "taxNumber",
    "identityNumber",
    "customerTaxNumber",
    "customerIdentityNumber",
  ]).replace(/\D/g, "");
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
    "invoiceEmail",
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
  return getFirstText(row, [
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
  ]);
}

function getPlate(row: UttsRow) {
  return getFirstText(row, ["licensePlate", "plate", "vehiclePlate"]);
}

function getExcelDate(value: string) {
  if (!value) return "";
  const datePart = value.split("T")[0].split(" ")[0];
  const dotted = datePart.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const normalized = dotted
    ? `${dotted[3]}-${dotted[2]}-${dotted[1]}`
    : datePart.slice(0, 10);
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return `${normalized} 00:00:00`;
  return new Date(year, month - 1, day);
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

function buildExportGroups(inputRows: UttsRow[], mergeByBuyer: boolean) {
  if (!mergeByBuyer) {
    return inputRows.map((row) => ({ buyerRow: row, itemRows: [row] }));
  }

  const groups = new Map<string, { buyerRow: UttsRow; itemRows: UttsRow[] }>();

  inputRows.forEach((row, index) => {
    const taxNumber = getTaxNumber(row);
    const key = /^\d{10,11}$/.test(taxNumber)
      ? `tax-${taxNumber}`
      : `single-${index}`;
    const current = groups.get(key);

    if (current) {
      current.itemRows.push(row);
    } else {
      groups.set(key, { buyerRow: row, itemRows: [row] });
    }
  });

  return Array.from(groups.values());
}

function buildExcelRows(
  inputRows: UttsRow[],
  invoiceDate: string,
  profile: string,
  mergeByBuyer: boolean
) {
  const rows: Record<string, ExcelCell>[] = [];
  const groups = buildExportGroups(inputRows, mergeByBuyer);

  groups.forEach((group, groupIndex) => {
    const buyer = splitBuyerName(group.buyerRow);

    group.itemRows.forEach((row) => {
      const record: Record<string, ExcelCell> = {};
      for (const header of UYUMSOFT_HEADERS) record[header] = "";

      const productName = getProductName(row);

      record["Id"] = groupIndex + 1;
      record["Fatura Tarihi"] = getExcelDate(invoiceDate);
      record["Fatura Saati"] = 0;
      record["Fatura Tipi"] = "SATIS";
      record["Fatura Profili"] = profile;
      record["Not1"] = UYUMSOFT_UTTS_NOTE;
      record["Not2"] = getPlate(row);
      record["Not3"] = getText(row, "installationCode");
      record["Not4"] = productName;
      record["Döviz Kodu"] = "TRY";
      record["Alıcı VKN/TCKN"] = getTaxNumber(group.buyerRow);
      record["Alıcı Ünvan/Adı | Yabancı Alıcı Ünvan/Adı | Turist Adı"] =
        buyer.name;
      record["Alıcı Soyadı | Yabancı Alıcı Soyadı | Turist Soyadı "] =
        buyer.surname;
      record["Alıcı Ülke | Yabancı Ülke | Turist Ülke"] = "Türkiye";
      record["Alıcı Şehir | Yabancı Şehir | Turist Şehir"] =
        getCity(group.buyerRow);
      record["Alıcı İlçe | Yabancı İlçe | Turist İlçe"] =
        getDistrict(group.buyerRow);
      record["Alıcı Sokak | Yabancı Sokak | Turist Sokak"] =
        getAddress(group.buyerRow);
      record["Alıcı Eposta | Yabancı Eposta | Turist Eposta"] =
        getEmail(group.buyerRow);
      record["Alıcı Telefon | Yabancı Telefon | Turist Telefon"] =
        getPhone(group.buyerRow);
      record["Alıcı Vergi Dairesi"] = getTaxOffice(group.buyerRow);
      record["Mal/Hizmet Adı"] = productName;
      record["Miktar"] = 1;
      record["Birim Kodu"] = "ADET";
      record["Birim Fiyat"] = getUnitPrice(row);
      record["KDV Oranı"] = DEFAULT_VAT_RATE;

      rows.push(record);
    });
  });

  return rows;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rows = Array.isArray(body.rows) ? (body.rows as UttsRow[]) : [];
  const invoiceDate = String(body.invoiceDate || new Date().toISOString().slice(0, 10));
  const profile = String(body.profile || "TICARIFATURA");
  const mergeByBuyer = Boolean(body.mergeByBuyer);
  const excelRows = buildExcelRows(rows, invoiceDate, profile, mergeByBuyer);

  if (excelRows.length === 0) {
    return NextResponse.json(
      { error: "Excel oluşturmak için uygun fatura adayı bulunamadı" },
      { status: 400 }
    );
  }

  const worksheet = XLSX.utils.json_to_sheet(excelRows, {
    header: UYUMSOFT_HEADERS,
    skipHeader: false,
    cellDates: true,
  });
  const dateColumn = UYUMSOFT_HEADERS.indexOf("Fatura Tarihi");
  if (dateColumn >= 0) {
    for (let rowIndex = 2; rowIndex <= excelRows.length + 1; rowIndex++) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex - 1, c: dateColumn });
      const cell = worksheet[cellAddress];
      if (cell) cell.z = "yyyy-mm-dd hh:mm:ss";
    }
  }
  const timeColumn = UYUMSOFT_HEADERS.indexOf("Fatura Saati");
  if (timeColumn >= 0) {
    for (let rowIndex = 2; rowIndex <= excelRows.length + 1; rowIndex++) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex - 1, c: timeColumn });
      const cell = worksheet[cellAddress];
      if (cell) cell.z = "hh:mm:ss";
    }
  }
  worksheet["!cols"] = UYUMSOFT_HEADERS.map((header) => ({
    wch: Math.min(Math.max(header.length + 2, 12), 34),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    cellDates: true,
  }) as Buffer;
  const responseBody = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const fileName = `uyumsoft-fatura-${invoiceDate}.xlsx`;

  return new NextResponse(responseBody, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
