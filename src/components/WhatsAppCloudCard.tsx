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
// penceresiyle aynı numara API'ye de bağlanır.

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

type SignupData = { waba_id?: string; phone_number_id?: string; business_id?: string };

type FBLoginResponse = { status?: string; authResponse?: { code?: string } | null };
type FBSdk = {
  init: (o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (cb: (r: FBLoginResponse) => void, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FBSdk;
    fbAsyncInit?: () => void;
  }
}

const GRAPH_VERSION = "v26.0";

function fmt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return isNaN(d.getTime()) ? iso : d.toLocaleString("tr-TR");
}

export default function WhatsAppCloudCard() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [editingSecret, setEditingSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  // Embedded Signup iki ayrı yoldan sonuç verir: pencere mesajı (hesap/numara kimlikleri)
  // ve FB.login geri çağrısı (tek kullanımlık kod, ~30 sn geçerli). İkisi de gelince
  // sunucuya gönderilir.
  const signup = useRef<{ data?: SignupData; code?: string; sent?: boolean; timer?: ReturnType<typeof setTimeout> }>({});

  const load = useCallback(() => {
    fetch("/api/whatsapp-cloud")
      .then((r) => r.json())
      .then((d) => !d.error && setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Facebook JS SDK — yalnız bu kart açıkken yüklenir.
  useEffect(() => {
    if (!status?.appId) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: status.appId, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION });
      setSdkReady(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(s);
    }
  }, [status?.appId]);

  // force: pencere mesajı gelmese de yalnız kodla gönderilir; hesap sunucuda koddan bulunur.
  const trySend = useCallback(async (force = false) => {
    const st = signup.current;
    if (st.sent || !st.code || (!st.data?.waba_id && !force)) return;
    st.sent = true;
    clearTimeout(st.timer);
    try {
      const r = await fetch("/api/whatsapp-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          code: st.code,
          wabaId: st.data?.waba_id,
          phoneNumberId: st.data?.phone_number_id,
          businessId: st.data?.business_id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Bağlantı tamamlanamadı.");
      setStatus(d);
      toast.success("WhatsApp numarası resmi API'ye bağlandı.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bağlantı tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      let msg: { type?: string; event?: string; data?: SignupData & { current_step?: string; error_message?: string } };
      try {
        msg = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (msg?.type !== "WA_EMBEDDED_SIGNUP") return;
      console.info("[WA signup]", msg.event, msg.data);
      if (msg.event?.startsWith("FINISH")) {
        signup.current.data = msg.data;
        void trySend();
      } else if (msg.event === "CANCEL") {
        setBusy(false);
        toast.message(`Bağlantı yarıda bırakıldı${msg.data?.current_step ? ` (${msg.data.current_step})` : ""}.`);
      } else if (msg.event === "ERROR") {
        setBusy(false);
        toast.error(msg.data?.error_message || "Meta bağlantı penceresi hata verdi.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [trySend]);

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
    if (!window.FB || !status) return;
    setBusy(true);
    signup.current = {};
    window.FB.login(
      (response) => {
        console.info("[WA signup] login", response.status, Boolean(response.authResponse?.code));
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          toast.error("Meta penceresi bağlantı tamamlanmadan kapandı. Tekrar deneyin.");
          return;
        }
        signup.current.code = code;
        void trySend();
        // Kod ≈30 sn geçerli; hesap bilgisi mesajı birkaç saniyede gelmezse kodla devam edilir.
        signup.current.timer = setTimeout(() => void trySend(true), 4000);
      },
      {
        config_id: status.configId,
        response_type: "code",
        override_default_response_type: true,
        // Uygulamadaki numarayı uygulamadan çıkarmadan bağlar (coexistence).
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      }
    );
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
              <Button onClick={connect} disabled={busy || !sdkReady || !status.hasAppSecret}>
                {busy ? "Meta penceresi açık…" : "WhatsApp Business numarasını bağla"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {!status.hasAppSecret
                  ? "Önce App Secret'ı kaydedin."
                  : "Facebook penceresinde işletmenizi ve numaranızı seçin; telefondaki WhatsApp Business'tan onay istenecek. Bağlantıdan sonraki 24 saat içinde geçmiş sohbetler otomatik aktarılır."}
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
