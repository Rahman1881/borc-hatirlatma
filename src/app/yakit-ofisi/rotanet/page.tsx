"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, History, Pause, Pencil, Play, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RotaBaglanti, RotaFilo, RotaSonuc } from "@/lib/rotanet";
import { ErrorNote, PageHeader, fmtDate } from "../shared";

type Onizleme = { gun: number; filolar: { id: number; ad: string; kod: string; alim: number; plakalar: string[] }[] };
type Form = { id?: number; filoIds: number[]; anahtar: string; ara: string; onay: { sirket: string; onizleme: Onizleme } | null };
type Yanit = { ok?: boolean; error?: string; baglantilar?: RotaBaglanti[]; sirket?: string; onizleme?: Onizleme; sonuc?: RotaSonuc; gecmisGun?: number };

const gun = (ymd: string) => ymd.split("-").reverse().join(".");
const zaman = (ms: number | null) => (ms ? fmtDate(new Date(ms).toISOString(), true) : "—");
const bugun = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function durum(b: RotaBaglanti): { ad: string; variant: "default" | "secondary" | "destructive" } {
  if (b.anahtarGecersiz) return { ad: "Anahtar geçersiz", variant: "destructive" };
  if (!b.etkin) return { ad: "Durduruldu", variant: "secondary" };
  if (b.sonHata) return { ad: "Hata", variant: "destructive" };
  return { ad: "Etkin", variant: "default" };
}

// Bir gönderimin (ya da deneme gönderiminin) sonucu.
function Sonuc({ s }: { s: RotaSonuc }) {
  const atlanan = [
    s.hgs > 0 && `${s.hgs} HGS kaydı`,
    s.bozuk > 0 && `${s.bozuk} sıfır/eksi tutarlı ya da plakasız alım (Yakıt Ofisi no: ${s.bozukOrnek.join(", ")}${s.bozuk > s.bozukOrnek.length ? "…" : ""})`,
    s.tanimsiz > 0 && `${s.tanimsiz} türü tanınmayan alım`,
  ].filter(Boolean);
  // RotaNet kartı olmayan plakanın alımını yazmaz; kaç alımın bu yüzden kaldığı.
  const kartsiz = s.unmatched.length > 0 ? Math.max(0, s.gonderilen - s.written - s.existing - s.invalid) : 0;
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="text-muted-foreground">
          {gun(s.from)} – {gun(s.to)}:
        </span>{" "}
        {s.gonderilen === 0 ? (
          "Gönderilecek alım yok."
        ) : s.dryRun ? (
          <>
            {s.gonderilen} alım denendi: <b>{s.written}</b> yazılacak, {s.existing} zaten var.
          </>
        ) : (
          <>
            {s.gonderilen} alım gönderildi: <b>{s.written}</b> yeni yazıldı, {s.existing} zaten vardı.
          </>
        )}
      </p>
      {s.invalid > 0 && <p className="text-destructive">{s.invalid} alımı RotaNet biçimi bozuk diye atladı.</p>}
      {s.unmatched.length > 0 && (
        <p>
          <span className="text-amber-700 dark:text-amber-400">
            RotaNet&apos;te araç kartı bulunamayan plakalar ({s.unmatched.length} plaka{kartsiz > 0 ? `, ${kartsiz} alım yazılmadı` : ""}):
          </span>{" "}
          <span className="font-mono text-xs">{s.unmatched.join(", ")}</span>
        </p>
      )}
      {atlanan.length > 0 && <p className="text-muted-foreground">Gönderilmedi: {atlanan.join("; ")}.</p>}
    </div>
  );
}

export default function RotaNetPage() {
  const [list, setList] = useState<RotaBaglanti[] | null>(null);
  const [gecmisGun, setGecmisGun] = useState(90);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filolar, setFilolar] = useState<RotaFilo[] | null>(null);
  const [filoError, setFiloError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [denemeler, setDenemeler] = useState<Record<number, RotaSonuc>>({});
  const [gecmis, setGecmis] = useState<{ id: number; from: string; to: string } | null>(null);

  useEffect(() => {
    fetch("/api/yakit-ofisi/rotanet", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as Yanit;
        if (!r.ok) throw new Error(j.error || "Bağlantılar okunamadı.");
        setList(j.baglantilar ?? []);
        if (j.gecmisGun) setGecmisGun(j.gecmisGun);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Bağlantılar okunamadı."));
  }, []);

  // İşlem gönderir; hata olursa bildirir ve null döner. Bağlantı listesi her yanıtla yenilenir.
  const post = useCallback(async (key: string, body: Record<string, unknown>): Promise<Yanit | null> => {
    setBusy(key);
    try {
      const res = await fetch("/api/yakit-ofisi/rotanet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json()) as Yanit;
      if (j.baglantilar) setList(j.baglantilar);
      if (!res.ok) throw new Error(j.error || "İşlem yapılamadı.");
      return j;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "İşlem yapılamadı.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const openForm = (b?: RotaBaglanti) => {
    setForm({ id: b?.id, filoIds: b?.filolar.map((f) => f.id) ?? [], anahtar: "", ara: "", onay: null });
    if (filolar) return;
    setFiloError(null);
    fetch("/api/yakit-ofisi/rotanet?filolar=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Filo listesi alınamadı.");
        setFilolar(j.filolar);
      })
      .catch((e) => setFiloError(e instanceof Error ? e.message : "Filo listesi alınamadı."));
  };

  const filoAd = useMemo(() => new Map((filolar ?? []).map((f) => [f.id, f])), [filolar]);
  const eslesen = useMemo(() => {
    const q = (form?.ara ?? "").trim().toLocaleLowerCase("tr");
    if (!filolar || q.length < 2) return [];
    return filolar.filter((f) => `${f.ad} ${f.kod}`.toLocaleLowerCase("tr").includes(q)).slice(0, 40);
  }, [filolar, form?.ara]);

  const toggleFilo = (id: number) =>
    form && setForm({ ...form, onay: null, filoIds: form.filoIds.includes(id) ? form.filoIds.filter((x) => x !== id) : [...form.filoIds, id] });

  // Kaydetmeden önce: anahtar kimin, seçilen filolardan hangi plakalar gidecek?
  const sinaVeOnizle = async () => {
    if (!form) return;
    const sina = await post("sina", form.anahtar.trim() ? { action: "sina", anahtar: form.anahtar } : { action: "sina", id: form.id });
    if (!sina) return;
    const on = await post("onizle", { action: "onizle", filoIds: form.filoIds });
    if (!on?.onizleme) return;
    setForm((f) => f && { ...f, onay: { sirket: sina.sirket ?? "", onizleme: on.onizleme! } });
  };

  const kaydet = async () => {
    if (!form) return;
    const r = form.id
      ? await post("kaydet", { action: "guncelle", id: form.id, filoIds: form.filoIds, ...(form.anahtar.trim() ? { anahtar: form.anahtar } : {}) })
      : await post("kaydet", { action: "ekle", anahtar: form.anahtar, filoIds: form.filoIds });
    if (!r) return;
    toast.success(form.id ? "Bağlantı güncellendi." : "Bağlantı kuruldu. İlk gönderimden önce “Deneme gönderimi” ile kontrol edebilirsiniz.");
    setForm(null);
  };

  const gonder = async (b: RotaBaglanti, deneme: boolean, aralik?: { from: string; to: string }) => {
    const r = await post(`${deneme ? "deneme" : "gonder"}-${b.id}`, { action: aralik ? "gecmis" : "gonder", id: b.id, deneme, ...aralik });
    if (!r?.sonuc) return;
    const sonuc = r.sonuc;
    setDenemeler((d) => {
      const kalan = { ...d };
      delete kalan[b.id];
      if (sonuc.dryRun) kalan[b.id] = sonuc;
      return kalan;
    });
    toast.success(deneme ? "Deneme tamamlandı; RotaNet'e hiçbir şey yazılmadı." : "Gönderildi.");
    if (aralik && !deneme) setGecmis(null);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="RotaNet Bağlantısı" description="Seçilen filoların yakıt ve AdBlue alımlarını servis şirketinin RotaNet paneline gönderir." />

      {loadError && <ErrorNote message={loadError} />}

      {list?.length === 0 && !form && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Henüz bağlantı yok. Servis şirketi RotaNet&apos;te bir bağlantı anahtarı üretip size verir; burada o şirketin Yakıt Ofisi filosunu seçip
            anahtarı girersiniz.
          </CardContent>
        </Card>
      )}

      {list?.map((b) => {
        const d = durum(b);
        const mesgul = busy !== null;
        const gecersiz = b.anahtarGecersiz;
        return (
          <Card key={b.id}>
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{b.sirket || "RotaNet bağlantısı"}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anahtar: <span className="font-mono">{b.anahtarIpucu || "—"}</span>
                </p>
              </div>
              <Badge variant={d.variant}>{d.ad}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {b.filolar.map((f) => (
                  <span key={f.id} className="rounded-md border px-2 py-0.5 text-xs">
                    {f.ad}
                    {f.kod && <span className="text-muted-foreground"> · {f.kod}</span>}
                  </span>
                ))}
              </div>

              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Son gönderim:</span> {zaman(b.sonGonderim)}
                </p>
                {b.sonSonuc && <Sonuc s={b.sonSonuc} />}
              </div>

              {b.sonHata && (
                <ErrorNote
                  message={`${b.sonHata}${b.sonDeneme ? ` (${zaman(b.sonDeneme)})` : ""}${gecersiz ? " Yeni anahtar girilene kadar bu bağlantıdan gönderim yapılmaz." : ""}`}
                />
              )}

              {denemeler[b.id] && (
                <div className="rounded-lg border border-dashed p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Deneme gönderimi (RotaNet&apos;e yazılmadı)</p>
                  <Sonuc s={denemeler[b.id]} />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" disabled={mesgul || gecersiz} onClick={() => gonder(b, false)}>
                  <Send className="h-4 w-4" />
                  {busy === `gonder-${b.id}` ? "Gönderiliyor…" : "Şimdi gönder"}
                </Button>
                <Button size="sm" variant="outline" disabled={mesgul || gecersiz} onClick={() => gonder(b, true)}>
                  <FlaskConical className="h-4 w-4" />
                  {busy === `deneme-${b.id}` ? "Deneniyor…" : "Deneme gönderimi"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mesgul || gecersiz}
                  onClick={() => setGecmis(gecmis?.id === b.id ? null : { id: b.id, from: bugun(), to: bugun() })}
                >
                  <History className="h-4 w-4" />
                  Geçmişi gönder
                </Button>
                <Button size="sm" variant="outline" disabled={mesgul} onClick={() => openForm(b)}>
                  <Pencil className="h-4 w-4" />
                  {gecersiz ? "Yeni anahtar gir" : "Düzenle"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mesgul}
                  onClick={async () => {
                    if (await post(`durum-${b.id}`, { action: "durum", id: b.id, etkin: !b.etkin })) toast.success(b.etkin ? "Otomatik gönderim durduruldu." : "Otomatik gönderim başlatıldı.");
                  }}
                >
                  {b.etkin ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {b.etkin ? "Durdur" : "Başlat"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mesgul}
                  onClick={async () => {
                    if (!window.confirm(`"${b.sirket || "RotaNet"}" bağlantısı silinsin mi? RotaNet'e daha önce gönderilen kayıtlar silinmez.`)) return;
                    if (await post(`sil-${b.id}`, { action: "sil", id: b.id })) toast.success("Bağlantı silindi.");
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Sil
                </Button>
              </div>

              {gecmis?.id === b.id && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`gf-${b.id}`}>Başlangıç</Label>
                    <Input id={`gf-${b.id}`} type="date" max={gecmis.to} value={gecmis.from} onChange={(e) => setGecmis({ ...gecmis, from: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`gt-${b.id}`}>Bitiş</Label>
                    <Input id={`gt-${b.id}`} type="date" max={bugun()} value={gecmis.to} onChange={(e) => setGecmis({ ...gecmis, to: e.target.value })} />
                  </div>
                  <Button size="sm" disabled={mesgul} onClick={() => gonder(b, false, { from: gecmis.from, to: gecmis.to })}>
                    Bu aralığı gönder
                  </Button>
                  <Button size="sm" variant="outline" disabled={mesgul} onClick={() => gonder(b, true, { from: gecmis.from, to: gecmis.to })}>
                    Önce dene
                  </Button>
                  <p className="basis-full text-xs text-muted-foreground">En fazla {gecmisGun} gün. Daha önce gönderilmiş alımlar ikinci kez yazılmaz.</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {form ? (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">{form.id ? "Bağlantıyı düzenle" : "Yeni bağlantı"}</CardTitle>
            <Button size="icon-sm" variant="ghost" aria-label="Kapat" onClick={() => setForm(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rn-ara">Filo</Label>
              {form.filoIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.filoIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleFilo(id)}
                      title="Çıkar"
                      className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs hover:bg-muted/60"
                    >
                      {filoAd.get(id)?.ad ?? `Filo ${id}`}
                      {filoAd.get(id)?.kod && <span className="text-muted-foreground">· {filoAd.get(id)?.kod}</span>}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
              <Input
                id="rn-ara"
                value={form.ara}
                placeholder={filolar ? "Filo adı ya da kodu yazın…" : "Filo listesi yükleniyor…"}
                disabled={!filolar}
                onChange={(e) => setForm({ ...form, ara: e.target.value })}
              />
              {filoError && <ErrorNote message={filoError} />}
              {form.ara.trim().length >= 2 && (
                <div className="max-h-56 overflow-y-auto rounded-lg border">
                  {eslesen.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">Eşleşen filo yok.</p>
                  ) : (
                    eslesen.map((f) => (
                      <label key={f.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
                        <input type="checkbox" checked={form.filoIds.includes(f.id)} onChange={() => toggleFilo(f.id)} />
                        <span>{f.ad}</span>
                        <span className="text-xs text-muted-foreground">{f.kod}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Servis şirketinin Yakıt Ofisi&apos;ndeki filosu. Şirketin birden çok filosu varsa hepsini seçin. Yalnız seçilen filoların alımları
                gönderilir.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rn-key">RotaNet bağlantı anahtarı</Label>
              <Input
                id="rn-key"
                type="password"
                autoComplete="off"
                value={form.anahtar}
                placeholder={form.id ? "Değiştirmeyecekseniz boş bırakın" : "rnf_…"}
                onChange={(e) => setForm({ ...form, anahtar: e.target.value, onay: null })}
              />
              <p className="text-xs text-muted-foreground">Anahtarı servis şirketi RotaNet&apos;te üretir. Portal anahtarın tamamını bir daha göstermez.</p>
            </div>

            {!form.onay ? (
              <Button disabled={busy !== null || form.filoIds.length === 0 || (!form.id && !form.anahtar.trim())} onClick={sinaVeOnizle}>
                {busy === "sina" || busy === "onizle" ? "Kontrol ediliyor…" : "Anahtarı sına ve önizle"}
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
                <p>
                  Bu anahtar RotaNet&apos;te <b>{form.onay.sirket || "(şirket adı gelmedi)"}</b> şirketine ait. Aşağıdaki filoların yakıt ve AdBlue alımları
                  bu şirkete gönderilecek:
                </p>
                <ul className="space-y-2">
                  {form.onay.onizleme.filolar.map((f) => (
                    <li key={f.id}>
                      <span className="font-medium">{f.ad}</span>
                      <span className="text-muted-foreground">
                        {f.kod && ` · ${f.kod}`} — son {form.onay!.onizleme.gun} günde {f.alim} alım, {f.plakalar.length} plaka
                      </span>
                      {f.plakalar.length > 0 && (
                        <div className="font-mono text-xs text-muted-foreground">
                          {f.plakalar.slice(0, 40).join(", ")}
                          {f.plakalar.length > 40 && ` … +${f.plakalar.length - 40}`}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">Şirket ve plakalar doğruysa kaydedin. Yanlış filo seçilirse başka bir müşterinin alımları bu şirkete gider.</p>
                <div className="flex gap-2">
                  <Button disabled={busy !== null} onClick={kaydet}>
                    {busy === "kaydet" ? "Kaydediliyor…" : "Doğru, kaydet"}
                  </Button>
                  <Button variant="outline" disabled={busy !== null} onClick={() => setForm({ ...form, onay: null })}>
                    Geri dön
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        list && (
          <Button onClick={() => openForm()}>
            <Plus className="h-4 w-4" />
            Yeni bağlantı
          </Button>
        )
      )}

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Ne gönderilir?</p>
          <p>
            Yalnız seçilen filoların yakıt ve AdBlue alımları: alım numarası, plaka, tarih, litre, ödenen tutar, ürün ve istasyon. HGS kayıtları,
            müşteri adı, borç ve limit gibi başka hiçbir bilgi gönderilmez.
          </p>
          <p>
            Otomatik gönderim 15 dakikada bir son 3 günün alımlarını yollar; RotaNet aynı alımı ikinci kez yazmaz. Yakıt Ofisi&apos;nden yalnız veri
            okunur.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
