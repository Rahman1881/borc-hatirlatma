"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  User,
  BarChart3,
  TrendingUp,
  Users,
  Fuel,
  Plus,
  Trash2,
  MessageSquare,
  History,
} from "lucide-react";

type Msg = { role: "user" | "ai"; text: string };
type Conversation = { id: number; title: string; updated_at: string };

const WELCOME =
  "Merhaba Patron! Ben Çark Petrol AI asistanınım. İstasyonun satışları, kârlılığı, vardiyalar, market veya müşteriler hakkında istediğini sorabilirsin. Aşağıdaki örneklerden biriyle başlayabilirsin.";

const suggestions = [
  { icon: TrendingUp, text: "Bu hafta kârım neden değişti?" },
  { icon: Fuel, text: "Hangi yakıttan en çok kazanıyorum?" },
  { icon: Users, text: "En yoğun saatler hangileri?" },
  { icon: BarChart3, text: "Market cirosunu geçen ayla karşılaştır" },
];

export default function SohbetPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/conversations");
      const d = await r.json();
      if (Array.isArray(d.conversations)) setConversations(d.conversations);
    } catch {
      // sunucuya ulaşılamadı — yok say
    }
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/ai/conversations?id=${id}`);
      const d = await r.json();
      if (Array.isArray(d.messages)) {
        setMessages(d.messages as Msg[]);
        setCurrentId(id);
        setShowHistory(false);
      }
    } catch {
      // yok say
    }
  }, []);

  // Açılışta sohbet listesini al; en son sohbet varsa onu yükle (gezme sonrası korunur).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/ai/conversations");
        const d = await r.json();
        const list: Conversation[] = Array.isArray(d.conversations)
          ? d.conversations
          : [];
        setConversations(list);
        if (list.length > 0) await loadConversation(list[0].id);
      } catch {
        // yok say
      }
    })();
  }, [loadConversation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function newChat() {
    setMessages([]);
    setCurrentId(null);
    setShowHistory(false);
  }

  async function persistMsg(convId: number, role: "user" | "ai", text: string) {
    try {
      await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "append", id: convId, role, text }),
      });
    } catch {
      // kalıcı kayıt başarısız — sohbet ekranda yine de görünür
    }
  }

  async function deleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
    } catch {
      // yok say
    }
    if (id === currentId) newChat();
    refreshList();
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || typing) return;

    const newMsgs: Msg[] = [...messages, { role: "user", text: q }];
    setMessages(newMsgs);
    setInput("");
    setTyping(true);

    try {
      // Henüz sohbet yoksa oluştur.
      let convId = currentId;
      if (!convId) {
        const cr = await fetch("/api/ai/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create" }),
        });
        const cd = await cr.json();
        convId = cd.id as number;
        setCurrentId(convId);
      }
      await persistMsg(convId, "user", q);

      // Geçmişi Gemini formatına çevir (ai -> model).
      const payload = newMsgs.map((m) => ({
        role: m.role === "ai" ? "model" : "user",
        text: m.text,
      }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI cevabı alınamadı.");

      setMessages((m) => [...m, { role: "ai", text: data.reply }]);
      await persistMsg(convId, "ai", data.reply);
      refreshList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu.";
      setMessages((m) => [...m, { role: "ai", text: `⚠️ ${msg}` }]);
    } finally {
      setTyping(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      {/* Eski Sohbetler kenar çubuğu (geniş ekranda sabit, mobilde aç/kapa) */}
      <aside
        className={`${
          showHistory ? "flex" : "hidden"
        } w-64 shrink-0 flex-col rounded-xl border bg-card md:flex`}
      >
        <div className="flex items-center justify-between border-b px-3 py-3">
          <span className="text-sm font-semibold">Eski Sohbetler</span>
          <button
            onClick={newChat}
            title="Yeni Sohbet"
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Henüz sohbet yok.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                c.id === currentId ? "bg-muted" : "hover:bg-muted"
              }`}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{c.title}</span>
              <span
                onClick={(e) => deleteConversation(c.id, e)}
                title="Sil"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Sohbet alanı */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            <History className="h-3.5 w-3.5" /> Eski Sohbetler
          </button>
          <div className="hidden md:block" />
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Yeni Sohbet
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {empty && (
            <div className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="max-w-[75%] rounded-2xl border bg-card px-4 py-3 text-sm leading-relaxed">
                {WELCOME}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}
            >
              {m.role === "ai" && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                  <Sparkles className="h-5 w-5" />
                </span>
              )}
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
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

        {empty && (
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
    </div>
  );
}
