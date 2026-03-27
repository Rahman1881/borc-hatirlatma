"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
  name: string;
  phone: string;
  total_debt: number;
  overdue_debt: number;
  city: string;
  filo_group: string;
  toplam_alacak: number;
  tarihli_bakiye: number;
  son_durum: number;
  toplam_risk: number;
}

interface Template {
  id: number;
  name: string;
  body: string;
}

function formatMoney(n: number) {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const statusFilters = [
  { value: "with_phone", label: "Telefonlu Tümü" },
  { value: "debt", label: "Borçlu" },
  { value: "overdue", label: "Vadesi Geçmiş" },
];

export default function SendPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("debt");
  const [search, setSearch] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<{ filo_group: string; count: number }[]>([]);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [minDebt, setMinDebt] = useState(0);
  const [activeSource, setActiveSource] = useState<string>("yakit");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setGroupDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchCustomers = useCallback(() => {
    const params = new URLSearchParams({
      filter,
      search,
      group: Array.from(selectedGroups).join(","),
      page: String(page),
      limit: "50",
      phone_only: "1",
      min_debt: String(minDebt),
    });
    fetch(`/api/customers?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCustomers(data.customers);
        setTotal(data.total);
        if (data.groups) setGroups(data.groups);
        if (data.activeSource) setActiveSource(data.activeSource);
      });
  }, [page, filter, search, selectedGroups, minDebt]);

  useEffect(() => {
    fetchCustomers();
    fetch("/api/templates")
      .then((r) => r.json())
      .then(setTemplates);
  }, [fetchCustomers]);

  const toggleGroup = (groupName: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
    setPage(1);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === customers.length && customers.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map((c) => c.id)));
    }
  };

  const [showConfirm, setShowConfirm] = useState(false);

  const handleSendClick = async () => {
    if (selectedIds.size === 0) {
      toast.error("Lütfen en az bir müşteri seçin");
      return;
    }
    if (!selectedTemplate) {
      toast.error("Lütfen bir mesaj şablonu seçin");
      return;
    }
    try {
      const res = await fetch("/api/whatsapp");
      const data = await res.json();
      if (data.status !== "ready") {
        toast.error("WhatsApp bağlı değil! Lütfen önce Ayarlar sayfasından WhatsApp bağlantısını yapın.");
        return;
      }
    } catch {
      toast.error("WhatsApp durumu kontrol edilemedi.");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmSend = async () => {
    setShowConfirm(false);
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerIds: Array.from(selectedIds),
          templateId: selectedTemplate,
        }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(
          `${data.sent} mesaj gönderildi, ${data.failed} başarısız.`
        );
        setSelectedIds(new Set());
      }
    } catch {
      toast.error("Mesaj gönderimi sırasında hata oluştu");
    } finally {
      setSending(false);
    }
  };

  const previewTemplate = templates.find((t) => t.id === selectedTemplate);
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mesaj Gönder</h2>
        <p className="text-muted-foreground">
          Müşterilere WhatsApp mesajı gönderin
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Customer Selection */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {statusFilters.map((f) => (
              <Button
                key={f.value}
                variant={filter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                  setSelectedIds(new Set());
                }}
              >
                {f.label}
              </Button>
            ))}

            {/* Çoklu Grup Filtresi */}
            <div className="relative" ref={dropdownRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGroupDropdownOpen(!groupDropdownOpen)}
              >
                Gruplar
                {selectedGroups.size > 0 && (
                  <Badge variant="secondary" className="ml-1.5">
                    {selectedGroups.size}
                  </Badge>
                )}
              </Button>
              {groupDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-64 overflow-auto rounded-lg border bg-card shadow-lg">
                  <div className="p-2 border-b">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        setSelectedGroups(new Set());
                        setPage(1);
                        setSelectedIds(new Set());
                      }}
                    >
                      Seçimi Temizle
                    </Button>
                  </div>
                  <div className="p-1">
                    {groups.map((g) => (
                      <label
                        key={g.filo_group}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroups.has(g.filo_group)}
                          onChange={() => toggleGroup(g.filo_group)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm flex-1 truncate">
                          {g.filo_group}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {g.count}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Seçili gruplar badge */}
            {selectedGroups.size > 0 && (
              <div className="flex flex-wrap gap-1">
                {Array.from(selectedGroups).map((g) => (
                  <Badge
                    key={g}
                    variant="secondary"
                    className="text-xs cursor-pointer"
                    onClick={() => toggleGroup(g)}
                  >
                    {g} ×
                  </Badge>
                ))}
              </div>
            )}

            <Input
              placeholder="İsim, telefon veya şehir..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="max-w-xs ml-auto"
            />
          </div>

          {/* Minimum Borç Filtresi */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Min. borç:</span>
            {[0, 500, 1000, 5000, 10000, 25000].map((amount) => (
              <Button
                key={amount}
                variant={minDebt === amount ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setMinDebt(amount);
                  setPage(1);
                  setSelectedIds(new Set());
                }}
              >
                {amount === 0
                  ? "Hepsi"
                  : `${amount.toLocaleString("tr-TR")} TL`}
              </Button>
            ))}
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="Özel tutar..."
                className="w-32"
                value={minDebt || ""}
                onChange={(e) => {
                  setMinDebt(Number(e.target.value) || 0);
                  setPage(1);
                  setSelectedIds(new Set());
                }}
              />
              <span className="text-sm text-muted-foreground">TL</span>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {total} müşteri listeleniyor
                </CardTitle>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {selectedIds.size === customers.length && customers.length > 0
                    ? "Seçimi Kaldır"
                    : "Tümünü Seç"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Seç</TableHead>
                    <TableHead>Müşteri</TableHead>
                    <TableHead>Telefon</TableHead>
                    {activeSource === "siber" ? (
                      <>
                        <TableHead className="text-right">Toplam Borç</TableHead>
                        <TableHead className="text-right">Toplam Alacak</TableHead>
                        <TableHead className="text-right">Tarihli Bakiye</TableHead>
                        <TableHead className="text-right">Son Durum</TableHead>
                        <TableHead className="text-right">Toplam Risk</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="text-right">Borç</TableHead>
                        <TableHead className="text-right">Vadesi Geçmiş</TableHead>
                        <TableHead>Şehir</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => toggleSelect(c.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="w-4 h-4 rounded cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className={`text-sm ${c.phone.startsWith("905") ? "" : "text-red-500"}`}>{c.phone}</TableCell>
                      {activeSource === "siber" ? (
                        <>
                          <TableCell className="text-right text-orange-600">
                            {formatMoney(c.total_debt)} TL
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            {formatMoney(c.toplam_alacak)} TL
                          </TableCell>
                          <TableCell className="text-right text-orange-600">
                            {formatMoney(c.tarihli_bakiye)} TL
                          </TableCell>
                          <TableCell className="text-right text-red-600 font-medium">
                            {formatMoney(c.son_durum)} TL
                          </TableCell>
                          <TableCell className="text-right text-purple-600">
                            {formatMoney(c.toplam_risk)} TL
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-right text-orange-600">
                            {formatMoney(c.total_debt)} TL
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {formatMoney(c.overdue_debt)} TL
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {c.city}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                  {customers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={activeSource === "siber" ? 8 : 6} className="text-center py-8">
                        <p className="text-muted-foreground">
                          Bu filtreye uygun müşteri bulunamadı
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

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

        {/* Right: Template & Send */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mesaj Şablonu</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTemplate === t.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/30"
                  }`}
                  onClick={() => setSelectedTemplate(t.id)}
                >
                  <p className="font-medium text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {t.body}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {previewTemplate && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mesaj Önizleme</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">
                    {previewTemplate.body
                      .replace("{isim}", "Ahmet Yılmaz")
                      .replace("{tutar}", "5.000,00")
                      .replace("{vadeli_borc}", "3.200,00")}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Seçili müşteri:</span>
                  <Badge>{selectedIds.size}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Şablon:</span>
                  <span className="font-medium">
                    {previewTemplate?.name || "Seçilmedi"}
                  </span>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSendClick}
                  disabled={
                    sending || selectedIds.size === 0 || !selectedTemplate
                  }
                >
                  {sending
                    ? "Gönderiliyor..."
                    : `${selectedIds.size} Kişiye WhatsApp Gönder`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Onay Modalı */}
      {showConfirm && previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Mesaj Gönderim Onayı</h3>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gönderilecek kişi sayısı:</span>
                <span className="font-bold text-lg">{selectedIds.size} kişi</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Şablon:</span>
                <span className="font-medium">{previewTemplate.name}</span>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Gönderilecek mesaj:</p>
              <p className="text-sm whitespace-pre-wrap">
                {previewTemplate.body
                  .replace("{isim}", "Müşteri Adı")
                  .replace("{tutar}", "X.XXX,XX")
                  .replace("{vadeli_borc}", "X.XXX,XX")}
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                <strong>{selectedIds.size}</strong> kişiye WhatsApp mesajı gönderilecektir. Bu işlem geri alınamaz.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowConfirm(false)}
              >
                İptal
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirmSend}
              >
                Onaylıyorum, Gönder
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
