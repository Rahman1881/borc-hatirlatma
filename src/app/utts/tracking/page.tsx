"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type UttsRow = Record<string, unknown>;

const PAGE_SIZE = 50;
const API_PAGE_SIZE = 500;

const statusLabels: Record<string, string> = {
  "5": "Fiziksel Montaj Tamamlandı",
  "6": "Fotoğraf Yüklendi, Aktivasyon Bekliyor",
  "7": "Otp Gönderildi",
  "8": "Otp Onaylandı",
  "10": "Aktivasyon Tamamlandı",
  "20": "Yenisiyle Değiştirildi",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getText(row: UttsRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value).trim();
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

function filterRowsByDate(
  rows: UttsRow[],
  startDate: string,
  endDate: string
) {
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

function getStatus(row: UttsRow) {
  const statusId = getText(row, "vehicleOrderInstallationStatusId");
  return (
    getText(row, "vehicleOrderInstallationStatus") ||
    statusLabels[statusId] ||
    statusId ||
    "Durum yok"
  );
}

function getActivationDate(row: UttsRow) {
  return (
    getText(row, "activationDateString") ||
    getText(row, "firstActivationDate") ||
    getText(row, "lastActivationDate") ||
    "-"
  );
}

function countBy(rows: UttsRow[], getKey: (row: UttsRow) => string) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = getKey(row) || "-";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function totalPages(length: number) {
  return Math.max(1, Math.ceil(length / PAGE_SIZE));
}

export default function UttsTrackingPage() {
  const [hasCredentials, setHasCredentials] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [rows, setRows] = useState<UttsRow[]>([]);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    startActivationDate: today(),
    endActivationDate: today(),
    vehicleOrderInstallationStatus: "",
  });

  useEffect(() => {
    fetch("/api/utts/settings")
      .then((r) => r.json())
      .then((data) => setHasCredentials(Boolean(data.hasCredentials)))
      .catch(() => {});
  }, []);

  const completedCount = useMemo(
    () =>
      rows.filter((row) => {
        const statusId = getText(row, "vehicleOrderInstallationStatusId");
        return statusId === "10" || getStatus(row).includes("Aktivasyon Tamamlandı");
      }).length,
    [rows]
  );
  const pendingCount = rows.length - completedCount;
  const grossTotal = useMemo(
    () => rows.reduce((sum, row) => sum + getNumber(row, "salePriceString"), 0),
    [rows]
  );
  const statusCounts = useMemo(() => countBy(rows, getStatus), [rows]);
  const technicianCounts = useMemo(
    () => countBy(rows, (row) => getText(row, "technicianFullName") || "Teknisyen yok"),
    [rows]
  );
  const companyCounts = useMemo(
    () => countBy(rows, (row) => getText(row, "vehicleCompanyName") || "Firma yok"),
    [rows]
  );
  const pageCount = totalPages(rows.length);
  const pagedRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const fetchTrackingRows = async () => {
    if (!filters.startActivationDate || !filters.endActivationDate) {
      toast.error("Başlangıç ve bitiş tarihi seçin");
      return;
    }

    setFetching(true);
    try {
      const collected: UttsRow[] = [];

      for (let pageNumber = 1; pageNumber <= 20; pageNumber++) {
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
      setPage(1);
      toast.success(`${filteredRows.length} montaj kaydı alındı`);
    } catch {
      toast.error("UTTS montaj takip verileri alınırken hata oluştu");
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Montaj Takip</h2>
          <p className="text-muted-foreground">
            Günlük veya seçili tarih aralığındaki UTTS montaj işlemlerini takip edin.
          </p>
        </div>
        <Badge variant={hasCredentials ? "default" : "secondary"}>
          {hasCredentials ? "UTTS Bilgileri Kayıtlı" : "Ayar Gerekli"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tarih ve Durum Filtresi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            <div className="flex items-end">
              <Button
                onClick={fetchTrackingRows}
                disabled={fetching || !hasCredentials}
                className="w-full"
              >
                {fetching ? "Veriler Alınıyor..." : "Montajları Getir"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam İşlem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tamamlanan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {completedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bekleyen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {pendingCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              KDV Dahil Tutar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(grossTotal)} TL</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Durum Dağılımı</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {statusCounts.slice(0, 8).map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span>{item.name}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
              {statusCounts.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Veri çekilmedi.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Teknisyen Dağılımı</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {technicianCounts.slice(0, 8).map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span className="truncate">{item.name}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
              {technicianCounts.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Veri çekilmedi.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Firma Dağılımı</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {companyCounts.slice(0, 8).map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm">
                  <span className="truncate">{item.name}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
              {companyCounts.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Veri çekilmedi.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Montaj İşlemleri</CardTitle>
            <Badge variant="secondary">{rows.length} kayıt</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plaka</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead>Montaj Kodu</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Teknisyen</TableHead>
                  <TableHead>Aktivasyon</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((row, index) => (
                  <TableRow key={`${getText(row, "installationCode")}-${index}`}>
                    <TableCell className="font-medium">
                      {getText(row, "licensePlate") || "-"}
                    </TableCell>
                    <TableCell>{getText(row, "vehicleCompanyName") || "-"}</TableCell>
                    <TableCell>{getText(row, "installationCode") || "-"}</TableCell>
                    <TableCell>{getStatus(row)}</TableCell>
                    <TableCell>{getText(row, "technicianFullName") || "-"}</TableCell>
                    <TableCell>{getActivationDate(row)}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(getNumber(row, "salePriceString"))} TL
                    </TableCell>
                  </TableRow>
                ))}
                {pagedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Seçili tarih aralığı için veri çekin.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {rows.length > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, rows.length)} /{" "}
                {rows.length} kayıt
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
        </CardContent>
      </Card>
    </div>
  );
}
