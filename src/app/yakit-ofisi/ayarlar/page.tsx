"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageHeader, fmtDate } from "../shared";

type Settings = {
  baseUrl: string;
  hasKey: boolean;
  keyHint: string;
  lastTest: { at: number; ok: boolean; message: string; accountType?: string; userName?: string } | null;
};

export default function YakitOfisiAyarlarPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (data: Settings) => {
    setS(data);
    setBaseUrl(data.baseUrl);
  };

  useEffect(() => {
    fetch("/api/yakit-ofisi/settings")
      .then((r) => r.json())
      .then(apply)
      .catch(() => toast.error("Ayarlar okunamadı"));
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/yakit-ofisi/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kaydedilemedi");
      apply(data);
      setApiKey("");
      if (data.test) {
        if (data.test.ok) toast.success("Yakıt Ofisi bağlantısı başarılı");
        else toast.error(data.test.message);
      } else {
        toast.success("Kaydedildi");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!confirm("Kayıtlı Yakıt Ofisi anahtarı portaldan silinsin mi? (Yakıt Ofisi'ndeki anahtar iptal edilmez.)")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/yakit-ofisi/settings", { method: "DELETE" });
      apply(await res.json());
      toast.success("Anahtar portaldan silindi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Bağlantı Ayarları" description="Yakıt Ofisi API anahtarı ve panel adresi." />

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Durum</CardTitle>
          {s?.lastTest ? (
            <Badge variant={s.lastTest.ok ? "default" : "destructive"}>{s.lastTest.ok ? "Bağlı" : "Hata"}</Badge>
          ) : (
            <Badge variant="secondary">{s?.hasKey ? "Denenmedi" : "Anahtar yok"}</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            Kayıtlı anahtar: <span className="font-mono">{s?.hasKey ? s.keyHint : "—"}</span>
          </p>
          {s?.lastTest && (
            <>
              <p>
                Son deneme: {fmtDate(new Date(s.lastTest.at).toISOString(), true)} · {s.lastTest.message}
              </p>
              {s.lastTest.ok && (
                <p>
                  Kullanıcı: {s.lastTest.userName || "—"} · Hesap tipi: {s.lastTest.accountType || "—"}
                </p>
              )}
            </>
          )}
          {s?.hasKey && (
            <div className="flex gap-2 pt-3">
              <Button variant="outline" disabled={busy} onClick={() => post({ action: "test" })}>
                Bağlantıyı Dene
              </Button>
              <Button variant="outline" disabled={busy} onClick={removeKey}>
                Anahtarı Sil
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{s?.hasKey ? "Anahtarı Değiştir" : "Anahtar Gir"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="yo-base">Panel adresi</Label>
            <Input id="yo-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ozciftci.yakitofisi.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yo-key">API anahtarı</Label>
            <Input
              id="yo-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pk_live_…"
            />
            <p className="text-xs text-muted-foreground">
              Yakıt Ofisi → profil → API Anahtarları → Oluştur. Etiket olarak örn. &quot;Çark Petrol Portal&quot; yazın.
              Anahtar yalnız bir kez gösterilir; buraya yapıştırıp kaydedin. Portal anahtarın tamamını bir daha göstermez.
            </p>
          </div>
          <Button disabled={busy || (!apiKey.trim() && baseUrl === s?.baseUrl)} onClick={() => post({ apiKey, baseUrl })}>
            Kaydet ve Dene
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Güvenlik</p>
          <p>Portal Yakıt Ofisi&apos;nden yalnız veri okur; kayıt, değiştirme ya da silme isteği göndermez.</p>
          <p>
            En sağlamı, anahtarı Yakıt Ofisi&apos;nde yalnız görüntüleme yetkisi olan ayrı bir kullanıcıyla oluşturmak:
            anahtar bir şekilde sızsa bile Yakıt Ofisi&apos;nde hiçbir şey değiştirilemez.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
