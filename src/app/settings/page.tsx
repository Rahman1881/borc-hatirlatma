"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface WAState {
  status: "disconnected" | "qr" | "loading" | "ready";
  qrDataUrl: string | null;
  info: { pushname: string; wid: string } | null;
}

export default function SettingsPage() {
  const [waState, setWaState] = useState<WAState>({
    status: "disconnected",
    qrDataUrl: null,
    info: null,
  });
  const [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const fetchStatus = useCallback(() => {
    fetch("/api/whatsapp")
      .then((r) => r.json())
      .then(setWaState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
    // Poll status every 3 seconds when not ready
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.business_name) setBusinessName(data.business_name);
      });
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      toast.success("WhatsApp bağlantısı başlatılıyor...");
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    // UI'ı hemen güncelle, API cevabını bekleme
    setWaState({ status: "disconnected", qrDataUrl: null, info: null });
    try {
      await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      toast.success("WhatsApp bağlantısı kesildi");
    } catch {
      toast.error("Bağlantı kesme hatası");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Ayarlar kaydedildi");
      } else {
        toast.error("Kaydetme sırasında hata oluştu");
      }
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = () => {
    switch (waState.status) {
      case "ready":
        return <Badge className="bg-green-600">Bağlı</Badge>;
      case "qr":
        return <Badge className="bg-yellow-600">QR Kod Bekleniyor</Badge>;
      case "loading":
        return <Badge className="bg-blue-600">Yükleniyor...</Badge>;
      default:
        return <Badge variant="secondary">Bağlı Değil</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ayarlar</h2>
        <p className="text-muted-foreground">
          WhatsApp bağlantısı ve işletme ayarları
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* WhatsApp Connection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">WhatsApp Bağlantısı</CardTitle>
              {statusBadge()}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {waState.status === "disconnected" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Mesaj göndermek için WhatsApp Web&apos;e bağlanmanız gerekiyor.
                  Bağlan butonuna basıp, ekrandaki QR kodu telefonunuzdan okutun.
                </p>
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting ? "Başlatılıyor..." : "WhatsApp'a Bağlan"}
                </Button>
              </div>
            )}

            {waState.status === "qr" && waState.qrDataUrl && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Telefonunuzda WhatsApp &gt; Bağlı Cihazlar &gt; Cihaz Bağla yolunu
                  izleyip aşağıdaki QR kodu okutun.
                </p>
                <div className="flex justify-center p-4 bg-white rounded-lg border">
                  <img
                    src={waState.qrDataUrl}
                    alt="WhatsApp QR Kod"
                    width={300}
                    height={300}
                  />
                </div>
                <Button variant="outline" onClick={handleDisconnect}>
                  İptal
                </Button>
              </div>
            )}

            {waState.status === "loading" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    WhatsApp&apos;a bağlanılıyor...
                  </p>
                </div>
              </div>
            )}

            {waState.status === "ready" && (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                  <p className="text-sm font-medium text-green-800">
                    WhatsApp bağlı ve mesaj göndermeye hazır!
                  </p>
                  {waState.info && (
                    <div className="text-sm text-green-700 space-y-1">
                      <p>Hesap: {waState.info.pushname}</p>
                      <p>Numara: {waState.info.wid}</p>
                    </div>
                  )}
                </div>
                <Button variant="destructive" onClick={handleDisconnect}>
                  Bağlantıyı Kes
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Business Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">İşletme Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>İşletme Adı</Label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Petrol Ofisi İstasyonu"
              />
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Kaydediliyor..." : "Ayarları Kaydet"}
        </Button>

        {/* Usage Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kullanım Bilgisi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Nasıl Çalışır:</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Yukarıdaki &quot;WhatsApp&apos;a Bağlan&quot; butonuna tıklayın</li>
                <li>Ekrandaki QR kodu telefonunuzla okutun</li>
                <li>Bağlantı sağlandıktan sonra mesaj gönderebilirsiniz</li>
                <li>Bağlantı oturum bilgisi kaydedilir, her seferinde QR okutmanız gerekmez</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                Not: Ban riskini azaltmak için mesajlar arasında otomatik gecikme uygulanır.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
