"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// Ayarlar → WhatsApp resmi API (Meta Cloud API, coexistence) bağlantısı.
// Numara telefondaki WhatsApp Business uygulamasında kalır; Meta'nın Embedded Signup
// sayfasıyla aynı numara API'ye de bağlanır.

type CloudStatus = {
  appId: string;
  configId: string;
  hasAppSecret: boolean;
  verifyToken: string;
  connected: boolean;
  wabaId: string;
  phoneNumberId: string;
  connectedAt: string;
  syncRequestedAt: string;
  syncResult: string;
  messageCount: number;
  lastWebhookAt: string;
};

const GRAPH_VERSION = "v26.0";

// Meta bağlantısı tam sayfa yönlendirmeyle yapılır: Facebook sayfası açılır, bitince
// ?code=… ile bu sayfaya döner. Kod, aynı redirect_uri ile sunucuda anahtara çevrilir.
// (JS SDK açılır penceresi kodu doğrulanamayan bir adrese bağlıyordu.)
const RETURN_PATH = "/settings";
const STATE_KEY = "wa-cloud-signup-state";

function readReturn(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  return q.has("state") && (q.has("code") || q.has("error")) ? q : null;
}

function fmt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return isNaN(d.getTime()) ? iso : d.toLocaleString("tr-TR");
}

export default function WhatsAppCloudCard() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [editingSecret, setEditingSecret] = useState(false);
  // Facebook'tan dönülmüşse bağlantı tamamlanana kadar düğme meşgul görünür.
  const [busy, setBusy] = useState(() => readReturn() !== null);
  const handled = useRef(false);
  // Facebook'tan dönüşteki hata kartta kalır (sayfa açılırken gösterilen bildirim kaybolabiliyor).
  const [returnError, setReturnError] = useState("");

  const load = useCallback(() => {
    fetch("/api/whatsapp-cloud")
      .then((r) => r.json())
      .then((d) => !d.error && setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Facebook'tan dönüş: kod ≈30 sn geçerli, hemen sunucuya gönderilir.
  useEffect(() => {
    const q = readReturn();
    if (!q || handled.current) return;
    handled.current = true;
    window.history.replaceState(null, "", RETURN_PATH);

    let expected: string | null = null;
    try {
      expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
    } catch {}

    const complete = async () => {
      try {
        if (q.has("error")) {
          throw new Error(q.get("error_description") || q.get("error_reason") || "Bağlantı yarıda bırakıldı.");
        }
        if (!expected || q.get("state") !== expected) {
          throw new Error("Bağlantı isteği bu tarayıcıdan başlatılmamış. Tekrar deneyin.");
        }
        const r = await fetch("/api/whatsapp-cloud", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "connect", code: q.get("code"), redirectUri: window.location.origin + RETURN_PATH }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Bağlantı tamamlanamadı.");
        setStatus(d);
        toast.success("WhatsApp numarası resmi API'ye bağlandı.");
      } catch (err) {
        setReturnError(err instanceof Error ? err.message : "Bağlantı tamamlanamadı.");
      } finally {
        setBusy(false);
      }
    };
    void complete();
  }, []);

  const saveSecret = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSecret", appSecret: secret }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Kaydedilemedi.");
      setStatus(d);
      setSecret("");
      setEditingSecret(false);
      toast.success("App Secret kaydedildi.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const connect = () => {
    if (!status) return;
    setBusy(true);
    setReturnError("");
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {}
    const params = new URLSearchParams({
      client_id: status.appId,
      config_id: status.configId,
      response_type: "code",
      override_default_response_type: "true",
      redirect_uri: window.location.origin + RETURN_PATH,
      state,
      // Uygulamadaki numarayı uygulamadan çıkarmadan bağlar (coexistence).
      extras: JSON.stringify({ setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }),
    });
    window.location.href = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
  };

  const finish = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Tamamlanamadı.");
      setStatus(d);
      toast.success("Kurulum tamamlandı.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Kopyalandı"));
  };

  if (!status) return null;
  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp-cloud/webhook` : "";
  const syncFailed = status.connected && (!status.syncResult || status.syncResult.includes("HATA"));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">WhatsApp Resmi API (Meta)</CardTitle>
          {status.connected ? (
            <Badge className="bg-green-600">Bağlı</Badge>
          ) : (
            <Badge variant="secondary">Bağlı Değil</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="text-muted-foreground">
          Numara telefondaki WhatsApp Business uygulamasında kalır; aynı numara Meta&apos;nın
          resmi API&apos;sine de bağlanır. Mesajlar hem telefonda hem panelde görünür.
        </p>

        {/* 1. App Secret */}
        <div className="space-y-2">
          <Label>1. App Secret</Label>
          {status.hasAppSecret && !editingSecret ? (
            <div className="flex items-center gap-3">
              <span className="text-green-700">Kayıtlı ✓</span>
              <Button variant="outline" size="sm" onClick={() => setEditingSecret(true)}>
                Değiştir
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Meta → App settings → Basic → App secret"
              />
              <Button onClick={saveSecret} disabled={busy || !secret.trim()}>
                Kaydet
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Sadece bu sunucuda saklanır, hiçbir ekranda tekrar gösterilmez.
          </p>
        </div>

        {/* 2. Webhook */}
        <div className="space-y-2">
          <Label>2. Webhook (Meta → WhatsApp → Configuration)</Label>
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="text-muted-foreground">Callback URL: </span>
                <code>{webhookUrl}</code>
              </span>
              <Button variant="outline" size="sm" onClick={() => copy(webhookUrl)}>
                Kopyala
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="text-muted-foreground">Verify token: </span>
                <code>{status.verifyToken}</code>
              </span>
              <Button variant="outline" size="sm" onClick={() => copy(status.verifyToken)}>
                Kopyala
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Son bildirim: {status.lastWebhookAt ? fmt(status.lastWebhookAt) : "henüz gelmedi"}
            </p>
          </div>
        </div>

        {/* 3. Bağlantı */}
        <div className="space-y-2">
          <Label>3. Numarayı bağla</Label>
          {status.connected ? (
            <div className="space-y-1 rounded-md border bg-muted/40 p-3">
              <p>
                <span className="text-muted-foreground">Hesap (WABA): </span>
                <code>{status.wabaId}</code>
              </p>
              <p>
                <span className="text-muted-foreground">Numara kimliği: </span>
                <code>{status.phoneNumberId}</code>
              </p>
              <p>
                <span className="text-muted-foreground">Bağlandı: </span>
                {fmt(status.connectedAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Geçmiş aktarımı: </span>
                {status.syncResult || "başlatılmadı"}
              </p>
              <p>
                <span className="text-muted-foreground">Kayıtlı mesaj: </span>
                {status.messageCount}
              </p>
              {syncFailed && (
                <Button variant="outline" size="sm" className="mt-2" onClick={finish} disabled={busy}>
                  Kurulumu tamamla (webhook aboneliği + geçmiş aktarımı)
                </Button>
              )}
            </div>
          ) : (
            <>
              <Button onClick={connect} disabled={busy || !status.hasAppSecret}>
                {busy ? "Bağlanıyor…" : "WhatsApp Business numarasını bağla"}
              </Button>
              {returnError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                  Bağlantı tamamlanamadı: {returnError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {!status.hasAppSecret
                  ? "Önce App Secret'ı kaydedin."
                  : "Facebook sayfasında işletmenizi ve numaranızı seçin; telefondaki WhatsApp Business'tan onay istenecek. Bağlantıdan sonraki 24 saat içinde geçmiş sohbetler otomatik aktarılır."}
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
