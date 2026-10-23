"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import { TrendingUp, RefreshCw, Save, AlertTriangle, Send, Settings2 } from "lucide-react";

type Fuel = "motorin" | "benzin";
type Level = "zam" | "zam_yakin" | "notr" | "indirim_yakin" | "indirim";

type PumpChange = { tarih: string; yakit: Fuel; eski: number; yeni: number; fark: number; ignored: boolean };
type FuelRow = {
  tarih: string;
  raw: number;
  kontrat: string;
  usd: number;
  pct: number;
  tl: number;
  level: Level;
  change: PumpChange | null;
  baseTarih: string;
  calibrating: boolean;
};
type Config = {
  enabled: boolean;
  esikPct: number;
  ortalamaGun: number;
  katsayiMotorin: number;
  katsayiBenzin: number;
  eselPay: number;
  gunlukDurum: boolean;
  yoksay: string[];
};
type PriceRow = {
  tarih: string;
  ho: number | null;
  ho_kontrat: string | null;
  rb: number | null;
  rb_kontrat: string | null;
  brent: number | null;
  usd: number;
  motorin: FuelRow | null;
  benzin: FuelRow | null;
};
type Data = {
  config: Config;
  fetchTime: string;
  lastFetched: number | null;
  latest: Record<Fuel, FuelRow | null>;
  lastChange: Record<Fuel, PumpChange | null>;
  rows: PriceRow[];
  changes: (PumpChange & { estimate: FuelRow | null })[];
  statusText: string;
  error?: string;
};

const FUELS: { key: Fuel; label: string; source: string }[] = [
  { key: "motorin", label: "Motorin", source: "ABD motorin (Heating Oil)" },
  { key: "benzin", label: "Benzin", source: "ABD benzin (RBOB)" },
];

const LEVEL: Record<Level, { text: string; tone: "negative" | "warning" | "neutral" | "positive" | "primary" }> = {
  zam: { text: "Zam bekleniyor", tone: "negative" },
  zam_yakin: { text: "Zam yaklaşıyor", tone: "warning" },
  notr: { text: "Belirgin hareket yok", tone: "neutral" },
  indirim_yakin: { text: "İndirim yaklaşıyor", tone: "primary" },
  indirim: { text: "İndirim bekleniyor", tone: "positive" },
};

const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TR_MONTHS[m - 1]} ${y}`;
}
function num(n: number, digits = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(n: number, digits = 2): string {
  const s = num(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}
function pct(n: number): string {
  const s = `%${num(Math.abs(n), 1)}`;
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}
function pctTone(r: FuelRow | null): string {
  if (!r) return "text-muted-foreground";
  if (r.level === "zam") return "text-red-600";
  if (r.level === "zam_yakin") return "text-amber-600";
  if (r.level === "indirim") return "text-emerald-600";
  if (r.level === "indirim_yakin") return "text-primary";
  return "text-muted-foreground";
}
function kontratAd(k: string | null): string {
  return k ? k.replace(".NYM", "") : "—";
}

// Sapma göstergesi: ortada 0, iki yanda eşik; bar ortadan sapmaya doğru dolar.
function Gauge({ value, esik }: { value: number; esik: number }) {
  const span = esik * 1.5;
  const clamp = Math.max(-span, Math.min(span, value));
  const pos = (v: number) => 50 + (v / span) * 50;
  const left = Math.min(pos(0), pos(clamp));
  const width = Math.abs(pos(clamp) - pos(0));
  const color =
    value >= esik
      ? "bg-red-500"
      : value >= esik * 0.7
        ? "bg-amber-500"
        : value <= -esik
          ? "bg-emerald-500"
          : value <= -esik * 0.7
            ? "bg-primary"
            : "bg-muted-foreground/50";
  return (
    <div className="relative mt-3 h-3 rounded-full bg-muted">
      <div className={`absolute top-0 h-3 rounded-full ${color}`} style={{ left: `${left}%`, width: `${width}%` }} />
      {[-esik, 0, esik].map((m) => (
        <div key={m} className="absolute -top-1 h-5 w-px bg-foreground/40" style={{ left: `${pos(m)}%` }} />
      ))}
      {[
        [-esik, `−%${num(esik, 1)}`],
        [0, "0"],
        [esik, `+%${num(esik, 1)}`],
      ].map(([v, label]) => (
        <div
          key={String(v)}
          className="absolute top-4 -translate-x-1/2 text-[10px] text-muted-foreground"
          style={{ left: `${pos(Number(v))}%` }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

export default function ZamTahminiPage() {
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [showCfg, setShowCfg] = useState(false);

  const apply = useCallback((d: Data) => {
    setData(d);
    setCfg(d.config);
  }, []);

  useEffect(() => {
    fetch("/api/ai/zam-tahmini")
      .then((r) => r.json())
      .then((d: Data) => {
        if (d.error) throw new Error(d.error);
        apply(d);
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : "Yüklenemedi." }));
  }, [apply]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ai/zam-tahmini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as Data;
      if (!r.ok || d.error) throw new Error(d.error || "İşlem başarısız.");
      apply(d);
      return d;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "İşlem başarısız." });
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!data || !cfg) {
    return (
      <Panel className="py-10 text-center">
        <p className="text-sm text-muted-foreground">{msg?.text || "Yükleniyor…"}</p>
      </Panel>
    );
  }

  const empty = data.rows.length === 0;

  return (
    <div className="space-y-6">
      <Panel className="bg-gradient-to-r from-orange-500/10 via-card to-card">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Zam/İndirim Tahmini</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Pompa fiyatı, Avrupa ürün fiyatı × dolar kuruyla oluşur; son pompa değişikliğinden beri bu maliyet
              eşiği aşınca zam ya da indirim gelir. Sistem her iş günü Avrupa kapanışında (saat ~{data.fetchTime})
              ABD motorin/benzin vadelilerini ve TCMB kurunu kendisi çeker, sapmayı hesaplar ve Telegram&apos;da
              rapor alanlara bildirir. Tahmindir; resmi formül yayınlanmaz.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cfg.enabled}
              disabled={busy}
              onChange={(e) => post({ action: "config", enabled: e.target.checked })}
            />
            Otomatik takip ve Telegram
          </label>
        </div>
      </Panel>

      {/* Durum */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FUELS.map((f) => {
          const r = data.latest[f.key];
          const ch = data.lastChange[f.key];
          return (
            <Panel key={f.key}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {r
                      ? `${fmtDay(r.tarih)} · ${f.source} ${num(r.raw, 3)} $/gal (${kontratAd(r.kontrat)}) · kur ${num(r.usd, 4)}`
                      : "Henüz veri yok"}
                  </p>
                </div>
                {r && <Pill tone={LEVEL[r.level].tone}>{LEVEL[r.level].text}</Pill>}
              </div>
              {r ? (
                <>
                  <div className="mt-3 flex items-baseline gap-3">
                    <span className={`text-3xl font-semibold ${pctTone(r)}`}>{pct(r.pct)}</span>
                    <span className="text-sm text-muted-foreground">
                      ≈ <b className="text-foreground">{signed(r.tl)} TL/lt</b> pompaya yansıma
                    </span>
                  </div>
                  <Gauge value={r.pct} esik={data.config.esikPct} />
                  <p className="mt-7 text-xs text-muted-foreground">
                    {ch
                      ? `Son pompa değişikliği: ${fmtDay(ch.tarih)} (${signed(ch.fark)} TL) · baz ${fmtDay(r.baseTarih)} kapanışı`
                      : `Henüz pompa değişikliği görülmedi · baz ${fmtDay(r.baseTarih)}`}
                  </p>
                  {r.calibrating && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Son değişiklikten önceki piyasa verisi yok; sapma ilk kapanıştan hesaplanıyor.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Veri her iş günü ~{data.fetchTime} sonrası otomatik gelir. Hemen doldurmak için &quot;Şimdi
                  güncelle&quot;ye basın.
                </p>
              )}
            </Panel>
          );
        })}
      </div>

      {/* Veri kaynağı */}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Veri</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Piyasa: Yahoo Finance — ABD motorin (Heating Oil) ve benzin (RBOB) vadelileri, her gün Londra 16:30
              fiyatı (Platts/ICE kapanışıyla aynı an). Kur: TCMB. Gerçekleşen değişiklikler: Opet Serdivan fiyat
              arşivi.
              {data.lastFetched ? ` Son çekim: ${new Date(data.lastFetched).toLocaleString("tr-TR")}.` : ""}
            </p>
          </div>
          <button
            onClick={() =>
              post({ action: "refresh" }).then((d) => d && setMsg({ ok: true, text: "Veriler güncellendi." }))
            }
            disabled={busy}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {empty ? "Geçmişi doldur" : "Şimdi güncelle"}
          </button>
        </div>
        {msg && <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
        <details className="mt-4 text-sm">
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <Send className="h-3.5 w-3.5" /> Telegram mesajı önizleme
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-sans text-sm">
            {data.statusText.replace(/<[^>]+>/g, "")}
          </pre>
        </details>
      </Panel>

      {/* Gerçekleşen değişiklikler */}
      <Panel>
        <p className="text-sm font-semibold">Gerçekleşen pompa değişiklikleri (Opet Serdivan)</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Modelin değişiklikten önceki son kapanışta söylediğiyle karşılaştırma. 0,30 TL&apos;nin altındaki marj
          oynamaları sayılmaz. ÖTV artışı gibi piyasa dışı değişiklikleri &quot;baz say&quot; işaretini kaldırarak
          hariç tutun.
        </p>
        {data.changes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Henüz değişiklik kaydı yok.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Tarih</th>
                  <th className="py-2 pr-3 font-medium">Yakıt</th>
                  <th className="py-2 pr-3 font-medium">Değişim</th>
                  <th className="py-2 pr-3 font-medium">Model beklentisi</th>
                  <th className="py-2 font-medium">Baz</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c) => {
                  const right = c.estimate && c.estimate.pct * c.fark > 0;
                  return (
                    <tr key={`${c.tarih}-${c.yakit}`} className={`border-b last:border-0 ${c.ignored ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-3">{fmtDay(c.tarih)}</td>
                      <td className="py-2 pr-3">{c.yakit === "motorin" ? "Motorin" : "Benzin"}</td>
                      <td className={`py-2 pr-3 font-medium ${c.fark > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {signed(c.fark)} TL{" "}
                        <span className="font-normal text-muted-foreground">
                          ({num(c.eski)} → {num(c.yeni)})
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {c.estimate ? (
                          <>
                            {signed(c.estimate.tl)} TL{" "}
                            <span className="text-muted-foreground">({pct(c.estimate.pct)})</span>{" "}
                            <span className={right ? "text-emerald-600" : "text-red-600"}>{right ? "✓ yön" : "✗ yön"}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">veri yok</span>
                        )}
                      </td>
                      <td className="py-2">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={!c.ignored}
                            disabled={busy}
                            onChange={(e) =>
                              post({ action: "ignore", tarih: c.tarih, yakit: c.yakit, ignored: !e.target.checked })
                            }
                          />
                          baz say
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Piyasa verisi */}
      <Panel>
        <p className="text-sm font-semibold">Günlük piyasa verisi (Londra 16:30)</p>
        {empty ? (
          <p className="mt-3 text-sm text-muted-foreground">Henüz veri yok.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Gün</th>
                  <th className="py-2 pr-3 font-medium">ABD motorin $/gal</th>
                  <th className="py-2 pr-3 font-medium">ABD benzin $/gal</th>
                  <th className="py-2 pr-3 font-medium">Brent $</th>
                  <th className="py-2 pr-3 font-medium">Kur</th>
                  <th className="py-2 pr-3 font-medium">Motorin sapma</th>
                  <th className="py-2 font-medium">Benzin sapma</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((q) => (
                  <tr key={q.tarih} className="border-b last:border-0">
                    <td className="py-2 pr-3">{fmtDay(q.tarih)}</td>
                    <td className="py-2 pr-3">
                      {q.ho != null ? num(q.ho, 3) : "—"}{" "}
                      <span className="text-xs text-muted-foreground">{kontratAd(q.ho_kontrat)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {q.rb != null ? num(q.rb, 3) : "—"}{" "}
                      <span className="text-xs text-muted-foreground">{kontratAd(q.rb_kontrat)}</span>
                    </td>
                    <td className="py-2 pr-3">{q.brent != null ? num(q.brent, 1) : "—"}</td>
                    <td className="py-2 pr-3">{num(q.usd, 4)}</td>
                    <td className={`py-2 pr-3 ${pctTone(q.motorin)}`}>
                      {q.motorin ? `${pct(q.motorin.pct)} · ${signed(q.motorin.tl)} TL` : "—"}
                    </td>
                    <td className={`py-2 ${pctTone(q.benzin)}`}>
                      {q.benzin ? `${pct(q.benzin.pct)} · ${signed(q.benzin.tl)} TL` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Ayarlar */}
      <Panel>
        <button onClick={() => setShowCfg((s) => !s)} className="flex items-center gap-1.5 text-sm font-semibold">
          <Settings2 className="h-4 w-4" /> Hesap ayarları
        </button>
        {showCfg && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ["esikPct", "Eşik (%)", "0.1"],
                  ["ortalamaGun", "Ortalama (kapanış)", "1"],
                  ["katsayiMotorin", "Motorin katsayı", "0.05"],
                  ["katsayiBenzin", "Benzin katsayı", "0.05"],
                  ["eselPay", "Eşel mobil payı (%)", "1"],
                ] as const
              ).map(([key, label, step]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    step={step}
                    value={cfg[key]}
                    onChange={(e) => setCfg({ ...cfg, [key]: Number(e.target.value) })}
                    className="h-10 rounded-lg border bg-muted/50 px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg.gunlukDurum}
                onChange={(e) => setCfg({ ...cfg, gunlukDurum: e.target.checked })}
              />
              Her gün durum gönder (kapalıysa yalnız &quot;yaklaşıyor / bekleniyor&quot; durumu değişince)
            </label>
            <p className="text-xs text-muted-foreground">
              Varsayılanlar 2023–2026 geçmiş testinden: 3 kapanış ortalaması ve %3 eşikle motorin alarmlarının
              ~3&apos;te 2&apos;si 5 iş günü içinde aynı yönde değişiklikle sonuçlandı (ortalama ~3 iş günü önce).
              Katsayı, hesaplanan tutarın pompaya ne kadar yansıdığıdır (motorin ~1,3, benzin ~0,95). Eşel mobil
              uygulanırsa, zammın devletin ÖTV&apos;den karşıladığı payı girin.
            </p>
            <button
              onClick={() =>
                post({ action: "config", ...cfg }).then((d) => d && setMsg({ ok: true, text: "Ayarlar kaydedildi." }))
              }
              disabled={busy}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Ayarları kaydet
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
