"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { EInvoiceRouting } from "@/lib/uyumsoft";

type UttsRow = Record<string, unknown>;

const PAGE_SIZE = 25;
const API_PAGE_SIZE = 500;
const MAX_API_PAGES = 20;
const DEFAULT_VAT_RATE = 20;

const statusLabels: Record<string, string> = {
  "5": "Fiziksel Montaj Tamamlandı",
  "6": "Fotoğraf Yüklendi, Aktivasyon Bekliyor",
  "7": "Otp Gönderildi",
  "8": "Otp Onaylandı",
  "10": "Aktivasyon Tamamlandı",
  "20": "Yenisiyle Değiştirildi",
};

interface InvoiceCandidate {
  key: string;
  exportRows: UttsRow[];
  itemCount: number;
  grouped: boolean;
  buyerName: string;
  buyerSurname: string;
  buyerType: "company" | "person" | "unknown";
  taxNumber: string;
  sourceTaxNumber: string;
  plate: string;
  referenceNumber: string;
  productName: string;
  unitPrice: number;
  vatAmount: number;
  grossTotal: number;
  issues: string[];
  warnings: string[];
  overrideApplied: boolean;
  row: UttsRow;
}

interface InvoiceBuyerOverride {
  sourceTaxNumber: string;
  taxNumber: string;
  buyerType: "company" | "person";
  buyerName: string;
  buyerSurname: string;
  taxOffice: string;
  city: string;
  district: string;
  address: string;
  email: string;
  phone: string;
}

type InvoiceEditForm = InvoiceBuyerOverride;

const emptyEditForm: InvoiceEditForm = {
  sourceTaxNumber: "",
  taxNumber: "",
  buyerType: "company",
  buyerName: "",
  buyerSurname: "",
  taxOffice: "",
  city: "",
  district: "",
  address: "",
  email: "",
  phone: "",
};

function today() {
  return new Date().toISOString().slice(0, 10);
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

function formatMoney(amount: number) {
  return amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeDate(value: string) {
  if (!value) return "";
  const datePart = value.split("T")[0].split(" ")[0];
  const dotted = datePart.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  return datePart.slice(0, 10);
}

function getRowDate(row: UttsRow) {
  return normalizeDate(
    getText(row, "activationDateString") ||
      getText(row, "firstActivationDate") ||
      getText(row, "lastActivationDate") ||
      getText(row, "installmentDateString")
  );
}

function filterRowsByDate(rows: UttsRow[], startDate: string, endDate: string) {
  return rows.filter((row) => {
    const rowDate = getRowDate(row);
    if (!rowDate) return false;
    if (startDate && rowDate < startDate) return false;
    if (endDate && rowDate > endDate) return false;
    return true;
  });
}

function extractRows(data: unknown): UttsRow[] {
  if (Array.isArray(data)) {
    return data.filter(
      (item) => item && typeof item === "object"
    ) as UttsRow[];
  }
  if (!data || typeof data !== "object") return [];

  const record = data as Record<string, unknown>;
  const candidateKeys = [
    "items",
    "data",
    "result",
    "results",
    "records",
    "installationProgresses",
    "installationProgressList",
  ];

  for (const key of candidateKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item) => item && typeof item === "object"
      ) as UttsRow[];
    }
  }

  for (const value of Object.values(record)) {
    const rows = extractRows(value);
    if (rows.length > 0) return rows;
  }

  return [];
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

function getSourceTaxNumber(row: UttsRow) {
  return getFirstText(row, [
    "taxInfoNumber",
    "identificationNumberForInvoice",
    "vknTckn",
    "taxNumber",
    "identityNumber",
    "customerTaxNumber",
    "customerIdentityNumber",
  ]).replace(/\D/g, "");
}

// Bir adayda VKN (10 hane) ve TCKN (11 hane) ayrı alanlarda gelebilir; ikisini
// de toplayıp mükellef sorgusunda önce VKN sonra TCKN denenebilsin diye ayırır.
function getVknTcknPair(row: UttsRow): { vkn: string; tckn: string } {
  const keys = [
    "invoiceTaxNumber",
    "taxInfoNumber",
    "identificationNumberForInvoice",
    "vknTckn",
    "taxNumber",
    "identityNumber",
    "customerTaxNumber",
    "customerIdentityNumber",
  ];
  let vkn = "";
  let tckn = "";
  for (const key of keys) {
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

function getBuyerType(row: UttsRow): InvoiceCandidate["buyerType"] {
  const manualType = getText(row, "invoiceBuyerType");
  if (manualType === "company" || manualType === "person") return manualType;

  const taxNumber = getTaxNumber(row);
  if (taxNumber.length === 10) return "company";
  if (taxNumber.length === 11) return "person";
  return "unknown";
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

function getReferenceNumber(row: UttsRow) {
  return getFirstText(row, [
    "ttbServiceReferenceNumber",
    "referenceNumber",
    "applicationNumber",
    "applicationNo",
    "vehicleOrderReferenceNumber",
    "orderNumber",
  ]);
}

function getCandidateKey(row: UttsRow, index: number) {
  return (
    getText(row, "installationCode") ||
    getReferenceNumber(row) ||
    `${getPlate(row) || "fatura"}-${index}`
  );
}

function applyBuyerOverride(row: UttsRow, override?: InvoiceBuyerOverride) {
  if (!override) return row;

  return {
    ...row,
    invoiceOverrideApplied: "true",
    invoiceSourceTaxNumber: override.sourceTaxNumber,
    invoiceTaxNumber: override.taxNumber,
    invoiceBuyerType: override.buyerType,
    invoiceBuyerName: override.buyerName,
    invoiceBuyerSurname:
      override.buyerType === "person" ? override.buyerSurname : "",
    invoiceTaxOffice: override.taxOffice,
    invoiceCity: override.city,
    invoiceDistrict: override.district,
    invoiceAddress: override.address,
    invoiceEmail: override.email,
    invoicePhone: override.phone,
  };
}

function applyStoredOverrides(
  rows: UttsRow[],
  overrides: Record<string, InvoiceBuyerOverride>
) {
  return rows.map((row) => applyBuyerOverride(row, overrides[getSourceTaxNumber(row)]));
}

function getStatus(row: UttsRow) {
  const statusId = getText(row, "vehicleOrderInstallationStatusId");
  return (
    getText(row, "vehicleOrderInstallationStatus") ||
    statusLabels[statusId] ||
    statusId ||
    ""
  );
}

function isInvoiceReady(row: UttsRow) {
  const statusId = getText(row, "vehicleOrderInstallationStatusId");
  const status = getStatus(row);
  const hasActivation =
    getText(row, "activationDateString") || getText(row, "firstActivationDate");

  return (
    statusId === "10" ||
    status.includes("Aktivasyon Tamamlandı") ||
    Boolean(hasActivation)
  );
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

function uniqueMessages(messages: string[]) {
  return Array.from(new Set(messages));
}

function summarizeValues(values: string[], fallback: string) {
  const unique = Array.from(
    new Set(values.filter((value) => value && value !== "-"))
  );
  if (unique.length === 0) return fallback;
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3}`;
}

function normalizeComparable(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

function getBuyerTypeRank(type: InvoiceCandidate["buyerType"]) {
  if (type === "company") return 0;
  if (type === "person") return 1;
  return 2;
}

function sortInvoiceCandidates(candidates: InvoiceCandidate[]) {
  return [...candidates].sort((a, b) => {
    const typeDiff = getBuyerTypeRank(a.buyerType) - getBuyerTypeRank(b.buyerType);
    if (typeDiff !== 0) return typeDiff;

    const nameDiff = a.buyerName.localeCompare(b.buyerName, "tr");
    if (nameDiff !== 0) return nameDiff;

    return a.key.localeCompare(b.key, "tr");
  });
}

function buildInvoiceCandidates(rows: UttsRow[]) {
  return rows
    .map((row, index) => {
    const buyer = splitBuyerName(row);
    const buyerType = getBuyerType(row);
    const taxNumber = getTaxNumber(row);
    const sourceTaxNumber = getText(row, "invoiceSourceTaxNumber") || getSourceTaxNumber(row);
    const productName = getProductName(row);
    const installationCode = getText(row, "installationCode");
    const unitPrice = getUnitPrice(row);
    const vatAmount = unitPrice * (DEFAULT_VAT_RATE / 100);
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!buyer.name) issues.push("Alıcı adı/ünvanı eksik");
    if (!taxNumber) issues.push("VKN/TCKN eksik");
    if (taxNumber && !/^\d{10,11}$/.test(taxNumber)) {
      issues.push("VKN/TCKN formatı kontrol edilmeli");
    }
    if (!getCity(row)) issues.push("Şehir eksik");
    if (!getDistrict(row)) issues.push("İlçe eksik");
    if (!getAddress(row)) issues.push("Adres eksik");
    if (!getEmail(row)) issues.push("E-posta eksik");
    if (!getPhone(row)) issues.push("Telefon eksik");
    if (!getTaxOffice(row)) issues.push("Vergi dairesi eksik");
    if (!productName) issues.push("Mal/hizmet adı eksik");
    if (!unitPrice) issues.push("Birim fiyat eksik");
    if (taxNumber.length === 11 && !buyer.surname) {
      warnings.push("TCKN için soyadı kontrol edilmeli");
    }
    if (buyerType === "person" && !buyer.surname) {
      issues.push("Şahıs için soyadı eksik");
    }
    if (!isInvoiceReady(row)) {
      warnings.push("Aktivasyon tamamlanmamış olabilir");
    }
    if (!getPlate(row)) warnings.push("Plaka eksik");
    if (!installationCode) warnings.push("Montaj kodu eksik");

    return {
      key: getCandidateKey(row, index),
      exportRows: [row],
      itemCount: 1,
      grouped: false,
      buyerName: buyer.name || "Alıcı bilgisi yok",
      buyerSurname: buyer.surname,
      buyerType,
      taxNumber: taxNumber || "-",
      sourceTaxNumber,
      plate: getPlate(row) || "-",
      referenceNumber: installationCode || "-",
      productName: productName || "-",
      unitPrice,
      vatAmount,
      grossTotal: unitPrice + vatAmount,
      issues: uniqueMessages(issues),
      warnings: uniqueMessages(warnings),
      overrideApplied: getText(row, "invoiceOverrideApplied") === "true",
      row,
    } satisfies InvoiceCandidate;
  });
}

function getBuyerMergeKey(candidate: InvoiceCandidate) {
  return /^\d{10,11}$/.test(candidate.taxNumber) ? candidate.taxNumber : "";
}

function buildMergedInvoiceCandidates(candidates: InvoiceCandidate[]) {
  const groups = new Map<string, InvoiceCandidate[]>();

  candidates.forEach((candidate) => {
    const mergeKey = getBuyerMergeKey(candidate);
    const key = mergeKey || `single-${candidate.key}`;
    groups.set(key, [...(groups.get(key) || []), candidate]);
  });

  return Array.from(groups.entries())
    .map(([groupKey, group]) => {
      if (group.length === 1) return group[0];

      const base = group[0];
      const buyerNames = group.map((candidate) =>
        normalizeComparable(`${candidate.buyerName} ${candidate.buyerSurname}`)
      );
      const buyerTypes = group.map((candidate) => candidate.buyerType);
      const warnings = group.flatMap((candidate) => candidate.warnings);
      const hasBuyerConflict =
        new Set(buyerNames).size > 1 || new Set(buyerTypes).size > 1;

      warnings.push(`${group.length} montaj aynı VKN/TCKN altında birleştirildi`);
      if (hasBuyerConflict) {
        warnings.push("Aynı VKN/TCKN için alıcı bilgileri farklı, kontrol edin");
      }

      return {
        ...base,
        key: `group-${groupKey}`,
        exportRows: group.flatMap((candidate) => candidate.exportRows),
        itemCount: group.reduce((sum, candidate) => sum + candidate.itemCount, 0),
        grouped: true,
        plate: summarizeValues(
          group.map((candidate) => candidate.plate),
          "-"
        ),
        referenceNumber: `${group.length} montaj kalemi`,
        productName:
          new Set(group.map((candidate) => candidate.productName)).size === 1
            ? `${base.productName} (${group.length} adet)`
            : `${group.length} montaj kalemi`,
        unitPrice: group.reduce((sum, candidate) => sum + candidate.unitPrice, 0),
        vatAmount: group.reduce((sum, candidate) => sum + candidate.vatAmount, 0),
        grossTotal: group.reduce((sum, candidate) => sum + candidate.grossTotal, 0),
        issues: uniqueMessages(group.flatMap((candidate) => candidate.issues)),
        warnings: uniqueMessages(warnings),
        overrideApplied: group.some((candidate) => candidate.overrideApplied),
      } satisfies InvoiceCandidate;
    });
}

function totalPages(length: number) {
  return Math.max(1, Math.ceil(length / PAGE_SIZE));
}

export default function UttsBillingPage() {
  const [hasUttsCredentials, setHasUttsCredentials] = useState(false);
  const [uyumsoftConnected, setUyumsoftConnected] = useState(false);
  const [uyumsoftUser, setUyumsoftUser] = useState("");
  const [fetching, setFetching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [checkingUsers, setCheckingUsers] = useState(false);
  const [routings, setRoutings] = useState<Record<string, EInvoiceRouting>>({});
  const [savingOverride, setSavingOverride] = useState(false);
  const [rows, setRows] = useState<UttsRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, InvoiceBuyerOverride>>({});
  const [mergeByBuyer, setMergeByBuyer] = useState(false);
  const [editingCandidate, setEditingCandidate] =
    useState<InvoiceCandidate | null>(null);
  const [editForm, setEditForm] = useState<InvoiceEditForm>(emptyEditForm);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    startActivationDate: today(),
    endActivationDate: today(),
    vehicleOrderInstallationStatus: "10",
    invoiceDate: today(),
    invoiceProfile: "TICARIFATURA",
  });

  useEffect(() => {
    fetch("/api/utts/settings")
      .then((r) => r.json())
      .then((data) => setHasUttsCredentials(Boolean(data.hasCredentials)))
      .catch(() => {});

    fetch("/api/uyumsoft/settings")
      .then((r) => r.json())
      .then((data) => {
        setUyumsoftConnected(Boolean(data.lastTestSuccess));
        setUyumsoftUser(data.username || "");
      })
      .catch(() => {});

    fetch("/api/uyumsoft/buyer-overrides")
      .then((r) => r.json())
      .then((data) => {
        const next: Record<string, InvoiceBuyerOverride> = {};
        if (Array.isArray(data.overrides)) {
          for (const item of data.overrides as InvoiceBuyerOverride[]) {
            if (item.sourceTaxNumber) next[item.sourceTaxNumber] = item;
          }
        }
        setOverrides(next);
      })
      .catch(() => {});
  }, []);

  const effectiveRows = useMemo(
    () => applyStoredOverrides(rows, overrides),
    [rows, overrides]
  );
  const candidates = useMemo(
    () => sortInvoiceCandidates(buildInvoiceCandidates(effectiveRows)),
    [effectiveRows]
  );
  const invoiceCandidates = useMemo(
    () =>
      mergeByBuyer
        ? sortInvoiceCandidates(buildMergedInvoiceCandidates(candidates))
        : candidates,
    [candidates, mergeByBuyer]
  );
  const readyCandidates = invoiceCandidates.filter(
    (candidate) => candidate.issues.length === 0
  );
  const issueCount = invoiceCandidates.reduce(
    (sum, candidate) => sum + candidate.issues.length,
    0
  );
  const issueSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of invoiceCandidates) {
      for (const issue of candidate.issues) {
        counts.set(issue, (counts.get(issue) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count);
  }, [invoiceCandidates]);
  const grossTotal = invoiceCandidates.reduce(
    (sum, candidate) => sum + candidate.grossTotal,
    0
  );
  const unitPriceTotal = invoiceCandidates.reduce(
    (sum, candidate) => sum + candidate.unitPrice,
    0
  );
  const pageCount = totalPages(invoiceCandidates.length);
  const pagedCandidates = invoiceCandidates.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const manualOverrideCount = candidates.filter(
    (candidate) => candidate.overrideApplied
  ).length;
  const mergedInvoiceCount = candidates.length - invoiceCandidates.length;

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const updateEditForm = (key: keyof InvoiceEditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  };

  const startEditCandidate = (candidate: InvoiceCandidate) => {
    const sourceTaxNumber =
      candidate.sourceTaxNumber && candidate.sourceTaxNumber !== "-"
        ? candidate.sourceTaxNumber
        : candidate.taxNumber !== "-"
        ? candidate.taxNumber
        : "";

    setEditingCandidate(candidate);
    setEditForm({
      sourceTaxNumber,
      taxNumber: candidate.taxNumber === "-" ? "" : candidate.taxNumber,
      buyerType: candidate.buyerType === "person" ? "person" : "company",
      buyerName:
        candidate.buyerName === "Alıcı bilgisi yok" ? "" : candidate.buyerName,
      buyerSurname: candidate.buyerSurname,
      taxOffice: getTaxOffice(candidate.row),
      city: getCity(candidate.row),
      district: getDistrict(candidate.row),
      address: getAddress(candidate.row),
      email: getEmail(candidate.row),
      phone: getPhone(candidate.row),
    });
  };

  const saveBuyerOverride = async () => {
    if (!editingCandidate) return;
    const taxNumber = editForm.taxNumber.replace(/\D/g, "");
    const sourceTaxNumber =
      editForm.sourceTaxNumber.replace(/\D/g, "") || taxNumber;

    if (!/^\d{10,11}$/.test(taxNumber)) {
      toast.error("VKN/TCKN 10 veya 11 haneli olmalı");
      return;
    }
    if (!editForm.buyerName.trim()) {
      toast.error("Ad/ünvan alanı gerekli");
      return;
    }
    if (editForm.buyerType === "person" && !editForm.buyerSurname.trim()) {
      toast.error("Şahıs için soyad alanı gerekli");
      return;
    }

    setSavingOverride(true);
    try {
      const payload: InvoiceBuyerOverride = {
        ...editForm,
        sourceTaxNumber,
        taxNumber,
        buyerName: editForm.buyerName.trim(),
        buyerSurname:
          editForm.buyerType === "person" ? editForm.buyerSurname.trim() : "",
        taxOffice: editForm.taxOffice.trim(),
        city: editForm.city.trim(),
        district: editForm.district.trim(),
        address: editForm.address.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
      };

      const res = await fetch("/api/uyumsoft/buyer-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        toast.error(data.error || "Alıcı düzeltmesi kaydedilemedi");
        return;
      }

      const saved = data.override as InvoiceBuyerOverride;
      setOverrides((prev) => ({
        ...prev,
        [saved.sourceTaxNumber]: saved,
      }));
      setRows((prev) =>
        prev.map((row, index) =>
          getCandidateKey(row, index) === editingCandidate.key
            ? applyBuyerOverride(row, saved)
            : row
        )
      );
      setEditingCandidate(null);
      toast.success("Alıcı düzeltmesi kaydedildi");
    } catch {
      toast.error("Alıcı düzeltmesi kaydedilirken hata oluştu");
    } finally {
      setSavingOverride(false);
    }
  };

  const fetchBillingRows = async () => {
    if (!filters.startActivationDate || !filters.endActivationDate) {
      toast.error("Başlangıç ve bitiş tarihi seçin");
      return;
    }

    setFetching(true);
    try {
      const collected: UttsRow[] = [];

      for (let pageNumber = 1; pageNumber <= MAX_API_PAGES; pageNumber++) {
        const params = new URLSearchParams({
          pageNumber: String(pageNumber),
          pageSize: String(API_PAGE_SIZE),
          startActivationDate: filters.startActivationDate,
          endActivationDate: filters.endActivationDate,
          vehicleOrderInstallationStatus: filters.vehicleOrderInstallationStatus,
        });
        const res = await fetch(`/api/utts/installations?${params}`);
        const data = await res.json();

        if (!res.ok || data.error) {
          toast.error(data.error || "UTTS montaj verileri alınamadı");
          return;
        }

        const pageRows = extractRows(data.data);
        collected.push(...pageRows);

        if (pageRows.length < API_PAGE_SIZE) break;
      }

      const filteredRows = filterRowsByDate(
        collected,
        filters.startActivationDate,
        filters.endActivationDate
      );
      setRows(filteredRows);
      setRoutings({});
      setPage(1);
      toast.success(`${filteredRows.length} kayıt fatura adayına hazırlandı`);
    } catch {
      toast.error("Faturalandırma verileri hazırlanırken hata oluştu");
    } finally {
      setFetching(false);
    }
  };

  const exportUyumsoftExcel = async () => {
    if (invoiceCandidates.length === 0) {
      toast.error("Excel oluşturmak için fatura adayı yok");
      return;
    }

    setExporting(true);
    try {
      const res = await fetch("/api/uyumsoft/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: invoiceCandidates.flatMap((candidate) => candidate.exportRows),
          invoiceDate: filters.invoiceDate,
          profile: filters.invoiceProfile,
          mergeByBuyer,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Uyumsoft Excel dosyası oluşturulamadı");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `uyumsoft-fatura-${filters.invoiceDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (issueCount > 0) {
        toast.warning("Excel indirildi; eksik alanlar boş bırakıldı");
      } else if (mergeByBuyer) {
        toast.success("Birleştirilmiş Uyumsoft Excel dosyası indirildi");
      } else {
        toast.success("Uyumsoft Excel dosyası indirildi");
      }
    } catch {
      toast.error("Uyumsoft Excel dosyası indirilirken hata oluştu");
    } finally {
      setExporting(false);
    }
  };

  const checkEInvoiceUsers = async () => {
    if (invoiceCandidates.length === 0) {
      toast.error("Mükellef kontrolü için fatura adayı yok");
      return;
    }
    if (!uyumsoftConnected) {
      toast.error("Önce Uyumsoft bağlantı testinin başarılı olması gerekiyor");
      return;
    }

    const pairs = invoiceCandidates
      .map((candidate) => ({
        key: candidate.key,
        ...getVknTcknPair(candidate.row),
      }))
      .filter((pair) => pair.vkn || pair.tckn);

    if (pairs.length === 0) {
      toast.error("Sorgulanacak geçerli VKN/TCKN bulunamadı");
      return;
    }

    setCheckingUsers(true);
    try {
      const res = await fetch("/api/uyumsoft/check-einvoice-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        toast.error(data.error || "Mükellef sorgusu başarısız oldu");
        return;
      }

      const results = (data.results || {}) as Record<string, EInvoiceRouting>;
      setRoutings((prev) => ({ ...prev, ...results }));

      const eInvoiceCount = Object.values(results).filter(
        (routing) => routing.isEInvoice
      ).length;
      toast.success(
        `${Object.keys(results).length} alıcı sorgulandı: ${eInvoiceCount} E-Fatura, ${
          Object.keys(results).length - eInvoiceCount
        } E-Arşiv`
      );
    } catch {
      toast.error("Mükellef sorgusu sırasında hata oluştu");
    } finally {
      setCheckingUsers(false);
    }
  };

  const createUyumsoftDrafts = async () => {
    if (readyCandidates.length === 0) {
      toast.error("Taslak oluşturmak için kontrolü geçen fatura adayı yok");
      return;
    }

    if (!uyumsoftConnected) {
      toast.error("Önce Uyumsoft bağlantı testinin başarılı olması gerekiyor");
      return;
    }

    const blockedCount = invoiceCandidates.length - readyCandidates.length;
    const confirmed = window.confirm(
      `${readyCandidates.length} fatura adayı Uyumsoft'a taslak olarak gönderilecek.` +
        (blockedCount > 0
          ? ` ${blockedCount} eksik/kontrollü aday gönderilmeyecek.`
          : "") +
        " Bu işlem canlı fatura gönderimi yapmaz, yalnızca Uyumsoft taslağı oluşturur. Devam edilsin mi?"
    );

    if (!confirmed) return;

    setDrafting(true);
    try {
      const res = await fetch("/api/uyumsoft/save-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: readyCandidates.flatMap((candidate) => candidate.exportRows),
          invoiceDate: filters.invoiceDate,
          profile: filters.invoiceProfile,
          mergeByBuyer,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        if (Array.isArray(data.issues) && data.issues.length > 0) {
          toast.error(data.issues.slice(0, 3).join(", "));
        } else {
          toast.error(data.error || "Uyumsoft taslakları oluşturulamadı");
        }
        return;
      }

      toast.success(
        `${data.draftCount || readyCandidates.length} Uyumsoft taslağı oluşturuldu`
      );
    } catch {
      toast.error("Uyumsoft taslakları oluşturulurken hata oluştu");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Faturalandırma</h2>
          <p className="text-muted-foreground">
            UTTS montaj kayıtlarını Uyumsoft taslak fatura adaylarına dönüştürün.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={hasUttsCredentials ? "default" : "secondary"}>
            {hasUttsCredentials ? "UTTS Hazır" : "UTTS Ayarı Gerekli"}
          </Badge>
          <Badge variant={uyumsoftConnected ? "default" : "secondary"}>
            {uyumsoftConnected ? "Uyumsoft Bağlı" : "Uyumsoft Test Gerekli"}
          </Badge>
        </div>
      </div>

      {issueSummary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eksik Alan Özeti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {issueSummary.map((item) => (
                <Badge key={item.issue} variant="secondary">
                  {item.issue}: {item.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fatura Adayı Hazırlama</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="space-y-2">
              <Label>Başlangıç</Label>
              <Input
                type="date"
                value={filters.startActivationDate}
                onChange={(e) => updateFilter("startActivationDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Bitiş</Label>
              <Input
                type="date"
                value={filters.endActivationDate}
                onChange={(e) => updateFilter("endActivationDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Durum</Label>
              <select
                value={filters.vehicleOrderInstallationStatus}
                onChange={(e) =>
                  updateFilter("vehicleOrderInstallationStatus", e.target.value)
                }
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Tüm Durumlar</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Fatura Tarihi</Label>
              <Input
                type="date"
                value={filters.invoiceDate}
                onChange={(e) => updateFilter("invoiceDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Fatura Profili</Label>
              <select
                value={filters.invoiceProfile}
                onChange={(e) => updateFilter("invoiceProfile", e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="EARSIVFATURA">EARSIVFATURA</option>
                <option value="TEMELFATURA">TEMELFATURA</option>
                <option value="TICARIFATURA">TICARIFATURA</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={fetchBillingRows}
                disabled={fetching || !hasUttsCredentials}
                className="w-full"
              >
                {fetching ? "Hazırlanıyor..." : "Fatura Adaylarını Hazırla"}
              </Button>
            </div>
          </div>
          {uyumsoftConnected && uyumsoftUser && (
            <p className="mt-3 text-sm text-muted-foreground">
              Uyumsoft bağlantısı aktif: {uyumsoftUser}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              UTTS Kayıt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Fatura Adayı
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{invoiceCandidates.length}</div>
            {mergeByBuyer && (
              <p className="mt-1 text-xs text-muted-foreground">
                {mergedInvoiceCount} montaj birleştirildi
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Taslağa Hazır
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{readyCandidates.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Eksik Alan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{issueCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Elle Düzeltildi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{manualOverrideCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              KDV Dahil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(grossTotal)} TL</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Birim fiyat toplamı: {formatMoney(unitPriceTotal)} TL
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Uyumsoft Taslak Fatura Adayları</CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex rounded-lg border bg-muted/40 p-1">
                <Button
                  variant={!mergeByBuyer ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMergeByBuyer(false);
                    setPage(1);
                  }}
                >
                  Tekil
                </Button>
                <Button
                  variant={mergeByBuyer ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMergeByBuyer(true);
                    setPage(1);
                  }}
                  disabled={candidates.length === 0}
                >
                  Aynı Alıcıları Birleştir
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={exporting || invoiceCandidates.length === 0}
                onClick={exportUyumsoftExcel}
              >
                {exporting
                  ? "Excel Hazırlanıyor..."
                  : issueCount > 0
                  ? "Eksiklerle Excel Oluştur"
                  : "Uyumsoft Excel Formatı Oluştur"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  checkingUsers ||
                  invoiceCandidates.length === 0 ||
                  !uyumsoftConnected
                }
                onClick={checkEInvoiceUsers}
              >
                {checkingUsers
                  ? "Mükellef Sorgulanıyor..."
                  : "E-Fatura Mükellef Kontrolü"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  drafting ||
                  readyCandidates.length === 0 ||
                  !uyumsoftConnected
                }
                onClick={createUyumsoftDrafts}
              >
                {drafting ? "Taslak Oluşturuluyor..." : "Uyumsoft Taslak Oluştur"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alıcı</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>VKN/TCKN</TableHead>
                  <TableHead>E-Belge</TableHead>
                  <TableHead>Plaka</TableHead>
                  <TableHead>Mal/Hizmet</TableHead>
                  <TableHead className="text-right">Birim Fiyat</TableHead>
                  <TableHead className="text-right">KDV</TableHead>
                  <TableHead className="text-right">KDV Dahil</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCandidates.map((candidate) => (
                  <TableRow key={candidate.key}>
                    <TableCell className="min-w-56">
                      <div className="font-medium">
                        {candidate.buyerName}
                        {candidate.buyerSurname ? ` ${candidate.buyerSurname}` : ""}
                      </div>
                      {candidate.overrideApplied && (
                        <Badge variant="secondary" className="mt-1">
                          Elle düzeltildi
                        </Badge>
                      )}
                      {candidate.grouped && (
                        <Badge variant="secondary" className="mt-1 ml-1">
                          {candidate.itemCount} kalem birleşti
                        </Badge>
                      )}
                      {candidate.warnings.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {candidate.warnings.join(", ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {candidate.buyerType === "person" ? (
                        <Badge className="border-yellow-300 bg-yellow-100 text-yellow-900">
                          Şahıs
                        </Badge>
                      ) : candidate.buyerType === "company" ? (
                        <Badge className="border-blue-300 bg-blue-100 text-blue-900">
                          Tüzel
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Belirsiz</Badge>
                      )}
                    </TableCell>
                    <TableCell>{candidate.taxNumber}</TableCell>
                    <TableCell className="min-w-32">
                      {(() => {
                        const routing = routings[candidate.key];
                        if (!routing) {
                          return (
                            <span className="text-xs text-muted-foreground">
                              Sorgulanmadı
                            </span>
                          );
                        }
                        if (routing.isEInvoice) {
                          return (
                            <Badge className="border-green-300 bg-green-100 text-green-900">
                              E-Fatura ({routing.scheme})
                            </Badge>
                          );
                        }
                        return (
                          <Badge className="border-amber-300 bg-amber-100 text-amber-900">
                            E-Arşiv
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>{candidate.plate}</TableCell>
                    <TableCell>
                      <div>{candidate.productName}</div>
                      {candidate.referenceNumber !== "-" && (
                        <div className="text-xs text-muted-foreground">
                          {candidate.referenceNumber}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(candidate.unitPrice)} TL
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(candidate.vatAmount)} TL
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(candidate.grossTotal)} TL
                    </TableCell>
                    <TableCell className="min-w-48">
                      {candidate.issues.length === 0 ? (
                        <Badge>Hazır</Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="destructive">Kontrol Gerekli</Badge>
                          <p className="text-xs text-muted-foreground">
                            {candidate.issues.join(", ")}
                          </p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEditCandidate(candidate)}
                      >
                        Düzenle
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {invoiceCandidates.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Fatura adayı hazırlamak için UTTS verisi çekin.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {invoiceCandidates.length > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}-
                {Math.min(page * PAGE_SIZE, invoiceCandidates.length)} /{" "}
                {invoiceCandidates.length} aday
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Önceki
                </Button>
                <Badge variant="secondary">
                  {page} / {pageCount}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Sonraki
                </Button>
              </div>
            </div>
          )}

          {invoiceCandidates.length > 0 && (
            <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              {mergeByBuyer
                ? "Birleşik modda aynı VKN/TCKN'ye ait montajlar Excel'de aynı fatura Id değeriyle, ayrı mal/hizmet kalemleri olarak yazılır."
                : "Tekil modda her UTTS montajı Excel'de ayrı fatura Id değeriyle yazılır."}{" "}
              Uyumsoft Taslak Oluştur butonu sadece kontrolü geçen adayları
              Uyumsoft taslaklarına kaydeder; canlı fatura gönderimi yapılmaz.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dönüşüm Kuralı</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Gruplama</p>
            <p className="mt-1 text-muted-foreground">
              Tekil mod her montajı ayrı fatura yapar; birleşik mod aynı
              VKN/TCKN kayıtlarını tek fatura altında çoklu kaleme dönüştürür.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Alıcı Tipi</p>
            <p className="mt-1 text-muted-foreground">
              İlk tahmin VKN/TCKN uzunluğundan yapılır; karışık kayıtlarda
              Düzenle ile son karar verilir.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Not Alanları</p>
            <p className="mt-1 text-muted-foreground">
              Not1 sabit açıklama, Not2 plaka, Not3 başvuru no, Not4 ürün adı
              olacak şekilde doldurulur.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Düzeltme Hafızası</p>
            <p className="mt-1 text-muted-foreground">
              Kaydedilen alıcı düzeltmeleri aynı kaynak VKN/TCKN tekrar
              geldiğinde otomatik uygulanır.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(editingCandidate)}
        onOpenChange={(open) => {
          if (!open) setEditingCandidate(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Alıcı Bilgisini Düzenle</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Kaynak VKN/TCKN</Label>
              <Input value={editForm.sourceTaxNumber} disabled />
            </div>
            <div className="space-y-2">
              <Label>Faturaya Yazılacak VKN/TCKN</Label>
              <Input
                value={editForm.taxNumber}
                onChange={(e) => updateEditForm("taxNumber", e.target.value)}
                placeholder="10 haneli VKN veya 11 haneli TCKN"
              />
            </div>
            <div className="space-y-2">
              <Label>Alıcı Tipi</Label>
              <select
                value={editForm.buyerType}
                onChange={(e) =>
                  updateEditForm(
                    "buyerType",
                    e.target.value === "person" ? "person" : "company"
                  )
                }
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="company">Tüzel / Ünvan</option>
                <option value="person">Şahıs / Ad Soyad</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>
                {editForm.buyerType === "person" ? "Ad" : "Ünvan / Ad"}
              </Label>
              <Input
                value={editForm.buyerName}
                onChange={(e) => updateEditForm("buyerName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Soyad</Label>
              <Input
                value={editForm.buyerSurname}
                onChange={(e) => updateEditForm("buyerSurname", e.target.value)}
                disabled={editForm.buyerType === "company"}
                placeholder={
                  editForm.buyerType === "person"
                    ? "Şahıs için zorunlu"
                    : "Tüzelde boş bırakılır"
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Vergi Dairesi</Label>
              <Input
                value={editForm.taxOffice}
                onChange={(e) => updateEditForm("taxOffice", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Şehir</Label>
              <Input
                value={editForm.city}
                onChange={(e) => updateEditForm("city", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>İlçe</Label>
              <Input
                value={editForm.district}
                onChange={(e) => updateEditForm("district", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>E-posta</Label>
              <Input
                value={editForm.email}
                onChange={(e) => updateEditForm("email", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Telefon</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => updateEditForm("phone", e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Adres</Label>
              <Textarea
                value={editForm.address}
                onChange={(e) => updateEditForm("address", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingCandidate(null)}
              disabled={savingOverride}
            >
              Vazgeç
            </Button>
            <Button onClick={saveBuyerOverride} disabled={savingOverride}>
              {savingOverride ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
