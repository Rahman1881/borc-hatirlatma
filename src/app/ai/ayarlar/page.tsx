"use client";

import { useState, useEffect } from "react";
import { Panel, SectionTitle, Pill } from "@/components/ai/ui";
import { Database, FileText, Send, Bot, Check, X, KeyRound, FolderOpen, Clock } from "lucide-react";

type Integration = {
  key: string;
  name: string;
  desc: string;
  icon: typeof Database;
  // ready=false → entegrasyon henüz uygulanmadı ("Planlanıyor" gösterilir).
  // ready=true  → connected gerçek yapılandırma durumunu yansıtır.
  ready: boolean;
  connected: boolean;
  color: string;
};

const initial: Integration[] = [
  {
    key: "siberpet",
    name: "SiberPet",
    desc: "Market & otomasyon satış verisi",
    icon: Database,
    ready: false,
    connected: false,
    color: "#2563eb",
  },
  {
    key: "uyumsoft",
    name: "Uyumsoft Web Servisi",
    desc: "Yakıt e-faturaları ve fatura kayıtları",
    icon: FileText,
    ready: false,
    connected: false,
    color: "#f97316",
  },
  {
    key: "telegram",
    name: "Telegram Bot",
    desc: "Anlık sohbet ve otomatik raporlar",
    icon: Send,
    ready: false,
    connected: false,
    color: "#229ED9",
  },
  {
    key: "gemini",
    name: "Yapay Zeka (Gemini API)",
    desc: "Doğal dilde analiz ve müşteri taraması",
    icon: Bot,
    ready: true,
    connected: false,
    color: "#16a34a",
  },
];

export default function AyarlarPage() {
  const [items, setItems] = useState(initial);

  // Gemini ayarları
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [masked, setMasked] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // Google Places ayarları (müşteri bulucu için gerçek işletme verisi)
  const [placesApiKey, setPlacesApiKey] = useState("");
  const [placesMasked, setPlacesMasked] = useState("");
  const [placesConfigured, setPlacesConfigured] = useState(false);
  const [placesSaving, setPlacesSaving] = useState(false);
  const [placesSavedMsg, setPlacesSavedMsg] = useState("");

  // VRD klasör yolu (pompa satış dosyaları)
  const [vrdDir, setVrdDir] = useState("");
  const [vrdDirEffective, setVrdDirEffective] = useState("");
  const [vrdCheck, setVrdCheck] = useState<{ ok: boolean; xmlCount: number; error?: string } | null>(null);
  const [vrdSaving, setVrdSaving] = useState(false);
  const [vrdSavedMsg, setVrdSavedMsg] = useState("");

  // İstasyon bilgileri
  const [station, setStation] = useState({
    station_name: "",
    station_dealer_code: "",
    station_il: "",
    station_ilce: "",
    station_yetkili: "",
  });
  const [stationSaving, setStationSaving] = useState(false);
  const [stationSavedMsg, setStationSavedMsg] = useState("");

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(!!d.configured);
        setMasked(d.masked || "");
        if (d.model) setModel(d.model);
        setPlacesConfigured(!!d.placesConfigured);
        setPlacesMasked(d.placesMasked || "");
        setVrdDir(d.vrdDir || "");
        setVrdDirEffective(d.vrdDirEffective || "");
        setVrdCheck(d.vrdCheck || null);
        if (d.station) setStation((s) => ({ ...s, ...d.station }));
        setItems((s) =>
          s.map((x) => (x.key === "gemini" ? { ...x, connected: !!d.configured } : x))
        );
      })
      .catch(() => {});
  }, []);

  async function saveGemini() {
    setSaving(true);
    setSavedMsg("");
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Kaydedilemedi.");
      setConfigured(!!d.configured);
      setMasked(d.masked || "");
      setApiKey("");
      setSavedMsg("Kaydedildi.");
      setItems((s) =>
        s.map((x) => (x.key === "gemini" ? { ...x, connected: !!d.configured } : x))
      );
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : "Hata oluştu.");
    } finally {
      setSaving(false);
    }
  }

  async function savePlaces() {
    setPlacesSaving(true);
    setPlacesSavedMsg("");
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placesApiKey }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Kaydedilemedi.");
      setPlacesConfigured(!!d.placesConfigured);
      setPlacesMasked(d.placesMasked || "");
      setPlacesApiKey("");
      setPlacesSavedMsg("Kaydedildi.");
    } catch (err) {
      setPlacesSavedMsg(err instanceof Error ? err.message : "Hata oluştu.");
    } finally {
      setPlacesSaving(false);
    }
  }

  async function saveVrd() {
    setVrdSaving(true);
    setVrdSavedMsg("");
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vrdDir }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Kaydedilemedi.");
      setVrdDir(d.vrdDir || "");
      setVrdDirEffective(d.vrdDirEffective || "");
      setVrdCheck(d.vrdCheck || null);
      setVrdSavedMsg("Kaydedildi.");
    } catch (err) {
      setVrdSavedMsg(err instanceof Error ? err.message : "Hata oluştu.");
    } finally {
      setVrdSaving(false);
    }
  }

  async function saveStation() {
    setStationSaving(true);
    setStationSavedMsg("");
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Kaydedilemedi.");
      if (d.station) setStation((s) => ({ ...s, ...d.station }));
      setStationSavedMsg("Kaydedildi.");
    } catch (err) {
      setStationSavedMsg(err instanceof Error ? err.message : "Hata oluştu.");
    } finally {
      setStationSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Panel>
        <SectionTitle
          title="Yapay Zeka (Gemini)"
          action={
            configured ? (
              <Pill tone="positive">
                <Check className="h-3 w-3" /> Bağlı
              </Pill>
            ) : (
              <Pill tone="warning">
                <KeyRound className="h-3 w-3" /> Anahtar gerekli
              </Pill>
            )
          }
        />
        <p className="mb-4 -mt-2 text-sm text-muted-foreground">
          Sohbet ve analizler için Gemini API anahtarını girin. Anahtar
          sunucuda saklanır, tarayıcıya geri gönderilmez. İleride başka bir AI
          sağlayıcıya geçebiliriz.
        </p>
        <div className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Gemini API Anahtarı
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                configured ? `Kayıtlı: ${masked} (değiştirmek için yeni anahtar girin)` : "AIza..."
              }
              className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Model
            </span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={saveGemini}
              disabled={saving || (!apiKey.trim() && !configured)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
            {savedMsg && (
              <span className="text-xs text-muted-foreground">{savedMsg}</span>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Google Places (Müşteri Bulucu)"
          action={
            placesConfigured ? (
              <Pill tone="positive">
                <Check className="h-3 w-3" /> Bağlı
              </Pill>
            ) : (
              <Pill tone="warning">
                <KeyRound className="h-3 w-3" /> Anahtar gerekli
              </Pill>
            )
          }
        />
        <p className="mb-4 -mt-2 text-sm text-muted-foreground">
          Müşteri Bulucu, seçtiğin il/ilçedeki gerçek işletmeleri (ad, adres,
          telefon, harita) Google Places API ile bulur. Aynı Google Cloud
          projesinde &quot;Places API (New)&quot; servisini etkinleştirip
          anahtarı buraya gir. Anahtar sunucuda saklanır.
        </p>
        <div className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Google Places API Anahtarı
            </span>
            <input
              type="password"
              value={placesApiKey}
              onChange={(e) => setPlacesApiKey(e.target.value)}
              placeholder={
                placesConfigured
                  ? `Kayıtlı: ${placesMasked} (değiştirmek için yeni anahtar girin)`
                  : "AIza..."
              }
              className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={savePlaces}
              disabled={placesSaving || (!placesApiKey.trim() && !placesConfigured)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {placesSaving ? "Kaydediliyor…" : "Kaydet"}
            </button>
            {placesSavedMsg && (
              <span className="text-xs text-muted-foreground">{placesSavedMsg}</span>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Pompa Satış Verisi (VRD Klasörü)"
          action={
            vrdCheck?.ok ? (
              <Pill tone="positive">
                <Check className="h-3 w-3" /> {vrdCheck.xmlCount} dosya
              </Pill>
            ) : (
              <Pill tone="warning">
                <FolderOpen className="h-3 w-3" /> Erişilemiyor
              </Pill>
            )
          }
        />
        <p className="mb-4 -mt-2 text-sm text-muted-foreground">
          Satış Raporu, pompa satış dosyalarını (XML) bu klasörden okur. Sunucu
          bilgisayarda muhasebe ağ yolunu girin:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            \\192.168.0.10\J\VRD
          </code>
          . Boş bırakırsanız varsayılan yerel{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">data\vrd</code>{" "}
          klasörü kullanılır.
        </p>
        <div className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              VRD Klasör Yolu
            </span>
            <input
              value={vrdDir}
              onChange={(e) => setVrdDir(e.target.value)}
              placeholder={"\\\\192.168.0.10\\J\\VRD"}
              spellCheck={false}
              className="h-10 rounded-lg border bg-muted/50 px-3 font-mono text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Aktif klasör:</span>{" "}
            <code>{vrdDirEffective || "—"}</code>
            <br />
            {vrdCheck?.ok ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Erişilebilir · {vrdCheck.xmlCount} XML dosyası bulundu.
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Klasöre erişilemiyor{vrdCheck?.error ? `: ${vrdCheck.error}` : "."}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveVrd}
              disabled={vrdSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {vrdSaving ? "Kaydediliyor…" : "Kaydet"}
            </button>
            {vrdSavedMsg && (
              <span className="text-xs text-muted-foreground">{vrdSavedMsg}</span>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Entegrasyonlar" />
        <p className="mb-4 -mt-2 text-sm text-muted-foreground">
          Servislerin bağlantı durumu. Yapay Zeka anahtarı yukarıdaki panelden
          girilince &quot;Bağlı&quot; olur. Diğer entegrasyonlar planlama
          aşamasındadır.
        </p>
        <div className="space-y-3">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.key}
                className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-11 w-11 place-items-center rounded-lg"
                    style={{ background: `${it.color}1f`, color: it.color }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{it.name}</p>
                    <p className="text-xs text-muted-foreground">{it.desc}</p>
                  </div>
                </div>
                {!it.ready ? (
                  <Pill tone="neutral">
                    <Clock className="h-3 w-3" /> Planlanıyor
                  </Pill>
                ) : it.connected ? (
                  <Pill tone="positive">
                    <Check className="h-3 w-3" /> Bağlı
                  </Pill>
                ) : (
                  <Pill tone="warning">
                    <X className="h-3 w-3" /> Anahtar gerekli
                  </Pill>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="İstasyon Bilgileri" />
        <p className="mb-4 -mt-2 text-sm text-muted-foreground">
          İstasyon konumu, fiyat otomasyonu (EPDK/marka fiyatları) ve AI
          analizlerinde kullanılır. İl/ilçe doğru girilmezse fiyatlar yanlış
          ilden çekilir.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="İstasyon Adı"
            value={station.station_name}
            onChange={(v) => setStation((s) => ({ ...s, station_name: v }))}
          />
          <Field
            label="Bayi Kodu"
            value={station.station_dealer_code}
            placeholder="PO-…"
            onChange={(v) => setStation((s) => ({ ...s, station_dealer_code: v }))}
          />
          <Field
            label="İl"
            value={station.station_il}
            onChange={(v) => setStation((s) => ({ ...s, station_il: v }))}
          />
          <Field
            label="İlçe"
            value={station.station_ilce}
            onChange={(v) => setStation((s) => ({ ...s, station_ilce: v }))}
          />
          <Field
            label="Yetkili"
            value={station.station_yetkili}
            onChange={(v) => setStation((s) => ({ ...s, station_yetkili: v }))}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveStation}
            disabled={stationSaving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {stationSaving ? "Kaydediliyor…" : "Kaydet"}
          </button>
          {stationSavedMsg && (
            <span className="text-xs text-muted-foreground">{stationSavedMsg}</span>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}
