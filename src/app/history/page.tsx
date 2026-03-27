"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DateSummary {
  date: string;
  total: number;
  sent: number;
  failed: number;
  first_at: string;
  last_at: string;
}

interface Message {
  id: number;
  customer_name: string;
  phone: string;
  body: string;
  status: string;
  error: string | null;
  sent_at: string;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("tr-TR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(dateStr: string) {
  if (!dateStr) return "";
  const parts = dateStr.split(" ");
  return parts[1] || "";
}

export default function HistoryPage() {
  const [dates, setDates] = useState<DateSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedMsg, setExpandedMsg] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/messages?view=dates")
      .then((r) => r.json())
      .then((data) => setDates(data.dates || []));
  }, []);

  const openDate = async (date: string) => {
    setSelectedDate(date);
    setLoading(true);
    setExpandedMsg(null);
    try {
      const res = await fetch(`/api/messages?date=${date}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  // Tarih listesi görünümü
  if (!selectedDate) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Gönderim Geçmişi
          </h2>
          <p className="text-muted-foreground">
            Tarihe göre gönderim kayıtları
          </p>
        </div>

        {dates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                Henüz mesaj gönderilmedi
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {dates.map((d) => (
              <Card
                key={d.date}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => openDate(d.date)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-base">
                        {formatDate(d.date)}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {formatTime(d.first_at)} - {formatTime(d.last_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-2xl font-bold">{d.total}</p>
                        <p className="text-xs text-muted-foreground">mesaj</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Badge variant="default" className="text-xs">
                          {d.sent} gönderildi
                        </Badge>
                        {d.failed > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {d.failed} başarısız
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Mesaj detay görünümü
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)}>
          Geri
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {formatDate(selectedDate)}
          </h2>
          <p className="text-muted-foreground">
            {messages.length} mesaj kaydı
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Yükleniyor...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Müşteri</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Saat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((msg) => (
                  <>
                    <TableRow
                      key={msg.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        setExpandedMsg(expandedMsg === msg.id ? null : msg.id)
                      }
                    >
                      <TableCell className="font-medium">
                        {msg.customer_name}
                      </TableCell>
                      <TableCell className="text-sm">{msg.phone}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            msg.status === "sent" ? "default" : "destructive"
                          }
                        >
                          {msg.status === "sent" ? "Gönderildi" : "Başarısız"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatTime(msg.sent_at)}
                      </TableCell>
                    </TableRow>
                    {expandedMsg === msg.id && (
                      <TableRow key={`${msg.id}-detail`}>
                        <TableCell colSpan={4} className="bg-muted/30">
                          <div className="py-2 space-y-2">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <p className="text-xs text-muted-foreground mb-1">Gönderilen mesaj:</p>
                              <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                            </div>
                            {msg.error && (
                              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <p className="text-xs text-red-600 font-medium mb-1">Hata:</p>
                                <p className="text-sm text-red-700">{msg.error}</p>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
