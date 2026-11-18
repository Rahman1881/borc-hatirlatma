"use client";

import { useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HATIRLAT_SECENEK, HATIRLAT_VARSAYILAN, HAZIR_TURLER, KAPSAM_AD, hazirMi, type BelgeKapsam } from "@/lib/belge-turleri";
import type { Belge, Varlik } from "@/lib/belgeler";
import { Field, Modal, selectClass, type Snapshot } from "./ui";

const DIGER = "__diger__";
const MAX_MB = 20;

export type BelgeFormTarget = {
  belge?: Belge; // düzenlenecek belge
  yenile?: Belge; // yenilenecek (arşive alınacak) belge
  kapsam?: BelgeKapsam; // yeni belge için sabit kapsam
  varlikId?: number; // yeni belge için sabit araç/personel
};

type Op = (action: string, payload?: Record<string, unknown>, okMessage?: string) => Promise<(Snapshot & { id?: number }) | null>;

export function BelgeForm({
  target,
  varliklar,
  op,
  reload,
  onClose,
}: {
  target: BelgeFormTarget;
  varliklar: Varlik[];
  op: Op;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const src = target.belge ?? target.yenile;
  const kapsamSabit = Boolean(src || target.kapsam);
  const [kapsam, setKapsam] = useState<BelgeKapsam>(src?.kapsam ?? target.kapsam ?? "sirket");
  const [varlikId, setVarlikId] = useState<number>(src?.varlik_id ?? target.varlikId ?? 0);
  const ilkTur = src?.tur ?? "";
  const [secim, setSecim] = useState(ilkTur ? (hazirMi(src!.kapsam, ilkTur) ? ilkTur : DIGER) : "");
  const [ozelTur, setOzelTur] = useState(ilkTur && !hazirMi(src!.kapsam, ilkTur) ? ilkTur : "");
  const [belgeNo, setBelgeNo] = useState(target.belge?.belge_no ?? "");
  const [kurum, setKurum] = useState(src?.kurum ?? "");
  const [baslangic, setBaslangic] = useState(target.belge?.baslangic ?? "");
  const [bitis, setBitis] = useState(target.belge?.bitis ?? "");
  const [suresiz, setSuresiz] = useState(target.belge ? !target.belge.bitis : false);
  const [hatirlat, setHatirlat] = useState<number[]>((src?.hatirlat ?? HATIRLAT_VARSAYILAN).split(",").filter(Boolean).map(Number));
  const [notlar, setNotlar] = useState(target.belge?.notlar ?? "");
  const [yeniDosyalar, setYeniDosyalar] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const mevcutDosyalar = target.belge?.dosyalar ?? [];
  const secenekler = varliklar.filter((v) => v.tur === kapsam && (v.aktif || v.id === varlikId));
  const tur = secim === DIGER ? ozelTur.trim() : secim;

  function dosyaEkle(list: FileList | null) {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) toast.error(`"${f.name}" ${MAX_MB} MB'tan büyük, eklenmedi.`);
      else ok.push(f);
    }
    setYeniDosyalar((prev) => [...prev, ...ok]);
  }

  async function kaydet() {
    if (!tur) return toast.error("Belge türünü seçin ya da yazın.");
    if (kapsam !== "sirket" && !varlikId) return toast.error(kapsam === "arac" ? "Araç seçin." : "Personel seçin.");
    if (!suresiz && !bitis) return toast.error("Bitiş tarihini girin ya da “Süresiz” seçin.");
    setSaving(true);
    try {
      const res = await op("belge", {
        id: target.belge?.id,
        yenile: target.yenile?.id,
        kapsam,
        varlik_id: varlikId || null,
        tur,
        belge_no: belgeNo,
        kurum,
        baslangic: baslangic || null,
        bitis: suresiz ? null : bitis,
        hatirlat: hatirlat.join(","),
        notlar,
      });
      if (!res) return;
      const id = target.belge?.id ?? res.id;
      if (yeniDosyalar.length > 0 && id) {
        // Dosyalar tek tek yüklenir; biri takılırsa diğerleri yine kaydedilir.
        let hata = 0;
        for (const f of yeniDosyalar) {
          const form = new FormData();
          form.set("belgeId", String(id));
          form.append("dosya", f);
          const up = await fetch("/api/belgeler/dosya", { method: "POST", body: form });
          if (!up.ok) {
            hata++;
            const body = (await up.json().catch(() => ({}))) as { error?: string };
            toast.error(body.error || `"${f.name}" yüklenemedi.`);
          }
        }
        await reload();
        if (hata > 0) toast.warning("Belge kaydedildi ama bazı dosyalar yüklenemedi.");
        else toast.success("Belge ve dosyalar kaydedildi.");
      } else {
        toast.success(target.yenile ? "Belge yenilendi; eskisi arşive alındı." : "Belge kaydedildi.");
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={target.belge ? "Belgeyi düzenle" : target.yenile ? "Belgeyi yenile" : "Yeni belge"}
      description={
        target.yenile
          ? "Yeni tarihleri ve dosyayı girin. Eski kayıt silinmez, arşive alınır."
          : "Bitiş tarihi olan belgeler için süresi dolmadan Telegram hatırlatması gelir."
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kime ait">
          <select
            className={selectClass}
            value={kapsam}
            disabled={kapsamSabit}
            onChange={(e) => {
              setKapsam(e.target.value as BelgeKapsam);
              setVarlikId(0);
              setSecim("");
            }}
          >
            {(Object.keys(KAPSAM_AD) as BelgeKapsam[]).map((k) => (
              <option key={k} value={k}>
                {KAPSAM_AD[k]}
              </option>
            ))}
          </select>
        </Field>

        {kapsam !== "sirket" ? (
          <Field
            label={kapsam === "arac" ? "Araç" : "Personel"}
            hint={secenekler.length === 0 ? `Önce ${kapsam === "arac" ? "Araçlar" : "Personel"} sayfasından kayıt ekleyin.` : undefined}
          >
            <select
              className={selectClass}
              value={varlikId}
              disabled={Boolean(src || target.varlikId)}
              onChange={(e) => setVarlikId(Number(e.target.value))}
            >
              <option value={0}>Seçin…</option>
              {secenekler.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.ad}
                  {v.aciklama ? ` · ${v.aciklama}` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}

        <Field label="Belge türü" className={secim === DIGER ? "" : "sm:col-span-2"}>
          <select className={selectClass} value={secim} onChange={(e) => setSecim(e.target.value)}>
            <option value="">Seçin…</option>
            {HAZIR_TURLER[kapsam].map((g) => (
              <optgroup key={g.grup} label={g.grup}>
                {g.turler.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={DIGER}>Diğer (elle yaz)…</option>
          </select>
        </Field>
        {secim === DIGER && (
          <Field label="Belgenin adı">
            <Input autoFocus value={ozelTur} maxLength={120} placeholder="ör. Tabela İzin Belgesi" onChange={(e) => setOzelTur(e.target.value)} />
          </Field>
        )}

        <Field label="Belge / poliçe no">
          <Input value={belgeNo} maxLength={80} onChange={(e) => setBelgeNo(e.target.value)} />
        </Field>
        <Field label="Veren kurum / firma">
          <Input value={kurum} maxLength={120} placeholder="ör. EPDK, sigorta şirketi" onChange={(e) => setKurum(e.target.value)} />
        </Field>

        <Field label="Başlangıç / düzenlenme tarihi">
          <Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <Field label="Bitiş / geçerlilik tarihi">
            <Input type="date" value={suresiz ? "" : bitis} disabled={suresiz} onChange={(e) => setBitis(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={suresiz} onChange={(e) => setSuresiz(e.target.checked)} />
            Süresiz (bitiş tarihi yok, hatırlatma gelmez)
          </label>
        </div>

        {!suresiz && (
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium leading-none">Hatırlatma (bitişe kaç gün kala)</span>
            <div className="flex flex-wrap gap-1.5">
              {HATIRLAT_SECENEK.map((g) => {
                const on = hatirlat.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setHatirlat((prev) => (on ? prev.filter((x) => x !== g) : [...prev, g]))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {g === 0 ? "Son gün" : `${g} gün`}
                  </button>
                );
              })}
            </div>
            <span className="block text-xs text-muted-foreground">
              Süre dolduktan sonra belge yenilenene kadar haftada bir hatırlatılır.
            </span>
          </div>
        )}

        <Field label="Notlar" className="sm:col-span-2">
          <Textarea value={notlar} rows={2} maxLength={2000} onChange={(e) => setNotlar(e.target.value)} />
        </Field>

        <div className="space-y-2 sm:col-span-2">
          <span className="block text-sm font-medium leading-none">Dosyalar</span>
          {mevcutDosyalar.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <a href={`/api/belgeler/dosya/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                {d.ad}
              </a>
              <button
                type="button"
                title="Dosyayı sil"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (window.confirm(`"${d.ad}" silinsin mi?`)) void op("dosyaSil", { id: d.id }, "Dosya silindi.").then((r) => r && onClose());
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {yeniDosyalar.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">yüklenecek</span>
              <button
                type="button"
                title="Çıkar"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setYeniDosyalar((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              dosyaEkle(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="block text-xs text-muted-foreground">PDF, resim, Word ya da Excel; dosya başına en çok {MAX_MB} MB.</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Vazgeç
        </Button>
        <Button onClick={kaydet} disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </Modal>
  );
}
