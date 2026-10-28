"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Mail, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ErrorNote, daysSince, fmtDate, fmtNum, fmtTL } from "./shared";

// Müşteri penceresi: listelerde satıra tıklayınca Yakıt Ofisi'ndeki filo bilgileri (yalnız okuma).

type Fleet = {
  id: number;
  code?: string | null;
  codeName?: string | null;
  name?: string | null;
  customName?: string | null;
  openState?: number | string;
  fuelAllowance?: boolean;
  paymentMethod?: number;
  termDay?: number | null;
  termType?: number | string;
  discount?: number;
  totalLimit?: number;
  remainingLimit?: number;
  totalDebtDiscounted?: number;
  totalDebtDiscountedDueBeforeToday?: number;
  totalDebtDiscountedPastDue?: number;
  totalRisk?: number;
  monthlyPurchase?: number;
  averagePaymentDelayDays?: number | null;
  firstFuelPurchaseDate?: string | null;
  lastFuelPurchaseDate?: string | null;
  createdOn?: string | null;
  addressPhone?: string | null;
  addressEmail?: string | null;
  city?: string | null;
  district?: string | null;
  note?: string | null;
};

type Address = {
  companyName?: string | null;
  personName?: string | null;
  personSurname?: string | null;
  taxNumber?: string | null;
  taxOfficeName?: string | null;
  cityName?: string | null;
  subdivisionName?: string | null;
  district?: string | null;
  streetName?: string | null;
  buildingName?: string | null;
  buildingNumber?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  electronicBill?: boolean;
};

const PAYMENT_METHODS: [number, string][] = [
  [1, "Havale/EFT"],
  [2, "Nakit"],
  [4, "Çek"],
  [8, "Kredi kartı"],
  [16, "Vadeli"],
  [32, "Yalnız limit"],
  [64, "Ön ödeme"],
  [128, "DBS"],
  [1024, "Ön provizyon"],
  [2048, "Teminat mektubu"],
  [4096, "Bakiye yükleme"],
];

const paymentText = (v?: number) =>
  v ? PAYMENT_METHODS.filter(([bit]) => (v & bit) === bit).map(([, t]) => t).join(", ") || String(v) : "—";

const termText = (f: Fleet) => {
  if (f.termDay == null) return "—";
  const afterInvoice = f.termType === 1 || f.termType === "AfterInvoice";
  return afterInvoice ? `Faturadan ${f.termDay} gün sonra` : `Ay kapanışından ${f.termDay} gün sonra`;
};

const isOpen = (v: Fleet["openState"]) => v === 1 || v === "Open";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="divide-y rounded-lg border px-3">{children}</div>
    </div>
  );
}

export function FleetDialog({ fleetId, onClose }: { fleetId: number | null; onClose: () => void }) {
  // Sonuç hangi müşteriye aitse onunla saklanır; başka müşteri açılınca eskisi gösterilmez.
  const [loaded, setLoaded] = useState<{
    id: number;
    data?: { fleet: Fleet; address: Address | null; groups: string[] | null };
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!fleetId) return;
    let cancelled = false;
    fetch(`/api/yakit-ofisi/fleet/${fleetId}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Müşteri bilgisi alınamadı.");
        if (!cancelled) setLoaded({ id: fleetId, data: json });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: fleetId, error: err instanceof Error ? err.message : "Müşteri bilgisi alınamadı." });
      });
    return () => {
      cancelled = true;
    };
  }, [fleetId]);

  const current = loaded && loaded.id === fleetId ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  const f = data?.fleet;
  const a = data?.address;
  const title = f ? f.customName || f.name || f.code || "Müşteri" : "Müşteri";
  const idle = daysSince(f?.lastFuelPurchaseDate);
  const notDue = f ? (f.totalDebtDiscounted ?? 0) - (f.totalDebtDiscountedDueBeforeToday ?? 0) : 0;
  const phone = f?.addressPhone || a?.phoneNumber;
  const email = f?.addressEmail || a?.email;
  const street = a && [a.streetName, a.buildingName, a.buildingNumber].filter(Boolean).join(" ");
  const place = [a?.district || a?.subdivisionName || f?.district, a?.cityName || f?.city].filter(Boolean).join(" / ");

  return (
    <Dialog open={fleetId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>
            {f ? (
              <span className="flex flex-wrap items-center gap-2">
                {[f.codeName, f.code && `Cari ${f.code}`].filter(Boolean).join(" · ")}
                <Badge variant={isOpen(f.openState) ? "secondary" : "destructive"}>
                  {isOpen(f.openState) ? "Açık" : "Kapalı"}
                </Badge>
                {f.fuelAllowance === false && <Badge variant="destructive">Alım kapalı</Badge>}
                {data?.groups?.map((g) => (
                  <Badge key={g} variant="outline">
                    {g}
                  </Badge>
                ))}
              </span>
            ) : (
              "Yakıt Ofisi'nden okunuyor…"
            )}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorNote message={error} />}
        {!f && !error && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}

        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Group title="Borç ve limit">
              <Row label="Toplam borç">{fmtTL(f.totalDebtDiscounted)}</Row>
              <Row label="Vadesi geçen">
                <span className={f.totalDebtDiscountedDueBeforeToday ? "text-destructive" : ""}>
                  {fmtTL(f.totalDebtDiscountedDueBeforeToday)}
                </span>
              </Row>
              <Row label="Gecikme sınırını aşan">{fmtTL(f.totalDebtDiscountedPastDue)}</Row>
              <Row label="Vadesi gelmemiş">{fmtTL(notDue)}</Row>
              <Row label="Toplam limit">{fmtTL(f.totalLimit)}</Row>
              <Row label="Kalan limit">{fmtTL(f.remainingLimit)}</Row>
              <Row label="Toplam risk">{fmtTL(f.totalRisk)}</Row>
            </Group>

            <Group title="Alım ve ödeme">
              <Row label="Aylık alım">{fmtTL(f.monthlyPurchase)}</Row>
              <Row label="Son alım">
                {fmtDate(f.lastFuelPurchaseDate, true)}
                {idle != null && idle > 0 && <span className="text-muted-foreground font-normal"> · {idle} gün önce</span>}
              </Row>
              <Row label="İlk alım">{fmtDate(f.firstFuelPurchaseDate)}</Row>
              <Row label="Vade">{termText(f)}</Row>
              <Row label="Ödeme yöntemi">{paymentText(f.paymentMethod)}</Row>
              <Row label="Ort. ödeme gecikmesi">
                {f.averagePaymentDelayDays != null ? `${fmtNum(f.averagePaymentDelayDays, 1)} gün` : "—"}
              </Row>
              <Row label="İskonto">{f.discount ? `%${fmtNum(f.discount, 2)}` : "—"}</Row>
            </Group>

            <Group title="İletişim">
              <Row label="Telefon">
                {phone ? (
                  <a href={`tel:${phone}`} className="inline-flex items-center gap-1 underline">
                    <Phone className="h-3.5 w-3.5" />
                    {phone}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="E-posta">
                {email ? (
                  <a href={`mailto:${email}`} className="inline-flex items-center gap-1 underline break-all">
                    <Mail className="h-3.5 w-3.5" />
                    {email}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Adres">{[street, place].filter(Boolean).join(", ") || "—"}</Row>
            </Group>

            <Group title="Fatura">
              <Row label="Ünvan">
                {a?.companyName || [a?.personName, a?.personSurname].filter(Boolean).join(" ") || "—"}
              </Row>
              <Row label="Vergi no">{a?.taxNumber || "—"}</Row>
              <Row label="Vergi dairesi">{a?.taxOfficeName || "—"}</Row>
              <Row label="E-fatura">{a ? (a.electronicBill ? "Evet" : "Hayır") : "—"}</Row>
              <Row label="Müşteri olduğu tarih">{fmtDate(f.createdOn)}</Row>
            </Group>

            {f.note && (
              <div className="sm:col-span-2 rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                <span className="font-medium">Not: </span>
                {f.note}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
