"use client";

import Link from "next/link";
import { ArrowRight, FileText, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const quickLinks = [
  {
    href: "/utts/tracking",
    title: "Montaj Takip",
    description: "Günlük veya tarih aralığına göre işlem adetleri ve dağılımları izleyin.",
    icon: TrendingUp,
  },
  {
    href: "/utts/billing",
    title: "Faturalandırma",
    description: "UTTS kayıtlarını kontrol edip Uyumsoft Excel formatına dönüştürün.",
    icon: FileText,
  },
];

export default function UttsOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">UTTS Paneli</h2>
        <p className="text-muted-foreground">
          UTTS montaj takibini ve faturalandırma hazırlığını tek panelden yönetin.
        </p>
      </div>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">Özet</TabsTrigger>
          <TabsTrigger value="workflow">İş Akışı</TabsTrigger>
          <TabsTrigger value="checks">Kontroller</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Montaj Takip
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">Aktif</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Günlük ve tarih aralığı bazlı takip ekranı
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Faturalandırma
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">Aktif</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Uyumsoft Excel formatına hazırlık ve alıcı düzeltme
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.href}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-base">{item.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <Link href={item.href} className={cn(buttonVariants(), "w-full")}>
                      Aç
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="workflow">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Önerilen UTTS Akışı</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {[
                  "UTTS ayarlarında giriş bilgilerini kaydet",
                  "Montaj Takip ekranında günlük işlemleri kontrol et",
                  "Faturalandırma ekranında adayları hazırla",
                  "Gerekli alıcı düzeltmelerini kaydedip Excel oluştur",
                ].map((item, index) => (
                  <div key={item} className="rounded-lg border p-3">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-muted font-semibold">
                      {index + 1}
                    </div>
                    <p className="text-sm">{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checks">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <FileText className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">Kontrol Başlıkları</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  "Günlük tamamlanan montajlar",
                  "Aktivasyon bekleyen araçlar",
                  "Fatura adayı kontrol listesi",
                  "Eksik VKN/TCKN ve alıcı bilgileri",
                  "Elle düzeltilen alıcı kayıtları",
                  "Uyumsoft Excel çıktısı",
                ].map((item) => (
                  <div key={item} className="rounded-lg border p-3 text-sm">
                    {item}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
