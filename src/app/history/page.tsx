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

interface Message {
  id: number;
  customer_name: string;
  phone: string;
  body: string;
  status: string;
  error: string | null;
  sent_at: string;
}

export default function HistoryPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch(`/api/messages?page=${page}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages);
        setTotal(data.total);
      });
  }, [page]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Gönderim Geçmişi
        </h2>
        <p className="text-muted-foreground">
          Gönderilen tüm WhatsApp mesajlarının kaydı
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Toplam {total} mesaj kaydı
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Mesaj</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Tarih</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((msg) => (
                <TableRow key={msg.id}>
                  <TableCell className="font-medium">
                    {msg.customer_name}
                  </TableCell>
                  <TableCell className="text-sm">{msg.phone}</TableCell>
                  <TableCell className="max-w-xs">
                    <p className="text-sm truncate">{msg.body}</p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        msg.status === "sent" ? "default" : "destructive"
                      }
                    >
                      {msg.status === "sent" ? "Gönderildi" : "Başarısız"}
                    </Badge>
                    {msg.error && (
                      <p className="text-xs text-red-500 mt-1">{msg.error}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {msg.sent_at}
                  </TableCell>
                </TableRow>
              ))}
              {messages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <p className="text-muted-foreground">
                      Henüz mesaj gönderilmedi
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
  );
}
