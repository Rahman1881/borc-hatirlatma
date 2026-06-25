"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import { tenders } from "@/lib/ai-mock";
import {
  Target,
  Gavel,
  MapPin,
  Phone,
  Search,
  Sparkles,
  Building2,
  Star,
  Globe,
  CalendarClock,
  BookmarkPlus,
  BookmarkCheck,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  KeyRound,
  Save,
  Radar,
  History,
  Clock,
  Send,
  X,
  User,
} from "lucide-react";

const iller = ["Sakarya", "Kocaeli", "Düzce"];
const ilceler: Record<string, string[]> = {
  Sakarya: [
    "Tümü",
    "Adapazarı",
    "Akyazı",
    "Arifiye",
    "Erenler",
    "Ferizli",
    "Geyve",
    "Hendek",
    "Karapürçek",
    "Karasu",
    "Kaynarca",
    "Kocaali",
    "Pamukova",
    "Sapanca",
    "Serdivan",
    "Söğütlü",
    "Taraklı",
  ],
  Kocaeli: [
    "Tümü",
    "Başiskele",
    "Çayırova",
    "Darıca",
    "Derince",
    "Dilovası",
    "Gebze",
    "Gölcük",
    "İzmit",
    "Kandıra",
    "Karamürsel",
    "Kartepe",
    "Körfez",
  ],
  Düzce: [
    "Tümü",
    "Merkez",
    "Akçakoca",
    "Cumayeri",
    "Çilimli",
    "Gölyaka",
    "Gümüşova",
    "Kaynaşlı",
    "Yığılca",
  ],
};

type Potential = "Yüksek" | "Orta" | "Düşük";

type Lead = {
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
  potential: Potential;
  sector: string;
  reason: string;
};

type SavedCustomer = Lead & {
  savedAt: number;
  region: string;
  note: string;
  status: "Yeni" | "Arandı" | "Teklif Verildi" | "Kazanıldı";
};

type ProfileGroup = { group: string; profiles: string[] };

type ScanHistoryEntry = {
  id: string;
  scannedAt: number;
  il: string;
  ilce: string;
  region: string;
  profiles: string[];
  scored: boolean;
  leads: Lead[];
};

const RESULTS_KEY = "carkpetrol_musteri_results";
const HISTORY_LIMIT = 30;
const PAGE_SIZE = 6;
// Aynı anda en fazla bu kadar işletme profili seçilebilir (performans için).
const MAX_PROFILES = 3;

const potentialTone: Record<Potential, "positive" | "warning" | "neutral"> = {
  Yüksek: "positive",
  Orta: "warning",
  Düşük: "neutral",
};

const statusTone: Record<SavedCustomer["status"], "primary" | "warning" | "positive" | "neutral"> = {
  Yeni: "neutral",
  Arandı: "warning",
  "Teklif Verildi": "primary",
  Kazanıldı: "positive",
};

const statusOptions: SavedCustomer["status"][] = [
  "Yeni",
  "Arandı",
  "Teklif Verildi",
  "Kazanıldı",
];

export default function MusteriBulucuPage() {
  const [tab, setTab] = useState<"leads" | "history" | "saved" | "tenders">("leads");

  // arama formu
  const [il, setIl] = useState("Sakarya");
  const [ilce, setIlce] = useState("Tümü");
  const [groups, setGroups] = useState<ProfileGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // tarama
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [results, setResults] = useState<Lead[] | null>(null);
  const [lastRegion, setLastRegion] = useState("");
  const [scored, setScored] = useState(false);
  const [page, setPage] = useState(0);
  // "form" = filtre ekranı, "results" = bulunan müşteriler ayrı sayfası
  const [view, setView] = useState<"form" | "results">("form");

  // kayıtlılar
  const [saved, setSaved] = useState<SavedCustomer[]>([]);

  // Telegram'a gönderme
  const [tgChats, setTgChats] = useState<
    { chatId: string; name: string; enabled: boolean }[]
  >([]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [tgMsg, setTgMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Gönder penceresi açıldığında hangi liste gönderilecek (sonuçlar ya da geçmiş tarama).
  const [sendPayload, setSendPayload] = useState<{
    leads: Lead[];
    region: string;
  } | null>(null);

  // geçmiş taramalar
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  // "Geçmiş Taramalar" sekmesinde açılan kayıt (null ise liste gösterilir)
  const [historyDetail, setHistoryDetail] = useState<ScanHistoryEntry | null>(null);

  // profil gruplarını API'den al
  useEffect(() => {
    fetch("/api/ai/musteri-bulucu")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.groups)) {
          setGroups(d.groups);
          // ilk grup açık başlasın
          if (d.groups[0]) setOpenGroups({ [d.groups[0].group]: true });
        }
      })
      .catch(() => {});
  }, []);

  // Geçici tarama sonuçları (RESULTS_KEY) hâlâ tarayıcıda; geçici/cihaza özel veridir.
  useEffect(() => {
    try {
      const r = localStorage.getItem(RESULTS_KEY);
      if (r) {
        const p = JSON.parse(r) as { leads: Lead[]; region: string; scored: boolean };
        if (p && Array.isArray(p.leads)) {
          setResults(p.leads);
          setLastRegion(p.region || "");
          setScored(!!p.scored);
          // Önceki tarama sonuçları varsa doğrudan sonuç sayfasını göster.
          if (p.leads.length > 0) setView("results");
        }
      }
    } catch {
      // bozuk kayıt — yok say
    }
  }, []);

  // Kayıtlı müşteriler ve geçmiş taramalar artık sunucuda (SQLite) tutulur.
  useEffect(() => {
    fetch("/api/ai/musteri-bulucu/store")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.saved)) setSaved(d.saved as SavedCustomer[]);
        if (Array.isArray(d.history)) setHistory(d.history as ScanHistoryEntry[]);
      })
      .catch(() => {});
  }, []);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);

  function persistResults(leads: Lead[], region: string, sc: boolean) {
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify({ leads, region, scored: sc }));
    } catch {
      // yok say
    }
  }

  // Müşteri Bulucu kalıcı verisi için sunucuya yazma yardımcıları.
  function storePost(payload: Record<string, unknown>) {
    fetch("/api/ai/musteri-bulucu/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  // Her tarama yapıldığında geçmişe (en yeni en üstte) ekler, son HISTORY_LIMIT kaydı tutar.
  function addToHistory(entry: ScanHistoryEntry) {
    setHistory((h) => [entry, ...h].slice(0, HISTORY_LIMIT));
    storePost({ action: "addHistory", entry });
  }

  function removeHistory(id: string) {
    setHistory((h) => h.filter((x) => x.id !== id));
    storePost({ action: "removeHistory", id });
  }

  function toggleProfile(p: string) {
    if (selected.includes(p)) {
      setSelected(selected.filter((x) => x !== p));
      return;
    }
    if (selected.length >= MAX_PROFILES) {
      setError(`En fazla ${MAX_PROFILES} işletme profili seçebilirsiniz.`);
      return;
    }
    setError("");
    setSelected([...selected, p]);
  }
  function toggleGroupOpen(g: string) {
    setOpenGroups((o) => ({ ...o, [g]: !o[g] }));
  }

  async function runScan() {
    if (selected.length === 0) {
      setError("En az bir işletme profili seçin.");
      return;
    }
    setScanning(true);
    setError("");
    setNeedsKey(false);
    setResults(null);
    setPage(0);

    const region = ilce && ilce !== "Tümü" ? `${ilce} ${il}` : il;
    const excludeIds = saved.map((s) => s.id);
    const excludeNames = saved.map((s) => s.name);

    try {
      const res = await fetch("/api/ai/musteri-bulucu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ il, ilce, profiles: selected, excludeIds, excludeNames }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.needsPlacesKey) setNeedsKey(true);
        throw new Error(data?.error || "Tarama başarısız.");
      }
      const leads = (data.leads || []) as Lead[];
      const reg = data.region || region;
      setResults(leads);
      setLastRegion(reg);
      setScored(!!data.scored);
      persistResults(leads, reg, !!data.scored);
      addToHistory({
        id: `${Date.now()}`,
        scannedAt: Date.now(),
        il,
        ilce,
        region: reg,
        profiles: selected,
        scored: !!data.scored,
        leads,
      });
      setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setScanning(false);
    }
  }

  function saveCustomer(l: Lead) {
    if (savedIds.has(l.id)) return;
    const sc: SavedCustomer = {
      ...l,
      savedAt: Date.now(),
      region: lastRegion,
      note: "",
      status: "Yeni",
    };
    setSaved((s) => [sc, ...s]);
    storePost({ action: "save", customer: sc });
    setResults((r) => {
      const n = r ? r.filter((x) => x.id !== l.id) : r;
      if (n) persistResults(n, lastRegion, scored);
      return n;
    });
  }

  function removeSaved(id: string) {
    setSaved((s) => s.filter((x) => x.id !== id));
    storePost({ action: "removeSaved", id });
  }
  function updateSaved(id: string, patch: Partial<SavedCustomer>) {
    setSaved((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    storePost({ action: "updateSaved", id, patch });
  }

  // Filtre ekranına geri dön (önceki sonuçlar yeni tarama yapılana kadar saklı kalır).
  function startNewScan() {
    setView("form");
    setError("");
  }

  // Telegram abonelerini çekip "gönder" penceresini açar (verilen listeyle).
  function openSendModal(leads: Lead[], region: string) {
    setSendPayload({ leads, region });
    setTgMsg(null);
    setShowSendModal(true);
    fetch("/api/ai/telegram")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.chats)) {
          setTgChats(
            (d.chats as { chatId: string; name: string; enabled: boolean }[]).filter(
              (c) => c.enabled
            )
          );
        }
      })
      .catch(() => {});
  }

  // Seçilen listeyi (sonuçlar ya da geçmiş tarama) seçilen aboneye /yakin formatında gönderir.
  async function sendLeadsTo(chatId: string) {
    const leads = sendPayload?.leads ?? [];
    setSendingTg(true);
    setTgMsg(null);
    try {
      const r = await fetch("/api/ai/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-leads",
          chatId,
          region: sendPayload?.region ?? "",
          leads,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setTgMsg({ ok: false, text: d.error || "Gönderilemedi." });
      } else {
        setTgMsg({
          ok: true,
          text: `Gönderildi · ${leads.length} işletme (${d.chunks} mesaj).`,
        });
      }
    } catch {
      setTgMsg({ ok: false, text: "Sunucuya ulaşılamadı." });
    } finally {
      setSendingTg(false);
    }
  }

  // Geçmiş bir taramayı kendi sekmesinde, detay görünümünde aç.
  function openHistoryEntry(entry: ScanHistoryEntry) {
    setHistoryDetail(entry);
  }

  const scanRegion = ilce && ilce !== "Tümü" ? `${ilce} / ${il}` : il;
  // Sonuçları değerlendirme (yorum) sayısına göre çoktan aza sırala.
  const visible = [...(results ?? [])].sort(
    (a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0)
  );
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageItems = visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1 w-fit">
        <TabBtn active={tab === "leads"} onClick={() => setTab("leads")} icon={Target}>
          Müşteri Bul
        </TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={History}>
          Geçmiş Taramalar
          {history.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs text-primary">
              {history.length}
            </span>
          )}
        </TabBtn>
        <TabBtn active={tab === "saved"} onClick={() => setTab("saved")} icon={BookmarkCheck}>
          Kayıtlı Müşteriler
          {saved.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs text-primary">
              {saved.length}
            </span>
          )}
        </TabBtn>
        <TabBtn active={tab === "tenders"} onClick={() => setTab("tenders")} icon={Gavel}>
          İhale Takibi
        </TabBtn>
      </div>

      {tab === "leads" && view === "form" && (
        <>
          <Panel>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">AI Müşteri Taraması</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  İl/ilçe ve işletme profillerini seç. Yapay zeka bölgedeki gerçek
                  işletmeleri bulur ve akaryakıt müşterisi potansiyeline göre puanlar.
                  Kayıtlı müşteriler tekrar listelenmez.
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    label="İl"
                    value={il}
                    options={iller}
                    onChange={(v) => {
                      setIl(v);
                      setIlce("Tümü");
                    }}
                  />
                  <Select label="İlçe" value={ilce} options={ilceler[il]} onChange={setIlce} />
                  <div className="flex items-end">
                    <button
                      onClick={runScan}
                      disabled={scanning}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {scanning ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                          Taranıyor…
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4" /> Tara
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      İşletme Profilleri ({selected.length}/{MAX_PROFILES} seçili)
                    </p>
                    {selected.length > 0 && (
                      <button
                        onClick={() => setSelected([])}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Temizle
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {groups.map((g) => {
                      const open = !!openGroups[g.group];
                      const selCount = g.profiles.filter((p) =>
                        selected.includes(p)
                      ).length;
                      return (
                        <div key={g.group} className="rounded-lg border bg-muted/30">
                          <div className="flex items-center justify-between px-3 py-2">
                            <button
                              onClick={() => toggleGroupOpen(g.group)}
                              className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
                            >
                              <ChevronDown
                                className={`h-4 w-4 text-muted-foreground transition-transform ${
                                  open ? "" : "-rotate-90"
                                }`}
                              />
                              {g.group}
                              {selCount > 0 && (
                                <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">
                                  {selCount}
                                </span>
                              )}
                            </button>
                          </div>
                          {open && (
                            <div className="flex flex-wrap gap-2 border-t px-3 py-3">
                              {g.profiles.map((p) => {
                                const on = selected.includes(p);
                                const blocked =
                                  !on && selected.length >= MAX_PROFILES;
                                return (
                                  <button
                                    key={p}
                                    onClick={() => toggleProfile(p)}
                                    disabled={blocked}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      on
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : blocked
                                          ? "cursor-not-allowed bg-card text-muted-foreground/40"
                                          : "bg-card text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {error && (
            <Panel className="border-red-500/30 bg-red-500/5">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div className="text-sm">
                  <p className="font-medium text-red-600">{error}</p>
                  {needsKey && (
                    <p className="mt-1 text-muted-foreground">
                      Gerçek işletme verisi için Ayarlar &gt; Google Places bölümünden
                      API anahtarını girmen gerekiyor.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {!results && !error && (
            <Panel className="py-12 text-center">
              <Target className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">Henüz tarama yapılmadı</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bölge ve profil seçip &quot;Tara&quot; butonuna bas, AI senin için
                potansiyel müşterileri bulsun.
              </p>
            </Panel>
          )}
        </>
      )}

      {tab === "leads" && view === "results" && (
        <>
          <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                  <Target className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {visible.length} potansiyel müşteri bulundu
                    </p>
                    <Pill tone={scored ? "primary" : "neutral"}>
                      {scored ? "AI puanladı" : "Puanlanmadı"}
                    </Pill>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {lastRegion || "Tarama sonuçları"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {visible.length > 0 && (
                  <button
                    onClick={() => openSendModal(visible, lastRegion)}
                    className="flex items-center justify-center gap-2 rounded-lg border border-[#229ED9]/40 bg-[#229ED9]/10 px-4 py-2 text-sm font-medium text-[#229ED9] transition-colors hover:bg-[#229ED9]/20"
                  >
                    <Send className="h-4 w-4" /> Telegram&apos;a Gönder
                  </button>
                )}
                <button
                  onClick={startNewScan}
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Search className="h-4 w-4" /> Farklı Bir Tarama Yap
                </button>
              </div>
            </div>
          </Panel>

          {visible.length === 0 ? (
            <Panel className="py-12 text-center">
              <Target className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">Yeni müşteri bulunamadı</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bu bölgedeki işletmeler ya kayıtlı ya da farklı profil seçmen
                gerekiyor.
              </p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pageItems.map((l) => (
                  <LeadCard
                    key={l.id}
                    lead={l}
                    saved={savedIds.has(l.id)}
                    onSave={() => saveCustomer(l)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Önceki
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Sayfa <b className="text-foreground">{page + 1}</b> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Sonraki <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {scanning && <ScanningModal region={scanRegion} count={selected.length} />}

      {showSendModal && (
        <SendToTelegramModal
          chats={tgChats}
          count={sendPayload?.leads.length ?? 0}
          region={sendPayload?.region ?? ""}
          sending={sendingTg}
          msg={tgMsg}
          onSend={sendLeadsTo}
          onClose={() => setShowSendModal(false)}
        />
      )}

      {tab === "history" && !historyDetail && (
        <HistoryList
          history={history}
          onOpen={openHistoryEntry}
          onRemove={removeHistory}
          onGoFind={() => {
            setTab("leads");
            setView("form");
          }}
        />
      )}

      {tab === "history" && historyDetail && (
        <HistoryDetail
          entry={historyDetail}
          savedIds={savedIds}
          onSave={saveCustomer}
          onBack={() => setHistoryDetail(null)}
          onSend={openSendModal}
        />
      )}

      {tab === "saved" && (
        <SavedList
          saved={saved}
          onRemove={removeSaved}
          onUpdate={updateSaved}
          onGoFind={() => setTab("leads")}
        />
      )}

      {tab === "tenders" && (
        <div className="space-y-4">
          <Panel className="bg-gradient-to-r from-amber-500/10 via-card to-card">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                <Gavel className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">İhale &amp; Araştırma Takibi</p>
                  <Pill tone="warning">Planlanıyor</Pill>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Bu bölüm; kamu (EKAP) ve özel sektör akaryakıt ihalelerini
                  tarayıp özetleyecek. Aşağıdaki kartlar örnek görünümdür;
                  entegrasyon tamamlandığında gerçek ihalelerle dolacaktır.
                </p>
              </div>
            </div>
          </Panel>

          {tenders.map((t) => (
            <Panel key={t.title} className="transition-colors hover:border-primary/40">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                    <Gavel className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold leading-tight">{t.title}</p>
                      <Pill tone={t.tag === "Kamu İhalesi" ? "primary" : "warning"}>
                        {t.tag}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.org} · {t.location}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-5 sm:flex-col sm:items-end sm:gap-1">
                  <span className="text-base font-bold">{t.amount}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> Son: {t.deadline}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                AI analizi ve ihale detayı, entegrasyon tamamlandığında
                etkinleşecek.
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  saved,
  onSave,
}: {
  lead: Lead;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <Panel className="flex flex-col transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold leading-tight">{lead.name}</p>
            <p className="text-xs text-muted-foreground">{lead.sector || lead.profile}</p>
          </div>
        </div>
        <Pill tone={potentialTone[lead.potential]}>{lead.potential} potansiyel</Pill>
      </div>

      {lead.reason && (
        <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
          “{lead.reason}”
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
        {lead.address && <Info icon={MapPin} text={lead.address} />}
        {lead.phone ? (
          <a
            href={`tel:${lead.phone}`}
            className="flex items-center gap-1.5 text-foreground hover:text-primary"
          >
            <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{lead.phone}</span>
          </a>
        ) : (
          <Info icon={Phone} text="Telefon bilgisi yok" muted />
        )}
        {lead.rating != null && (
          <Info
            icon={Star}
            text={`${lead.rating.toFixed(1)} (${lead.ratingCount ?? 0} değerlendirme)`}
          />
        )}
      </div>

      <div className="mt-4 flex gap-2 border-t pt-3">
        <button
          onClick={onSave}
          disabled={saved}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium ${
            saved
              ? "border text-muted-foreground"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {saved ? (
            <>
              <BookmarkCheck className="h-4 w-4" /> Zaten kayıtlı
            </>
          ) : (
            <>
              <BookmarkPlus className="h-4 w-4" /> Kaydet
            </>
          )}
        </button>
        {lead.mapsUrl && (
          <a
            href={lead.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <MapPin className="h-4 w-4" /> Harita
          </a>
        )}
        {lead.website && (
          <a
            href={lead.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Globe className="h-4 w-4" />
          </a>
        )}
      </div>
    </Panel>
  );
}

function SavedList({
  saved,
  onRemove,
  onUpdate,
  onGoFind,
}: {
  saved: SavedCustomer[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<SavedCustomer>) => void;
  onGoFind: () => void;
}) {
  if (saved.length === 0) {
    return (
      <Panel className="py-12 text-center">
        <BookmarkCheck className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Henüz kayıtlı müşteri yok</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tarama yapıp beğendiğin işletmeleri &quot;Kaydet&quot; ile buraya
          ekleyebilirsin. Kayıtlılar tekrar taramada listelenmez.
        </p>
        <button
          onClick={onGoFind}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Search className="h-4 w-4" /> Müşteri Bul
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <b className="text-foreground">{saved.length}</b> kayıtlı müşteri · arama/ulaşım için
      </p>
      {saved.map((c) => (
        <Panel key={c.id} className="transition-colors hover:border-primary/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold leading-tight">{c.name}</p>
                  <Pill tone={potentialTone[c.potential]}>{c.potential}</Pill>
                  <Pill tone={statusTone[c.status]}>{c.status}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.sector || c.profile}
                  {c.region ? ` · ${c.region}` : ""}
                </p>
                {c.address && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> {c.address}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.phone && (
                <a
                  href={`tel:${c.phone}`}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <Phone className="h-4 w-4" /> Ara
                </a>
              )}
              {c.mapsUrl && (
                <a
                  href={c.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <MapPin className="h-4 w-4" />
                </a>
              )}
              <button
                onClick={() => onRemove(c.id)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:border-red-500/40 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Durum
              <select
                value={c.status}
                onChange={(e) =>
                  onUpdate(c.id, { status: e.target.value as SavedCustomer["status"] })
                }
                className="h-9 rounded-lg border bg-muted/50 px-2 text-sm text-foreground outline-none focus:border-primary"
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={c.note}
              onChange={(e) => onUpdate(c.id, { note: e.target.value })}
              placeholder="Not ekle (örn. görüşülecek kişi, randevu)…"
              className="h-9 flex-1 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            />
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Save className="h-3 w-3" /> otomatik kayıt
            </span>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function formatScanDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function HistoryList({
  history,
  onOpen,
  onRemove,
  onGoFind,
}: {
  history: ScanHistoryEntry[];
  onOpen: (e: ScanHistoryEntry) => void;
  onRemove: (id: string) => void;
  onGoFind: () => void;
}) {
  if (history.length === 0) {
    return (
      <Panel className="py-12 text-center">
        <History className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Henüz geçmiş tarama yok</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Bir tarama yaptığında bölge, tarih ve sonuçlar burada saklanır; istediğin
          zaman tekrar açabilirsin.
        </p>
        <button
          onClick={onGoFind}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Search className="h-4 w-4" /> Müşteri Bul
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <b className="text-foreground">{history.length}</b> geçmiş tarama · karta basıp
        sonuçları aç
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {history.map((h) => (
          <Panel
            key={h.id}
            className="group cursor-pointer transition-colors hover:border-primary/40"
            onClick={() => onOpen(h)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                  <Target className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold leading-tight">{h.region}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> {formatScanDate(h.scannedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone="primary">{h.leads.length} sonuç</Pill>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(h.id);
                  }}
                  className="rounded-lg border p-1.5 text-muted-foreground hover:border-red-500/40 hover:text-red-500"
                  aria-label="Sil"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
              {h.profiles.length === 0 ? (
                <span className="text-xs text-muted-foreground">Profil seçilmedi</span>
              ) : (
                <>
                  {h.profiles.slice(0, 5).map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                  {h.profiles.length > 5 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      +{h.profiles.length - 5}
                    </span>
                  )}
                </>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function HistoryDetail({
  entry,
  savedIds,
  onSave,
  onBack,
  onSend,
}: {
  entry: ScanHistoryEntry;
  savedIds: Set<string>;
  onSave: (l: Lead) => void;
  onBack: () => void;
  onSend: (leads: Lead[], region: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
              <Target className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{entry.region}</p>
                <Pill tone="primary">{entry.leads.length} sonuç</Pill>
                <Pill tone={entry.scored ? "primary" : "neutral"}>
                  {entry.scored ? "AI puanladı" : "Puanlanmadı"}
                </Pill>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> {formatScanDate(entry.scannedAt)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {entry.leads.length > 0 && (
              <button
                onClick={() => onSend(entry.leads, entry.region)}
                className="flex items-center justify-center gap-2 rounded-lg border border-[#229ED9]/40 bg-[#229ED9]/10 px-4 py-2 text-sm font-medium text-[#229ED9] transition-colors hover:bg-[#229ED9]/20"
              >
                <Send className="h-4 w-4" /> Telegram&apos;a Gönder
              </button>
            )}
            <button
              onClick={onBack}
              className="flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Geçmiş Taramalar
            </button>
          </div>
        </div>

        {entry.profiles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
            {entry.profiles.map((p) => (
              <span
                key={p}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </Panel>

      {entry.leads.length === 0 ? (
        <Panel className="py-12 text-center">
          <Target className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Bu taramada müşteri bulunmamış</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {entry.leads.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              saved={savedIds.has(l.id)}
              onSave={() => onSave(l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScanningModal({ region, count }: { region: string; count: number }) {
  const steps = [
    "Bölgedeki işletmeler taranıyor",
    "Akaryakıt potansiyeli değerlendiriliyor",
    "Sonuçlar puanlanıyor",
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % steps.length), 1800);
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-2xl">
        {/* Radar animasyonu */}
        <div className="relative mx-auto grid h-24 w-24 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
          <span className="absolute inset-2 animate-ping rounded-full bg-orange-500/20 [animation-delay:300ms]" />
          <span className="absolute inset-4 rounded-full bg-orange-500/10" />
          <span className="relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Radar className="h-7 w-7 animate-spin [animation-duration:2.5s]" />
          </span>
        </div>

        <p className="mt-6 text-base font-semibold">AI Müşterileri Tarıyor</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <b className="text-foreground">{region}</b>
          {count > 0 ? ` · ${count} işletme profili` : ""}
        </p>

        <div className="mt-5 space-y-2 text-left">
          {steps.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div
                key={s}
                className={`flex items-center gap-2 text-sm transition-colors ${
                  active
                    ? "text-foreground"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                }`}
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-emerald-500/20 text-emerald-600"
                        : "bg-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                {s}
                {active && (
                  <span className="ml-auto flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SendToTelegramModal({
  chats,
  count,
  region,
  sending,
  msg,
  onSend,
  onClose,
}: {
  chats: { chatId: string; name: string; enabled: boolean }[];
  count: number;
  region: string;
  sending: boolean;
  msg: { ok: boolean; text: string } | null;
  onSend: (chatId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#229ED9]/15 text-[#229ED9]">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Telegram&apos;a Gönder</p>
              <p className="text-xs text-muted-foreground">
                {count} işletme · {region || "tarama sonuçları"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-xs font-medium text-muted-foreground">
          Listeyi hangi aboneye gönderelim? (telefon + konum + harita dahil)
        </p>
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {chats.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              Henüz bota yazan abone yok. Kişi Telegram&apos;dan bota{" "}
              <b className="text-foreground">/start</b> yazınca burada görünür.
            </p>
          ) : (
            chats.map((c) => (
              <button
                key={c.chatId}
                onClick={() => onSend(c.chatId)}
                disabled={sending}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-foreground">
                    <User className="h-4 w-4" />
                  </span>
                  <span className="font-medium">{c.name || c.chatId}</span>
                </span>
                <Send className="h-4 w-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>

        {sending && (
          <p className="mt-3 text-sm text-muted-foreground">Gönderiliyor…</p>
        )}
        {msg && (
          <p
            className={`mt-3 text-sm font-medium ${
              msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Target;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Info({
  icon: Icon,
  text,
  muted,
}: {
  icon: typeof MapPin;
  text: string;
  muted?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className={`truncate ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {text}
      </span>
    </span>
  );
}
