"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel, Pill } from "@/components/ai/ui";
import {
  Car,
  Search,
  ArrowLeft,
  FolderOpen,
  CalendarDays,
  Fuel,
  Clock,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  AnalitikShell,
  useAnalitik,
  tl,
  fuelTone,
  SEG_PILL,
  type Overview,
  type Profile,
  type PlateRow,
} from "../shared";

export default function PlakalarPage() {
  const state = useAnalitik();

  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  const openPlate = useCallback(async (q: string) => {
    const plate = q.trim();
    if (!plate) return;
    setProfileLoading(true);
    setProfileError("");
    setProfile(null);
    try {
      const res = await fetch(`/api/analitik?view=plaka&q=${encodeURIComponent(plate)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Plaka bulunamadı.");
      setProfile(d.profile as Profile);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Plaka bulunamadı.");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Derin bağlantı: /analitik/plakalar?plaka=XX
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plaka");
    if (p) {
      setQuery(p);
      openPlate(p);
    }
  }, [openPlate]);

  // Profil görünümü (bağımsız ekran)
  if (profile || profileLoading || profileError) {
    return (
      <PlateProfileView
        profile={profile}
        loading={profileLoading}
        error={profileError}
        onBack={() => {
          setProfile(null);
          setProfileError("");
          setQuery("");
          if (window.location.search) window.history.replaceState(null, "", "/analitik/plakalar");
        }}
      />
    );
  }

  return (
    <AnalitikShell
      state={state}
      title="Plakalar"
      subtitle="Plaka ara veya en değerli / en çok iskonto alan araçları incele."
      icon={<Car className="h-5 w-5" />}
    >
      {(ov) => (
        <div className="space-y-6">
          {/* Arama */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              openPlate(query);
            }}
            className="relative max-w-md"
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Plaka ara (örn. 34 ABC 123)"
              className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-sm"
            />
          </form>

          <PlateTable title="En Değerli Plakalar" hint="ciroya göre" icon={<Wallet className="h-4 w-4 text-muted-foreground" />} rows={ov.topByCiro} onOpen={openPlate} highlight="ciro" />
          <PlateTable title="En Çok İskonto Alan Plakalar" hint="iskontoya göre" icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />} rows={ov.topPlates} onOpen={openPlate} highlight="iskonto" />
        </div>
      )}
    </AnalitikShell>
  );
}

function PlateTable({
  title,
  hint,
  icon,
  rows,
  onOpen,
  highlight,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  rows: PlateRow[];
  onOpen: (q: string) => void;
  highlight: "ciro" | "iskonto";
}) {
  return (
    <Panel>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold">{title}</p>
        <span className="text-xs text-muted-foreground">— {hint} · satır seç → profil</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu dönemde peşin satış yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Plaka</th>
                <th className="px-3 py-2 text-center font-medium">Segment</th>
                <th className="px-3 py-2 text-right font-medium">Ziyaret</th>
                <th className="px-3 py-2 text-right font-medium">Litre</th>
                <th className="px-3 py-2 text-right font-medium">Ciro</th>
                <th className="px-3 py-2 text-right font-medium">İskonto</th>
                <th className="px-3 py-2 font-medium">Temsilci</th>
                <th className="py-2 pl-3 text-right font-medium">Son</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.plaka} onClick={() => onOpen(p.plaka)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                  <td className="py-2.5 pr-3 font-medium">{p.plaka}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Pill tone={SEG_PILL[p.segment].tone}>{SEG_PILL[p.segment].label}</Pill>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.ziyaret}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{tl(p.litre)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${highlight === "ciro" ? "font-semibold" : ""}`}>₺{tl(p.ciro)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums text-rose-600 ${highlight === "iskonto" ? "font-semibold" : ""}`}>₺{tl(p.iskonto)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.temsilci}</td>
                  <td className="py-2.5 pl-3 text-right text-xs text-muted-foreground">{p.sonZiyaret}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ————————————————————————————————————————————————————————————
// Plaka profili
// ————————————————————————————————————————————————————————————
function PlateProfileView({
  profile,
  loading,
  error,
  onBack,
}: {
  profile: Profile | null;
  loading: boolean;
  error: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Geri
        </button>
        {profile && (
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
              <Car className="h-5 w-5" />
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                {profile.plaka}{" "}
                <Pill tone={profile.segment === "Kaçan" ? "negative" : profile.segment === "Yeni" ? "primary" : "positive"}>
                  {profile.segment}
                </Pill>
              </h2>
              <p className="text-sm text-muted-foreground">
                {profile.ilkZiyaret} – {profile.sonZiyaret} · Genelde {profile.temsilci} ile
              </p>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <Panel className="py-10 text-center">
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        </Panel>
      ) : error ? (
        <Panel className="py-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">{error}</p>
          <p className="mt-1 text-sm text-muted-foreground">Plaka yalnız peşin (bireysel) satışlarda aranır. Formatı kontrol edin.</p>
        </Panel>
      ) : profile ? (
        <PlateProfileBody profile={profile} />
      ) : null}
    </div>
  );
}

function PlateProfileBody({ profile: p }: { profile: Profile }) {
  const maxMonth = Math.max(1, ...p.aylikTrend.map((m) => m.adet));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Ziyaret" value={String(p.ziyaret)} />
        <MiniStat label="Ort. Aralık" value={p.ortAralik} />
        <MiniStat label="Toplam Litre" value={tl(p.toplamLitre)} />
        <MiniStat label="Toplam Ciro" value={`₺${tl(p.toplamCiro)}`} />
        <MiniStat label="Toplam İskonto" value={`₺${tl(p.toplamIskonto)}`} accent="text-rose-600" />
        <MiniStat label="Saat Tercihi" value={p.saatTercihi} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Aylık Ziyaret Trendi (son 12 ay)</p>
          </div>
          <div className="flex items-end gap-1.5" style={{ height: 120 }}>
            {p.aylikTrend.map((m, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${m.ay}: ${m.adet} ziyaret`}>
                <div className="w-full rounded-t bg-gradient-to-t from-violet-500/50 to-fuchsia-500" style={{ height: `${(m.adet / maxMonth) * 95}px` }} />
                <span className="text-[9px] text-muted-foreground">{m.ay}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Fuel className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Yakıt Karması</p>
          </div>
          <div className="space-y-3">
            {p.yakitKarma.map((f) => {
              const tone = fuelTone(f.yakit);
              return (
                <div key={f.yakit}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${tone}`} />
                      {f.yakit}
                    </span>
                    <span className="font-semibold tabular-nums">%{f.pct}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${f.pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">En sık geliş saati:</span>
            <span className="font-medium">{p.saatTercihi}</span>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="mb-4 text-sm font-semibold">Son Alımlar</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Tarih</th>
                <th className="px-3 py-2 font-medium">Yakıt</th>
                <th className="px-3 py-2 text-right font-medium">Litre</th>
                <th className="px-3 py-2 text-right font-medium">Tutar</th>
                <th className="py-2 pl-3 text-right font-medium">İskonto</th>
              </tr>
            </thead>
            <tbody>
              {p.gecmis.map((g, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium">{g.tarih}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{g.yakit}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{tl(g.litre)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">₺{tl(g.tutar)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums text-rose-600">₺{tl(g.iskonto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${accent ?? ""}`}>{value}</p>
    </Panel>
  );
}
