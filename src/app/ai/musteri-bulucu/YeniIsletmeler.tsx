"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import { Sparkles, Radar, CalendarClock, AlertTriangle, Play, Save } from "lucide-react";

// Müşteri Bulucu → "Yeni İşletmeler" sekmesi. Seçilen ilde seçili türlerin Google
// Haritalar listesini haftada bir tarar; önceki taramada olmayanları ve "yakında
// açılacak" işletmeleri gösterir. Kartlar sayfanın kendi kart bileşeniyle çizilir
// (Kaydet / WhatsApp aynı çalışsın diye) — renderLead ile dışarıdan verilir.

export type NewLead = {
  id: string;
  name: string;
  address: string;
  phone: string;
  mapsUrl: string;
  website: string;
  category: string;
  rating: number | null;
  ratingCount: number | null;
  lat: number | null;
  lng: number | null;
  businessStatus: string;
  profile: string;
  sector: string;
  firstSeen: number;
  openingDate: string;
};

type ScanRow = {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: "running" | "done" | "error";
  progress: number;
  requests: number;
  found: number;
  new_count: number;
  future_count: number;
  baseline: number;
  error: string | null;
};

type WatchData = {
  config: { il: string; profiles: string[]; enabled: boolean };
  placesConfigured: boolean;
  running: boolean;
  last: ScanRow | null;
  lastDone: ScanRow | null;
  seenCount: number;
  nextAt: number | null;
  items: { future: NewLead[]; recent: NewLead[] };
  error?: string;
};

type ProfileGroup = { group: string; profiles: string[] };

const ILLER = ["Sakarya", "Kocaeli", "Düzce"];
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtOpening(iso: string): string {
  if (!iso) return "tarih belirtilmemiş";
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const rel = days > 0 ? `${days} gün sonra` : days === 0 ? "bugün" : "açılmış olmalı";
  return `${day} ${TR_MONTHS[m - 1]} ${y} (${rel})`;
}

export default function YeniIsletmeler({
  groups,
  renderLead,
}: {
  groups: ProfileGroup[];
  renderLead: (lead: NewLead, region: string, badge: React.ReactNode) => React.ReactNode;
}) {
  const [data, setData] = useState<WatchData | null>(null);
  const [il, setIl] = useState("Sakarya");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = useCallback((d: WatchData, resetForm: boolean) => {
    setData(d);
    if (resetForm) {
      setIl(d.config.il);
      setProfiles(d.config.profiles);
      // İlk taramadan önce haftalık takip varsayılan olarak açık gelsin.
      setEnabled(d.lastDone ? d.config.enabled : true);
      setDirty(false);
    }
  }, []);

  const load = useCallback(
    (resetForm: boolean) =>
      fetch("/api/ai/musteri-bulucu/yeni")
        .then((r) => r.json())
        .then((d: WatchData) => {
          if (d.error) throw new Error(d.error);
          apply(d, resetForm);
        })
        .catch((err) => setMsg({ ok: false, text: err instanceof Error ? err.message : "Yüklenemedi." })),
    [apply]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Tarama sürerken ilerlemeyi izle.
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => load(false), 3000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/ai/musteri-bulucu/yeni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "İşlem başarısız.");
    return d as WatchData;
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      apply(await post({ action: "save", il, profiles, enabled }), true);
      setMsg({ ok: true, text: "Takip ayarları kaydedildi." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // Kaydedilmemiş değişiklik varsa önce kaydet; tarama kayıtlı ayarla çalışır.
      if (dirty || !data?.lastDone) await post({ action: "save", il, profiles, enabled: dirty ? enabled : true });
      apply(await post({ action: "scan" }), true);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Tarama başlatılamadı." });
    } finally {
      setBusy(false);
    }
  };

  const toggleProfile = (p: string) => {
    setProfiles((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));
    setDirty(true);
  };

  if (!data) {
    return (
      <Panel className="py-10 text-center">
        <p className="text-sm text-muted-foreground">{msg?.text || "Yükleniyor…"}</p>
      </Panel>
    );
  }

  const running = data.running;
  const last = data.last;
  const lastDone = data.lastDone;
  const hasBaseline = !!lastDone;
  const { future, recent } = data.items;

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Yeni İşletmeler</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Seçtiğin ilde seçtiğin türlerdeki işletmeler haftada bir Google Haritalar&apos;dan
              taranır. Bir önceki taramada olmayan işletmeler <b className="text-foreground">yeni</b>{" "}
              olarak, açılış tarihi belli olanlar <b className="text-foreground">yakında açılacak</b>{" "}
              olarak listelenir. İlk tarama yalnız başlangıç listesini çıkarır.
            </p>
          </div>
        </div>
      </Panel>

      {!data.placesConfigured && (
        <Panel className="border-red-500/30 bg-red-500/5">
          <p className="text-sm font-medium text-red-600">
            Google Places API anahtarı tanımlı değil. Ayarlar &gt; Google Places bölümünden girin.
          </p>
        </Panel>
      )}

      {/* Takip ayarları */}
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">İl</span>
            <select
              value={il}
              onChange={(e) => {
                setIl(e.target.value);
                setDirty(true);
              }}
              className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            >
              {ILLER.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setDirty(true);
              }}
            />
            Her hafta otomatik tara
          </label>
          <div className="ml-auto flex gap-2">
            {dirty && hasBaseline && (
              <button
                onClick={save}
                disabled={busy || running}
                className="flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium hover:border-primary/40 disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> Kaydet
              </button>
            )}
            <button
              onClick={scan}
              disabled={busy || running || !data.placesConfigured || profiles.length === 0}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {hasBaseline ? "Şimdi tara" : "Takibi başlat (ilk tarama)"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Takip edilen türler ({profiles.length}) · yeni eklenen bir tür ilk taramasında başlangıç
            listesine alınır, yenileri bir sonraki taramadan itibaren görünür
          </p>
          <div className="space-y-2">
            {groups.map((gr) => (
              <div key={gr.group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">{gr.group}</span>
                {gr.profiles.map((p) => {
                  const on = profiles.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleProfile(p)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {msg && (
          <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
        )}
      </Panel>

      {/* Durum */}
      <Panel>
        {running && last ? (
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Radar className="h-4 w-4 animate-spin text-primary [animation-duration:2.5s]" />
              {last.baseline || !hasBaseline ? "İlk tarama sürüyor" : "Tarama sürüyor"} · %
              {Math.round(last.progress * 100)}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, last.progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Arka planda ilerliyor; sayfadan çıkabilirsin. Google&apos;a {last.requests} istek yapıldı.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Takip edilen işletme: </span>
              <b>{data.seenCount.toLocaleString("tr-TR")}</b>
            </span>
            <span>
              <span className="text-muted-foreground">Son tarama: </span>
              {lastDone ? (
                <>
                  {fmtDateTime(lastDone.started_at)}
                  {lastDone.baseline ? " (başlangıç listesi)" : ` · ${lastDone.new_count} yeni, ${lastDone.future_count} yakında`}
                </>
              ) : (
                "henüz yok"
              )}
            </span>
            {data.nextAt && (
              <span>
                <span className="text-muted-foreground">Sonraki otomatik tarama: </span>
                {fmtDate(data.nextAt)}
              </span>
            )}
          </div>
        )}
        {!running && last?.status === "error" && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Son tarama tamamlanamadı: {last.error}
          </p>
        )}
      </Panel>

      {/* Listeler */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Yakında açılacak</p>
          <Pill tone="warning">{future.length}</Pill>
        </div>
        {future.length === 0 ? (
          <Panel className="py-6 text-center text-sm text-muted-foreground">
            Şu an açılış tarihi belli yeni bir işletme yok.
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {future.map((l) => renderLead(l, data.config.il, <Pill tone="warning">🔜 Açılış: {fmtOpening(l.openingDate)}</Pill>))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Yeni eklenenler (son 30 gün)</p>
          <Pill tone="primary">{recent.length}</Pill>
        </div>
        {recent.length === 0 ? (
          <Panel className="py-6 text-center text-sm text-muted-foreground">
            {hasBaseline
              ? "Son 30 günde yeni işletme görülmedi. Bir sonraki taramada tekrar bakılacak."
              : "İlk tarama başlangıç listesini çıkarır; yeni işletmeler bir sonraki taramadan itibaren burada görünür."}
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recent.map((l) => renderLead(l, data.config.il, <Pill tone="primary">🆕 İlk görüldü: {fmtDate(l.firstSeen)}</Pill>))}
          </div>
        )}
      </div>
    </div>
  );
}
