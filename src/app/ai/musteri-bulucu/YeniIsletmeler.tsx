"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import { Sparkles, Radar, CalendarClock, AlertTriangle, Play, Save, Pencil, X, Plus } from "lucide-react";

// Müşteri Bulucu → "Yeni İşletmeler" sekmesi. Takip edilen her ilde seçili türlerin Google
// Haritalar listesi haftada bir taranır; önceki taramada olmayanlar ve "yakında açılacak"
// işletmeler listelenir. Birden çok il takip edilebilir; sonuçlar il ve türe göre süzülür.
// Kartlar sayfanın kendi kart bileşeniyle çizilir (Kaydet / WhatsApp aynı çalışsın diye) —
// renderLead ile dışarıdan verilir.

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
  il: string;
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

type IlStatus = {
  il: string;
  profiles: string[];
  last: ScanRow | null;
  lastDone: ScanRow | null;
  seenCount: number;
  nextAt: number | null;
};

type WatchData = {
  enabled: boolean;
  placesConfigured: boolean;
  running: boolean;
  runningIl: string | null;
  watches: IlStatus[];
  iller: string[];
  defaultProfiles: string[];
  items: { future: NewLead[]; recent: NewLead[] };
  error?: string;
};

type ProfileGroup = { group: string; profiles: string[] };

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

function count<T>(arr: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function YeniIsletmeler({
  groups,
  renderLead,
}: {
  groups: ProfileGroup[];
  renderLead: (lead: NewLead, region: string, badge: React.ReactNode) => React.ReactNode;
}) {
  const [data, setData] = useState<WatchData | null>(null);
  // Düzenleme formu: seçili il ve türleri.
  const [il, setIl] = useState("");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Liste süzgeçleri.
  const [ilFilter, setIlFilter] = useState("Tümü");
  const [turFilter, setTurFilter] = useState("Tümü");

  const watchOf = useCallback((d: WatchData | null, x: string) => d?.watches.find((w) => w.il === x), []);

  const pickIl = useCallback(
    (d: WatchData, x: string) => {
      setIl(x);
      setProfiles(watchOf(d, x)?.profiles ?? d.defaultProfiles);
    },
    [watchOf]
  );

  const load = useCallback(
    (resetForm: boolean) =>
      fetch("/api/ai/musteri-bulucu/yeni")
        .then((r) => r.json())
        .then((d: WatchData) => {
          if (d.error) throw new Error(d.error);
          setData(d);
          if (resetForm) {
            // Takip edilmeyen ilk il ile açılır (yeni il eklemek kolay olsun); hepsi takipteyse ilki.
            const free = d.iller.find((x) => !d.watches.some((w) => w.il === x));
            pickIl(d, d.watches.length === 0 ? d.iller[0] : (free ?? d.iller[0]));
          }
        })
        .catch((err) => setMsg({ ok: false, text: err instanceof Error ? err.message : "Yüklenemedi." })),
    [pickIl]
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
    setData(d as WatchData);
    return d as WatchData;
  };

  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "İşlem başarısız." });
    } finally {
      setBusy(false);
    }
  };

  const save = (andScan: boolean) =>
    run(
      async () => {
        const isNew = !watchOf(data, il);
        await post({ action: "save", il, profiles });
        // İlk kez eklenen il ve "nasılsa ilk tarama gerekecek" durumunda taramayı başlat.
        if (andScan || isNew) await post({ action: "scan", il });
        // İlk taramada haftalık takip varsayılan olarak açılsın.
        if (isNew && !data?.enabled) await post({ action: "enabled", enabled: true });
      },
      andScan || !watchOf(data, il) ? undefined : `${il} türleri kaydedildi.`
    );

  const toggleProfile = (p: string) =>
    setProfiles((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  const items = data?.items;
  const filtered = useMemo(() => {
    const ok = (l: NewLead) => (ilFilter === "Tümü" || l.il === ilFilter) && (turFilter === "Tümü" || l.profile === turFilter);
    return { future: (items?.future ?? []).filter(ok), recent: (items?.recent ?? []).filter(ok) };
  }, [items, ilFilter, turFilter]);

  if (!data) {
    return (
      <Panel className="py-10 text-center">
        <p className="text-sm text-muted-foreground">{msg?.text || "Yükleniyor…"}</p>
      </Panel>
    );
  }

  const all = [...data.items.future, ...data.items.recent];
  const ilCounts = count(all, (l) => l.il);
  // Tür sayıları seçili ile göre.
  const turCounts = count(
    all.filter((l) => ilFilter === "Tümü" || l.il === ilFilter),
    (l) => l.profile
  );
  const editing = watchOf(data, il);
  const anyBaseline = data.watches.some((w) => w.lastDone);
  const badgeIl = (l: NewLead) => (ilFilter === "Tümü" ? ` · ${l.il}` : "");

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
              Takibe aldığın her ilde, seçtiğin türlerdeki işletmeler haftada bir Google Haritalar&apos;dan
              taranır. Bir önceki taramada olmayanlar <b className="text-foreground">yeni</b>, açılış tarihi belli
              olanlar <b className="text-foreground">yakında açılacak</b> olarak listelenir. Birden çok il takip
              edebilirsin; sonuçları aşağıdan il ve türe göre ayırabilirsin. Bir ilin ilk taraması yalnız başlangıç
              listesini çıkarır.
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

      {/* Takip edilen iller */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">Takip edilen iller</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={busy}
              onChange={(e) => run(() => post({ action: "enabled", enabled: e.target.checked }))}
            />
            Her hafta otomatik tara
          </label>
        </div>
        {data.watches.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Henüz takip edilen il yok. Aşağıdan il ve türleri seçip takibi başlat.
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border">
            {data.watches.map((w) => {
              const isRunning = data.runningIl === w.il;
              return (
                <li key={w.il} className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    <b className="w-20">{w.il}</b>
                    <span className="text-muted-foreground">{w.profiles.length} tür</span>
                    <span>
                      <span className="text-muted-foreground">Takip edilen işletme: </span>
                      {w.seenCount.toLocaleString("tr-TR")}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Son tarama: </span>
                      {w.lastDone
                        ? `${fmtDateTime(w.lastDone.started_at)}${
                            w.lastDone.baseline
                              ? " (başlangıç listesi)"
                              : ` · ${w.lastDone.new_count} yeni, ${w.lastDone.future_count} yakında`
                          }`
                        : "henüz yok"}
                    </span>
                    {w.nextAt && (
                      <span>
                        <span className="text-muted-foreground">Sonraki: </span>
                        {fmtDate(w.nextAt)}
                      </span>
                    )}
                    <div className="ml-auto flex gap-2">
                      <button
                        onClick={() => pickIl(data, w.il)}
                        className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:border-primary/40"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Türler
                      </button>
                      <button
                        onClick={() => run(() => post({ action: "scan", il: w.il }))}
                        disabled={busy || data.running || !data.placesConfigured}
                        className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:border-primary/40 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Şimdi tara
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`${w.il} takipten çıkarılsın mı? Bulunan işletmeler listede kalır.`))
                            run(() => post({ action: "remove", il: w.il }));
                        }}
                        disabled={busy || isRunning}
                        className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-red-500/40 hover:text-red-500 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Takipten çıkar
                      </button>
                    </div>
                  </div>
                  {isRunning && w.last && (
                    <div className="mt-2">
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                        <Radar className="h-3.5 w-3.5 animate-spin text-primary [animation-duration:2.5s]" />
                        {w.lastDone ? "Tarama sürüyor" : "İlk tarama sürüyor"} · %{Math.round(w.last.progress * 100)} ·
                        Google&apos;a {w.last.requests} istek · sayfadan çıkabilirsin
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(2, w.last.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {!isRunning && w.last?.status === "error" && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Son tarama tamamlanamadı: {w.last.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* İl ekle / türleri düzenle */}
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">İl</span>
            <select
              value={il}
              onChange={(e) => pickIl(data, e.target.value)}
              className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            >
              {data.iller.map((x) => (
                <option key={x} value={x}>
                  {x}
                  {watchOf(data, x) ? " (takipte)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="pb-2.5 text-sm text-muted-foreground">
            {editing ? `${il} takipte — türlerini değiştirebilirsin.` : `${il} henüz takipte değil.`}
          </p>
          <div className="ml-auto flex gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => save(false)}
                  disabled={busy || profiles.length === 0}
                  className="flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium hover:border-primary/40 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Kaydet
                </button>
                <button
                  onClick={() => save(true)}
                  disabled={busy || data.running || !data.placesConfigured || profiles.length === 0}
                  className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" /> Kaydet ve tara
                </button>
              </>
            ) : (
              <button
                onClick={() => save(true)}
                disabled={busy || data.running || !data.placesConfigured || profiles.length === 0}
                className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Takibe ekle (ilk tarama)
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {il} için türler ({profiles.length}) · yeni eklenen bir tür ilk taramasında başlangıç listesine alınır,
            yenileri bir sonraki taramadan itibaren görünür
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
        {data.running && data.runningIl !== il && (
          <p className="mt-3 text-xs text-muted-foreground">
            {data.runningIl} taraması bitince yeni tarama başlatılabilir.
          </p>
        )}
        {msg && (
          <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
        )}
      </Panel>

      {/* Süzgeçler */}
      {all.length > 0 && (
        <Panel>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-xs text-muted-foreground">İl</span>
              <FilterChip on={ilFilter === "Tümü"} onClick={() => setIlFilter("Tümü")}>
                Tümü {all.length}
              </FilterChip>
              {[...ilCounts.entries()].map(([x, n]) => (
                <FilterChip
                  key={x}
                  on={ilFilter === x}
                  onClick={() => {
                    setIlFilter(x);
                    setTurFilter("Tümü");
                  }}
                >
                  {x} {n}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-xs text-muted-foreground">Tür</span>
              <FilterChip on={turFilter === "Tümü"} onClick={() => setTurFilter("Tümü")}>
                Tümü
              </FilterChip>
              {[...turCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([x, n]) => (
                  <FilterChip key={x} on={turFilter === x} onClick={() => setTurFilter(x)}>
                    {x} {n}
                  </FilterChip>
                ))}
            </div>
          </div>
        </Panel>
      )}

      {/* Listeler */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Yakında açılacak</p>
          <Pill tone="warning">{filtered.future.length}</Pill>
        </div>
        {filtered.future.length === 0 ? (
          <Panel className="py-6 text-center text-sm text-muted-foreground">
            {all.length > 0 && data.items.future.length > 0
              ? "Bu süzgece uyan yakında açılacak işletme yok."
              : "Şu an açılış tarihi belli yeni bir işletme yok."}
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.future.map((l) =>
              renderLead(l, l.il, <Pill tone="warning">🔜 Açılış: {fmtOpening(l.openingDate)}{badgeIl(l)}</Pill>)
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Yeni eklenenler (son 30 gün)</p>
          <Pill tone="primary">{filtered.recent.length}</Pill>
        </div>
        {filtered.recent.length === 0 ? (
          <Panel className="py-6 text-center text-sm text-muted-foreground">
            {data.items.recent.length > 0
              ? "Bu süzgece uyan yeni işletme yok."
              : anyBaseline
                ? "Son 30 günde yeni işletme görülmedi. Bir sonraki taramada tekrar bakılacak."
                : "Bir ilin ilk taraması başlangıç listesini çıkarır; yeni işletmeler bir sonraki taramadan itibaren burada görünür."}
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.recent.map((l) =>
              renderLead(l, l.il, <Pill tone="primary">🆕 İlk görüldü: {fmtDate(l.firstSeen)}{badgeIl(l)}</Pill>)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
