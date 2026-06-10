"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function UttsSettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [editing, setEditing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [uyumsoftServiceUrl, setUyumsoftServiceUrl] = useState("");
  const [uyumsoftUsername, setUyumsoftUsername] = useState("");
  const [uyumsoftPassword, setUyumsoftPassword] = useState("");
  const [uyumsoftVknTckn, setUyumsoftVknTckn] = useState("");
  const [uyumsoftHasCredentials, setUyumsoftHasCredentials] = useState(false);
  const [uyumsoftLastTestAt, setUyumsoftLastTestAt] = useState("");
  const [uyumsoftLastTestSuccess, setUyumsoftLastTestSuccess] = useState(false);
  const [uyumsoftLastTestMessage, setUyumsoftLastTestMessage] = useState("");
  const [uyumsoftEditing, setUyumsoftEditing] = useState(false);
  const [testingUyumsoft, setTestingUyumsoft] = useState(false);

  useEffect(() => {
    fetch("/api/utts/settings")
      .then((r) => r.json())
      .then((data) => {
        setEmail(data.email || "");
        setPassword(data.password || "");
        setHasCredentials(Boolean(data.hasCredentials));
        setIsConnected(Boolean(data.isConnected));
        setTokenExpiresAt(data.tokenExpiresAt || "");
        setEditing(!data.hasCredentials);
      })
      .catch(() => {});

    fetch("/api/uyumsoft/settings")
      .then((r) => r.json())
      .then((data) => {
        setUyumsoftServiceUrl(data.serviceUrl || "");
        setUyumsoftUsername(data.username || "");
        setUyumsoftPassword(data.password || "");
        setUyumsoftVknTckn(data.vknTckn || "");
        setUyumsoftHasCredentials(Boolean(data.hasCredentials));
        setUyumsoftLastTestAt(data.lastTestAt || "");
        setUyumsoftLastTestSuccess(Boolean(data.lastTestSuccess));
        setUyumsoftLastTestMessage(data.lastTestMessage || "");
        setUyumsoftEditing(!data.hasCredentials);
      })
      .catch(() => {});
  }, []);

  const login = async () => {
    if (!email || !password) {
      toast.error("UTTS e-posta ve şifre bilgisi gerekli");
      return;
    }

    setLoggingIn(true);
    try {
      const res = await fetch("/api/utts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        toast.error(data.error || "UTTS girişi başarısız");
        return;
      }

      setHasCredentials(true);
      setIsConnected(true);
      setEditing(false);
      if (data.expiresIn) {
        setTokenExpiresAt(String(Date.now() + (Number(data.expiresIn) - 30) * 1000));
      }
      toast.success("UTTS bilgileri kaydedildi ve bağlantı başarılı");
    } catch {
      toast.error("UTTS bağlantısı sırasında hata oluştu");
    } finally {
      setLoggingIn(false);
    }
  };

  const testUyumsoft = async () => {
    if (!uyumsoftUsername || !uyumsoftPassword) {
      toast.error("Uyumsoft kullanıcı adı ve şifre bilgisi gerekli");
      return;
    }

    setTestingUyumsoft(true);
    try {
      const res = await fetch("/api/uyumsoft/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceUrl: uyumsoftServiceUrl,
          username: uyumsoftUsername,
          password: uyumsoftPassword,
          vknTckn: uyumsoftVknTckn,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error || !data.success) {
        const message = data.error || data.message || "Uyumsoft bağlantısı başarısız";
        setUyumsoftLastTestSuccess(false);
        setUyumsoftLastTestMessage(message);
        setUyumsoftLastTestAt(new Date().toISOString());
        toast.error(message);
        return;
      }

      setUyumsoftHasCredentials(true);
      setUyumsoftLastTestSuccess(true);
      setUyumsoftLastTestMessage(data.message || "Uyumsoft bağlantısı başarılı");
      setUyumsoftLastTestAt(new Date().toISOString());
      setUyumsoftEditing(false);
      toast.success(data.message || "Uyumsoft bağlantısı başarılı");
    } catch {
      const message = "Uyumsoft bağlantısı sırasında hata oluştu";
      setUyumsoftLastTestSuccess(false);
      setUyumsoftLastTestMessage(message);
      setUyumsoftLastTestAt(new Date().toISOString());
      toast.error(message);
    } finally {
      setTestingUyumsoft(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">UTTS Ayarları</h2>
          <p className="text-muted-foreground">
            UTTS portal giriş bilgilerini bu bilgisayarda saklayın ve bağlantıyı test edin.
          </p>
        </div>
        <Badge variant={isConnected ? "default" : hasCredentials ? "secondary" : "secondary"}>
          {isConnected
            ? "Bağlantı Aktif"
            : hasCredentials
            ? "Bilgiler Kayıtlı"
            : "Bilgi Bekleniyor"}
        </Badge>
      </div>

      <div className="max-w-xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Bağlantı Durumu</CardTitle>
              {hasCredentials && !editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Bilgileri Düzenle
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasCredentials && !editing ? (
              <>
                <div className="rounded-lg border bg-green-50 p-4 text-green-800">
                  <p className="font-medium">
                    {isConnected
                      ? "UTTS bağlantısı aktif."
                      : "UTTS bilgileri kayıtlı, bağlantı yenilenebilir."}
                  </p>
                  <p className="mt-1 text-sm">
                    Kayıtlı hesap: <span className="font-medium">{email}</span>
                  </p>
                  {tokenExpiresAt && Number(tokenExpiresAt) > 0 && (
                    <p className="mt-1 text-xs">
                      Oturum geçerlilik zamanı:{" "}
                      {new Date(Number(tokenExpiresAt)).toLocaleString("tr-TR")}
                    </p>
                  )}
                </div>
                <Button onClick={login} disabled={loggingIn} className="w-full">
                  {loggingIn ? "Bağlantı Yenileniyor..." : "Bağlantıyı Test Et / Yenile"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>E-posta</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="kullanici@example.com"
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Şifre</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="UTTS şifresi"
                    autoComplete="current-password"
                  />
                </div>
                <div className="flex gap-2">
                  {hasCredentials && (
                    <Button
                      variant="outline"
                      onClick={() => setEditing(false)}
                      className="flex-1"
                    >
                      Vazgeç
                    </Button>
                  )}
                  <Button onClick={login} disabled={loggingIn} className="flex-1">
                    {loggingIn ? "Bağlanıyor..." : "Bilgileri Kaydet ve Test Et"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Uyumsoft Web Servis</CardTitle>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    uyumsoftLastTestSuccess
                      ? "default"
                      : uyumsoftHasCredentials
                      ? "secondary"
                      : "secondary"
                  }
                >
                  {uyumsoftLastTestSuccess
                    ? "Bağlantı Başarılı"
                    : uyumsoftHasCredentials
                    ? "Bilgiler Kayıtlı"
                    : "Bilgi Bekleniyor"}
                </Badge>
                {uyumsoftHasCredentials && !uyumsoftEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUyumsoftEditing(true)}
                  >
                    Bilgileri Düzenle
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {uyumsoftHasCredentials && !uyumsoftEditing ? (
              <>
                <div
                  className={`rounded-lg border p-4 ${
                    uyumsoftLastTestSuccess
                      ? "bg-green-50 text-green-800"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="font-medium">
                    {uyumsoftLastTestSuccess
                      ? "Uyumsoft web servis bağlantısı başarılı."
                      : "Uyumsoft bilgileri kayıtlı, bağlantı tekrar test edilebilir."}
                  </p>
                  <p className="mt-1 text-sm">
                    Kayıtlı kullanıcı:{" "}
                    <span className="font-medium">{uyumsoftUsername}</span>
                  </p>
                  <p className="mt-1 text-xs">Servis: {uyumsoftServiceUrl}</p>
                  {uyumsoftVknTckn && (
                    <p className="mt-1 text-xs">VKN/TCKN: {uyumsoftVknTckn}</p>
                  )}
                  {uyumsoftLastTestMessage && (
                    <p className="mt-2 text-sm">{uyumsoftLastTestMessage}</p>
                  )}
                  {uyumsoftLastTestAt && (
                    <p className="mt-1 text-xs">
                      Son test:{" "}
                      {new Date(uyumsoftLastTestAt).toLocaleString("tr-TR")}
                    </p>
                  )}
                </div>
                <Button
                  onClick={testUyumsoft}
                  disabled={testingUyumsoft}
                  className="w-full"
                >
                  {testingUyumsoft
                    ? "Uyumsoft Bağlantısı Test Ediliyor..."
                    : "Bağlantıyı Test Et / Yenile"}
                </Button>
              </>
            ) : (
              <>
                {uyumsoftLastTestMessage && (
                  <div
                    className={`rounded-lg border p-4 ${
                      uyumsoftLastTestSuccess
                        ? "bg-green-50 text-green-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    <p className="font-medium">{uyumsoftLastTestMessage}</p>
                    {uyumsoftLastTestAt && (
                      <p className="mt-1 text-xs">
                        Son test:{" "}
                        {new Date(uyumsoftLastTestAt).toLocaleString("tr-TR")}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Web Servis Adresi</Label>
                  <Input
                    value={uyumsoftServiceUrl}
                    onChange={(e) => setUyumsoftServiceUrl(e.target.value)}
                    placeholder="https://efatura.uyumsoft.com.tr/Services/Integration"
                    autoComplete="off"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Kullanıcı Adı</Label>
                    <Input
                      value={uyumsoftUsername}
                      onChange={(e) => setUyumsoftUsername(e.target.value)}
                      placeholder="Web servis kullanıcı adı"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Şifre</Label>
                    <Input
                      type="password"
                      value={uyumsoftPassword}
                      onChange={(e) => setUyumsoftPassword(e.target.value)}
                      placeholder="Web servis şifresi"
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>VKN / TCKN</Label>
                  <Input
                    value={uyumsoftVknTckn}
                    onChange={(e) => setUyumsoftVknTckn(e.target.value)}
                    placeholder="Firma VKN/TCKN"
                    autoComplete="off"
                  />
                </div>

                <div className="flex gap-2">
                  {uyumsoftHasCredentials && (
                    <Button
                      variant="outline"
                      onClick={() => setUyumsoftEditing(false)}
                      className="flex-1"
                    >
                      Vazgeç
                    </Button>
                  )}
                  <Button
                    onClick={testUyumsoft}
                    disabled={testingUyumsoft}
                    className="flex-1"
                  >
                    {testingUyumsoft
                      ? "Test Ediliyor..."
                      : "Bilgileri Kaydet ve Test Et"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
