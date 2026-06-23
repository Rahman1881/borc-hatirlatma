"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, User, BarChart3, TrendingUp, Users, Fuel, RotateCcw } from "lucide-react";

type Msg = { role: "user" | "ai"; text: string };

const STORAGE_KEY = "carkpetrol_ai_chat";

const WELCOME: Msg = {
  role: "ai",
  text: "Merhaba Patron! Ben Çark Petrol AI asistanınım. İstasyonun satışları, kârlılığı, vardiyalar, market veya müşteriler hakkında istediğini sorabilirsin. Aşağıdaki örneklerden biriyle başlayabilirsin.",
};

const suggestions = [
  { icon: TrendingUp, text: "Bu hafta kârım neden değişti?" },
  { icon: Fuel, text: "Hangi yakıttan en çok kazanıyorum?" },
  { icon: Users, text: "En yoğun saatler hangileri?" },
  { icon: BarChart3, text: "Market cirosunu geçen ayla karşılaştır" },
];

export default function SohbetPage() {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  // Sayfa açılınca kayıtlı sohbeti yükle (menü gezme / yenileme sonrası korunur).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Msg[];
        if (Array.isArray(saved) && saved.length > 0) setMessages(saved);
      }
    } catch {
      // bozuk kayıt — yok say
    }
    loadedRef.current = true;
  }, []);

  // Sohbet her değiştiğinde sakla (ilk yükleme tamamlanmadan yazma).
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // depolama dolu/erişilemez — yok say
    }
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function resetChat() {
    setMessages([WELCOME]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // yok say
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || typing) return;

    const history = [...messages, { role: "user" as const, text: q }];
    setMessages(history);
    setInput("");
    setTyping(true);

    // Geçmişi Gemini formatına çevir (ilk karşılama mesajını atla, ai -> model).
    const payload = history
      .slice(1)
      .map((m) => ({ role: m.role === "ai" ? "model" : "user", text: m.text }));

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI cevabı alınamadı.");
      setMessages((m) => [...m, { role: "ai", text: data.reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu.";
      setMessages((m) => [
        ...m,
        { role: "ai", text: `⚠️ ${msg}` },
      ]);
    } finally {
      setTyping(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {messages.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={resetChat}
            className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Yeni Sohbet
          </button>
        </div>
      )}
      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "ai" && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                <Sparkles className="h-5 w-5" />
              </span>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card"
              }`}
            >
              {m.text}
            </div>
            {m.role === "user" && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <User className="h-5 w-5" />
              </span>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="flex items-center gap-1.5 rounded-2xl border bg-card px-4 py-4">
              <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.2s]" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.4s]" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length <= 1 && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {suggestions.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.text}
                onClick={() => send(s.text)}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted"
              >
                <Icon className="h-4 w-4 text-orange-500" />
                {s.text}
              </button>
            );
          })}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 rounded-xl border bg-card p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="İşletmenle ilgili bir şey sor… (örn. dünkü vardiya kârı)"
          className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!input.trim()}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Çark Petrol AI örnek verilerle çalışıyor · Gerçek cevaplar için SiberPet &
        Uyumsoft entegrasyonu Ayarlar&apos;dan bağlanır.
      </p>
    </div>
  );
}
