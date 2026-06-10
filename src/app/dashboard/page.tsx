"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DashboardData {
  customerStats: {
    total: number;
    with_debt: number;
    with_overdue: number;
    with_phone: number;
    sendable: number;
    positive_debt_sum: number;
    overdue_debt_sum: number;
  };
  messageStats: {
    total: number;
    sent: number;
    failed: number;
  };
  recentMessages: {
    id: number;
    customer_name: string;
    phone: string;
    status: string;
    sent_at: string;
    body: string;
  }[];
  lastUpload: {
    filename: string;
    imported_rows: number;
    uploaded_at: string;
  } | null;
}

function formatMoney(n: number) {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error("Dashboard fetch error:", err));
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    );
  }

  const { customerStats, messageStats, lastUpload, recentMessages } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">Genel bakış ve özet bilgiler</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam Müşteri
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customerStats.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {customerStats.with_phone || 0} telefon kayıtlı
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Borçlu Müşteri
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {customerStats.with_debt || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Toplam: {formatMoney(customerStats.positive_debt_sum || 0)} TL
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vadesi Geçmiş
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              {customerStats.with_overdue || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Toplam: {formatMoney(customerStats.overdue_debt_sum || 0)} TL
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gönderilen Mesaj
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {messageStats.sent || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {messageStats.failed || 0} başarısız
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mesaj Gönderilebilir</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-blue-600">
              {customerStats.sendable || 0}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Borcu olan ve telefon numarası kayıtlı müşteri sayısı
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Son CSV Yüklemesi</CardTitle>
          </CardHeader>
          <CardContent>
            {lastUpload ? (
              <div className="space-y-2">
                <p className="font-medium">{lastUpload.filename}</p>
                <p className="text-sm text-muted-foreground">
                  {lastUpload.imported_rows} kayıt içe aktarıldı
                </p>
                <p className="text-xs text-muted-foreground">
                  {lastUpload.uploaded_at}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Henüz CSV yüklemesi yapılmadı
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {recentMessages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Son Gönderilen Mesajlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-center justify-between border-b pb-3 last:border-0"
                >
                  <div>
                    <p className="font-medium text-sm">{msg.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{msg.phone}</p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={msg.status === "sent" ? "default" : "destructive"}
                    >
                      {msg.status === "sent" ? "Gönderildi" : "Başarısız"}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {msg.sent_at}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
