"use client";

import { useState } from "react";
import { Paperclip, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KAPSAM_AD, tarihYaz, type BelgeKapsam } from "@/lib/belge-turleri";
import type { Belge } from "@/lib/belgeler";
import { BelgeForm, type BelgeFormTarget } from "./belge-form";
import { DurumTag, Empty, durumOf, type Snapshot, type useBelgeler } from "./ui";

const SIRA = { gecti: 0, yakin: 1, gecerli: 2, suresiz: 3, arsiv: 4 } as const;

// Belge tablosu: durum, dosyalar ve işlemler (yenile, düzenle, sil). `yeni` verilirse
// "Belge ekle" düğmesi o kapsam/araç/personel için form açar.
export function BelgeListe({
  data,
  belgeler,
  op,
  reload,
  showSahip,
  yeni,
  bos = "Henüz belge eklenmemiş.",
}: {
  data: Snapshot;
  belgeler: Belge[];
  op: ReturnType<typeof useBelgeler>["op"];
  reload: () => Promise<void>;
  showSahip?: boolean;
  yeni?: { kapsam?: BelgeKapsam; varlikId?: number };
  bos?: string;
}) {
  const [form, setForm] = useState<BelgeFormTarget | null>(null);
  const [arsiv, setArsiv] = useState(false);

  const sahip = (b: Belge) =>
    b.kapsam === "sirket" ? "Şirket" : (data.varliklar.find((v) => v.id === b.varlik_id)?.ad ?? KAPSAM_AD[b.kapsam]);
  const arsivSayisi = belgeler.filter((b) => b.durum === "arsiv").length;
  const rows = belgeler
    .filter((b) => arsiv || b.durum !== "arsiv")
    .map((b) => ({ b, d: durumOf(b, data.bugun) }))
    .sort((x, y) => SIRA[x.d.kod] - SIRA[y.d.kod] || (x.d.kalan ?? 0) - (y.d.kalan ?? 0) || x.b.tur.localeCompare(y.b.tur, "tr"));

  return (
    <div className="space-y-3">
      {(yeni || arsivSayisi > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {arsivSayisi > 0 ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={arsiv} onChange={(e) => setArsiv(e.target.checked)} />
              Arşivdeki eski belgeleri göster ({arsivSayisi})
            </label>
          ) : (
            <span />
          )}
          {yeni && (
            <Button size="sm" onClick={() => setForm(yeni)}>
              <Plus className="h-4 w-4" />
              Belge ekle
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>{bos}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {showSahip && <th className="px-3 py-2 font-medium">Kime ait</th>}
                <th className="px-3 py-2 font-medium">Belge</th>
                <th className="px-3 py-2 font-medium">Bitiş</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Dosya</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ b, d }) => (
                <tr key={b.id} className={b.durum === "arsiv" ? "text-muted-foreground" : undefined}>
                  {showSahip && (
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium">{sahip(b)}</div>
                      {b.kapsam !== "sirket" && <div className="text-xs text-muted-foreground">{KAPSAM_AD[b.kapsam]}</div>}
                    </td>
                  )}
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-medium">{b.tur}</div>
                    {(b.belge_no || b.kurum) && (
                      <div className="text-xs text-muted-foreground">{[b.kurum, b.belge_no && `No: ${b.belge_no}`].filter(Boolean).join(" · ")}</div>
                    )}
                    {b.notlar && <div className="mt-0.5 max-w-md text-xs text-muted-foreground">{b.notlar}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums">
                    {b.bitis ? tarihYaz(b.bitis) : "—"}
                    {b.baslangic && <div className="text-xs text-muted-foreground">Başl. {tarihYaz(b.baslangic)}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <DurumTag durum={d} />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {b.dosyalar.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Yok</span>
                    ) : (
                      <div className="flex max-w-56 flex-col gap-0.5">
                        {b.dosyalar.map((f) => (
                          <a
                            key={f.id}
                            href={`/api/belgeler/dosya/${f.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title={f.ad}
                            className="inline-flex items-center gap-1 truncate text-xs text-primary hover:underline"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{f.ad}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex justify-end gap-1">
                      {b.durum === "gecerli" && b.bitis && (
                        <Button size="sm" variant="outline" title="Yeni tarihle yenile; bu kayıt arşive alınır" onClick={() => setForm({ yenile: b })}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Yenile
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" title="Düzenle" aria-label="Düzenle" onClick={() => setForm({ belge: b })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Sil"
                        aria-label="Sil"
                        onClick={() => {
                          if (window.confirm(`"${b.tur}" belgesi ve dosyaları kalıcı olarak silinsin mi?`)) void op("belgeSil", { id: b.id }, "Belge silindi.");
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <BelgeForm target={form} varliklar={data.varliklar} op={op} reload={reload} onClose={() => setForm(null)} />}
    </div>
  );
}
