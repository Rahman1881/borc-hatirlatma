"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText, isEmulator, loginWithEmail, loginWithPin } from "@/lib/cark-mobil/firebase";
import { useCark } from "./store";

// Giriş kapısı: mobil uygulamadaki yönetici hesabıyla (kullanıcı adı + PIN ya da e-posta) girilir.
export function CarkGate({ children }: { children: ReactNode }) {
  const { phase, deniedReason } = useCark();
  const [method, setMethod] = useState<"pin" | "email">("pin");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (phase === "ready") return <>{children}</>;
  if (phase === "loading") {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Çark Mobil&apos;e bağlanılıyor…
        </span>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (method === "pin") await loginWithPin(username, pin);
      else await loginWithEmail(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Smartphone className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold">Çark Mobil</h1>
            <p className="text-xs text-muted-foreground">Mobil uygulamadaki yönetici hesabınızla girin</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          {(["pin", "email"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-md py-1.5 ${method === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "pin" ? "Kullanıcı adı + PIN" : "E-posta"}
            </button>
          ))}
        </div>

        {method === "pin" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="cm-user">Kullanıcı adı</Label>
              <Input id="cm-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-pin">PIN (6 rakam)</Label>
              <Input
                id="cm-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="cm-email">E-posta</Label>
              <Input id="cm-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-pass">Şifre</Label>
              <Input
                id="cm-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </>
        )}

        {(error || (phase === "denied" && deniedReason)) && (
          <p className="text-sm font-medium text-red-600">{error || deniedReason}</p>
        )}

        <Button type="submit" className="h-10 w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Giriş yap
        </Button>
        {isEmulator && <p className="text-center text-xs text-amber-600">Deneme ortamı (yerel emülatör)</p>}
      </form>
    </div>
  );
}
