"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Varlik } from "@/lib/belgeler";
import { BelgeListe } from "./belge-liste";
import { Box, Empty, Field, Loading, Modal, PageHeader, Tag, durumOf, useBelgeler } from "./ui";

const METIN = {
  arac: {
    baslik: "Araç Belgeleri",
    aciklama: "Araçların ruhsat, sigorta, muayene, ADR ve diğer belgeleri. Araç seçip belgelerini görün ya da ekleyin.",
    ekle: "Araç ekle",
    ad: "Plaka",
    adOrnek: "34 ABC 123",
    not: "Marka / model / açıklama",
    notOrnek: "ör. Mercedes Actros · tanker",
    bos: "Henüz araç eklenmemiş.",
    sec: "Belgelerini görmek için soldan bir araç seçin.",
  },
  personel: {
    baslik: "Personel Belgeleri",
    aciklama: "Personelin özlük dosyası: kimlik, sözleşme, sağlık raporu, eğitim ve sürücü belgeleri.",
    ekle: "Personel ekle",
    ad: "Ad soyad",
    adOrnek: "",
    not: "Görev",
    notOrnek: "ör. Pompacı, tanker şoförü",
    bos: "Henüz personel eklenmemiş.",
    sec: "Belgelerini görmek için soldan bir kişi seçin.",
  },
} as const;

// Araçlar ve Personel sayfaları aynı düzeni kullanır: solda kayıtlar, sağda seçilenin belgeleri.
export function VarlikSayfa({ tur }: { tur: "arac" | "personel" }) {
  const m = METIN[tur];
  const { data, failed, busy, op, reload } = useBelgeler();
  const [seciliId, setSeciliId] = useState<number | null>(null);
  const [ara, setAra] = useState("");
  const [form, setForm] = useState<Partial<Varlik> | null>(null);

  if (!data) return <Loading failed={failed} />;

  const q = ara.trim().toLocaleLowerCase("tr");
  const kayitlar = data.varliklar.filter((v) => v.tur === tur);
  const liste = kayitlar.filter((v) => !q || `${v.ad} ${v.aciklama}`.toLocaleLowerCase("tr").includes(q));
  const secili = kayitlar.find((v) => v.id === seciliId) ?? null;
  const ozet = (id: number) => {
    const ds = data.belgeler.filter((b) => b.varlik_id === id && b.durum === "gecerli").map((b) => durumOf(b, data.bugun).kod);
    return { toplam: ds.length, gecti: ds.filter((k) => k === "gecti").length, yakin: ds.filter((k) => k === "yakin").length };
  };

  async function kaydet() {
    if (!form) return;
    const res = await op("varlik", { tur, id: form.id, ad: form.ad ?? "", aciklama: form.aciklama ?? "", aktif: form.aktif !== 0 }, "Kaydedildi.");
    if (res) {
      if (!form.id && res.id) setSeciliId(res.id);
      setForm(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.baslik}
        description={m.aciklama}
        action={
          <Button onClick={() => setForm({ aktif: 1 })}>
            <Plus className="h-4 w-4" />
            {m.ekle}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <Box className="space-y-3 p-3">
          <Input value={ara} placeholder="Ara…" aria-label="Ara" onChange={(e) => setAra(e.target.value)} />
          {liste.length === 0 ? (
            <Empty>{kayitlar.length === 0 ? m.bos : "Eşleşen kayıt yok."}</Empty>
          ) : (
            <ul className="space-y-1">
              {liste.map((v) => {
                const o = ozet(v.id);
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      aria-current={v.id === seciliId ? "true" : undefined}
                      onClick={() => setSeciliId(v.id)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2 text-left transition-colors",
                        v.id === seciliId ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
                        !v.aktif && "opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{v.ad}</span>
                        <span className="flex shrink-0 gap-1">
                          {o.gecti > 0 && <Tag tone="red">{o.gecti} doldu</Tag>}
                          {o.yakin > 0 && <Tag tone="amber">{o.yakin} yakın</Tag>}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[v.aciklama, `${o.toplam} belge`, !v.aktif && "pasif"].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Box>

        <Box>
          {!secili ? (
            <Empty>{kayitlar.length === 0 ? `“${m.ekle}” ile başlayın.` : m.sec}</Empty>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">
                    {secili.ad} {!secili.aktif && <Tag>Pasif</Tag>}
                  </h3>
                  {secili.aciklama && <p className="text-sm text-muted-foreground">{secili.aciklama}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setForm(secili)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Düzenle
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`"${secili.ad}" kaydı silinsin mi?`))
                        void op("varlikSil", { id: secili.id }, "Kayıt silindi.").then((r) => r && setSeciliId(null));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Sil
                  </Button>
                </div>
              </div>
              <BelgeListe
                data={data}
                belgeler={data.belgeler.filter((b) => b.varlik_id === secili.id)}
                op={op}
                reload={reload}
                yeni={{ kapsam: tur, varlikId: secili.id }}
                bos="Bu kayda henüz belge eklenmemiş."
              />
            </div>
          )}
        </Box>
      </div>

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? "Kaydı düzenle" : m.ekle}>
          <div className="space-y-4">
            <Field label={m.ad}>
              <Input autoFocus value={form.ad ?? ""} maxLength={120} placeholder={m.adOrnek} onChange={(e) => setForm({ ...form, ad: e.target.value })} />
            </Field>
            <Field label={m.not}>
              <Input value={form.aciklama ?? ""} maxLength={200} placeholder={m.notOrnek} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} />
            </Field>
            {form.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.aktif !== 0} onChange={(e) => setForm({ ...form, aktif: e.target.checked ? 1 : 0 })} />
                Aktif (pasif kayıtlar için hatırlatma gönderilmez)
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>
                Vazgeç
              </Button>
              <Button onClick={kaydet} disabled={busy}>
                Kaydet
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
