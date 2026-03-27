"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

interface Customer {
  id: number;
  code: string;
  name: string;
  phone: string;
  total_debt: number;
  overdue_debt: number;
  credit_limit: number;
  city: string;
  district: string;
  filo_group: string;
  ozel_kod: string;
  toplam_alacak: number;
  tarihli_bakiye: number;
  son_durum: number;
  toplam_risk: number;
  source: string;
}

interface Stats {
  total: number;
  with_debt: number;
  with_overdue: number;
  with_phone: number;
  no_phone: number;
}

function formatMoney(n: number) {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface EditingCell {
  id: number;
  field: string;
  value: string;
}

function EditableCell({
  value,
  customerId,
  field,
  className,
  onSaved,
  children,
}: {
  value: string | number;
  customerId: number;
  field: string;
  className?: string;
  onSaved: () => void;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setEditValue(String(value));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, value]);

  const save = async () => {
    if (editValue === String(value)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customerId,
          field,
          value: ["total_debt", "overdue_debt"].includes(field)
            ? parseFloat(editValue) || 0
            : editValue,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Kaydedildi");
        onSaved();
      } else {
        toast.error("Kaydetme hatası");
      }
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        disabled={saving}
        className="h-7 text-sm min-w-[80px]"
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 ${className || ""}`}
      onClick={() => setEditing(true)}
      title="Düzenlemek için tıklayın"
    >
      {children}
    </span>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [activeSource, setActiveSource] = useState<string>("yakit");

  const fetchCustomers = useCallback(() => {
    const params = new URLSearchParams({
      filter,
      search,
      page: String(page),
      limit: "50",
    });
    fetch(`/api/customers?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCustomers(data.customers);
        setTotal(data.total);
        setStats(data.stats);
        if (data.activeSource) setActiveSource(data.activeSource);
      });
  }, [filter, search, page]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, source: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source", source);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(
          `${data.imported} kayıt içe aktarıldı. ${data.withDebt} borçlu, ${data.withPhone} telefon kayıtlı.`
        );
        setPage(1);
        fetchCustomers();
      }
    } catch {
      toast.error("Yükleme sırasında hata oluştu");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const filters = [
    { value: "all", label: "Tümü", count: stats?.total },
    { value: "debt", label: "Borçlu", count: stats?.with_debt },
    { value: "overdue", label: "Vadesi Geçmiş", count: stats?.with_overdue },
    { value: "with_phone", label: "Telefonlu", count: stats?.with_phone },
    { value: "no_phone", label: "Telefonsuz", count: stats?.no_phone },
  ];

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Müşteriler</h2>
          <p className="text-muted-foreground">
            Excel dosyası yükleyin ve müşterilerinizi yönetin. Düzenlemek için hücreye tıklayın.
          </p>
          {activeSource && (
            <Badge variant={activeSource === "siber" ? "default" : "secondary"} className="mt-1">
              Aktif: {activeSource === "siber" ? "Siber Excel" : "Yakıt Ofisi Excel"}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={uploading}
            onClick={() => document.getElementById("yakit-upload")?.click()}
          >
            {uploading ? "Yükleniyor..." : "Yakıt Ofisi Excel"}
          </Button>
          <input
            id="yakit-upload"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => handleUpload(e, "yakit")}
          />
          <Button
            disabled={uploading}
            onClick={() => document.getElementById("siber-upload")?.click()}
          >
            {uploading ? "Yükleniyor..." : "Siber Excel"}
          </Button>
          <input
            id="siber-upload"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleUpload(e, "siber")}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
          >
            {f.label}
            {f.count !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {f.count}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Search */}
      <Input
        placeholder="İsim, telefon veya şehir ile ara..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="max-w-sm"
      />

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {total} müşteri listeleniyor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {activeSource === "siber" ? (
                  <>
                    <TableHead>Cari Kodu</TableHead>
                    <TableHead>Unvanı</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead>Grup</TableHead>
                    <TableHead>Özel Kod</TableHead>
                    <TableHead className="text-right">Toplam Borç</TableHead>
                    <TableHead className="text-right">Toplam Alacak</TableHead>
                    <TableHead className="text-right">Tarihli Bakiye</TableHead>
                    <TableHead className="text-right">Son Durum</TableHead>
                    <TableHead className="text-right">Toplam Risk</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead>Müşteri Adı</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead className="text-right">Toplam Borç</TableHead>
                    <TableHead className="text-right">Vadesi Geçmiş</TableHead>
                    <TableHead>Şehir</TableHead>
                    <TableHead>Grup</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  {activeSource === "siber" ? (
                    <>
                      <TableCell className="text-sm font-mono">
                        {c.code || "-"}
                      </TableCell>
                      <TableCell className="font-medium">
                        <EditableCell value={c.name} customerId={c.id} field="name" onSaved={fetchCustomers}>
                          {c.name}
                        </EditableCell>
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={c.phone}
                          customerId={c.id}
                          field="phone"
                          className={
                            c.phone
                              ? c.phone.startsWith("905")
                                ? "text-sm"
                                : "text-sm text-red-500"
                              : "text-xs text-muted-foreground"
                          }
                          onSaved={fetchCustomers}
                        >
                          {c.phone || "Telefon yok"}
                        </EditableCell>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {c.filo_group || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.ozel_kod || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={c.total_debt > 0 ? "text-orange-600 font-medium" : "text-muted-foreground"}>
                          {formatMoney(c.total_debt)} TL
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={c.toplam_alacak > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>
                          {formatMoney(c.toplam_alacak)} TL
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={c.tarihli_bakiye > 0 ? "text-orange-600 font-medium" : "text-muted-foreground"}>
                          {formatMoney(c.tarihli_bakiye)} TL
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={c.son_durum > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}>
                          {formatMoney(c.son_durum)} TL
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={c.toplam_risk > 0 ? "text-purple-600 font-medium" : "text-muted-foreground"}>
                          {formatMoney(c.toplam_risk)} TL
                        </span>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">
                        <EditableCell value={c.name} customerId={c.id} field="name" onSaved={fetchCustomers}>
                          {c.name}
                        </EditableCell>
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={c.phone}
                          customerId={c.id}
                          field="phone"
                          className={
                            c.phone
                              ? c.phone.startsWith("905")
                                ? "text-sm"
                                : "text-sm text-red-500"
                              : "text-xs text-muted-foreground"
                          }
                          onSaved={fetchCustomers}
                        >
                          {c.phone || "Telefon yok"}
                        </EditableCell>
                      </TableCell>
                      <TableCell className="text-right">
                        <EditableCell
                          value={c.total_debt}
                          customerId={c.id}
                          field="total_debt"
                          className={
                            c.total_debt > 0
                              ? "text-orange-600 font-medium"
                              : "text-muted-foreground"
                          }
                          onSaved={fetchCustomers}
                        >
                          {formatMoney(c.total_debt)} TL
                        </EditableCell>
                      </TableCell>
                      <TableCell className="text-right">
                        <EditableCell
                          value={c.overdue_debt}
                          customerId={c.id}
                          field="overdue_debt"
                          className={
                            c.overdue_debt > 0
                              ? "text-red-600 font-medium"
                              : "text-muted-foreground"
                          }
                          onSaved={fetchCustomers}
                        >
                          {formatMoney(c.overdue_debt)} TL
                        </EditableCell>
                      </TableCell>
                      <TableCell className="text-sm">
                        <EditableCell value={c.city} customerId={c.id} field="city" onSaved={fetchCustomers}>
                          {c.city || "-"}
                          {c.district ? ` / ${c.district}` : ""}
                        </EditableCell>
                      </TableCell>
                      <TableCell>
                        <EditableCell value={c.filo_group} customerId={c.id} field="filo_group" onSaved={fetchCustomers}>
                          {c.filo_group ? (
                            <Badge variant="outline" className="text-xs">
                              {c.filo_group}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </EditableCell>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeSource === "siber" ? 10 : 6} className="text-center py-8">
                    <p className="text-muted-foreground">
                      Henüz müşteri yok. Excel dosyası yükleyin.
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Sayfa {page} / {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Önceki
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
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
