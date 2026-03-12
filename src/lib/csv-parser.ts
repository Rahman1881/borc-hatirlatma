import * as XLSX from "xlsx";

export interface CustomerRow {
  code: string;
  filoCode: string;
  name: string;
  filoGroup: string;
  totalDebt: number;
  overdueDebt: number;
  creditLimit: number;
  fuelAccess: string;
  phone: string;
  email: string;
  city: string;
  district: string;
}

function parseTurkishNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  // Remove "TL", spaces, "%" signs
  let cleaned = String(value).replace(/TL/gi, "").replace(/%/g, "").trim();
  if (!cleaned) return 0;
  // Turkish format: 1.234,56 -> 1234.56
  cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function normalizePhone(phone: string | number | null | undefined): string {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.substring(1);
  if (digits.length === 10) digits = "90" + digits;
  if (!digits.startsWith("90") && digits.length === 10) digits = "90" + digits;
  return digits;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

// Column name mapping (xlsx headers -> our fields)
// Supports both proper Turkish and broken encoding variants
const HEADER_MAP = new Map<string, string>([
  ["Kod Adı", "code"],
  ["Kod Ad?", "code"],
  ["Filo Kodu", "filoCode"],
  ["Filo Adı", "name"],
  ["Filo Ad?", "name"],
  ["Filo Grupları", "filoGroup"],
  ["Filo Gruplar?", "filoGroup"],
  ["Toplam Borç", "totalDebt"],
  ["Vadesi Gelmiş Borç", "overdueDebt"],
  ["Aktif Toplam Limit", "creditLimit"],
  ["Yakıt Alımı", "fuelAccess"],
  ["Yak?t Al?m?", "fuelAccess"],
  ["Adres Telefon", "phone"],
  ["Kullanıcı Email", "email"],
  ["Kullan?c? Email", "email"],
  ["Adres Email", "emailAlt"],
  ["İl", "city"],
  ["İlçe", "district"],
]);

export function parseXLSX(buffer: Buffer): CustomerRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  const rows: CustomerRow[] = [];

  for (const raw of rawRows) {
    // Build a mapped row using header map
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = HEADER_MAP.get(key);
      if (field) mapped[field] = value;
    }

    const name = str(mapped.name);
    if (!name) continue;

    rows.push({
      code: str(mapped.code),
      filoCode: str(mapped.filoCode),
      name,
      filoGroup: str(mapped.filoGroup),
      totalDebt: parseTurkishNumber(mapped.totalDebt as string | number),
      overdueDebt: parseTurkishNumber(mapped.overdueDebt as string | number),
      creditLimit: parseTurkishNumber(mapped.creditLimit as string | number),
      fuelAccess: str(mapped.fuelAccess),
      phone: normalizePhone(mapped.phone as string),
      email: str(mapped.email) || str(mapped.emailAlt),
      city: str(mapped.city),
      district: str(mapped.district),
    });
  }

  return rows;
}

export function parseCSV(content: string): CustomerRow[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rows: CustomerRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    if (cols.length < 65) continue;

    const name = cols[3]?.trim();
    const phone = normalizePhone(cols[58]?.trim() || "");
    const totalDebt = parseTurkishNumber(cols[10]);
    const overdueDebt = parseTurkishNumber(cols[14]);

    if (!name) continue;

    rows.push({
      code: cols[0]?.trim() || "",
      filoCode: cols[1]?.trim() || "",
      name,
      filoGroup: cols[8]?.trim() || "",
      totalDebt,
      overdueDebt,
      creditLimit: parseTurkishNumber(cols[13]),
      fuelAccess: cols[22]?.trim() || "",
      phone,
      email: cols[52]?.trim() || cols[46]?.trim() || "",
      city: cols[63]?.trim() || "",
      district: cols[64]?.trim() || "",
    });
  }

  return rows;
}
