import { NextRequest, NextResponse } from "next/server";
import { fleetGroupMap, getFleetDetail } from "@/lib/yakit-ofisi";

// Müşteri penceresi için tek filonun bilgileri (yalnız okuma). TC kimlik no gibi alanlar
// tarayıcıya gönderilmez; yalnız ekranda gösterilenler seçilir.

const FLEET_FIELDS = [
  "id", "code", "codeName", "name", "customName", "openState", "fuelAllowance", "fleetType", "petrolType",
  "paymentMethod", "limitBehaviour", "termDay", "termType", "discount", "totalLimit", "remainingLimit",
  "totalDebtDiscounted", "totalDebtDiscountedReadyToPay", "totalDebtDiscountedDueBeforeToday",
  "totalDebtDiscountedPastDue", "totalRisk", "monthlyPurchase", "averagePaymentTermDays",
  "averagePaymentDelayDays", "firstFuelPurchaseDate", "lastFuelPurchaseDate", "createdOn",
  "addressPhone", "addressEmail", "city", "district", "note",
];
const ADDRESS_FIELDS = [
  "companyName", "personName", "personSurname", "taxNumber", "taxOfficeName", "cityName", "subdivisionName",
  "district", "streetName", "buildingName", "buildingNumber", "postalCode", "phoneNumber", "email", "electronicBill",
];

const pick = (o: Record<string, unknown> | null, keys: string[]) =>
  o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : null;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fleetId = Number(id);
  if (!Number.isInteger(fleetId) || fleetId <= 0) {
    return NextResponse.json({ error: "Geçersiz müşteri." }, { status: 400 });
  }
  try {
    const { fleet, address } = await getFleetDetail(fleetId, req.nextUrl.searchParams.get("fresh") === "1");
    let groups: string[] | null = null;
    try {
      groups = (await fleetGroupMap()).get(fleetId) ?? [];
    } catch {
      groups = null;
    }
    return NextResponse.json({ fleet: pick(fleet, FLEET_FIELDS), address: pick(address, ADDRESS_FIELDS), groups });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Müşteri bilgisi alınamadı." }, { status: 502 });
  }
}
