"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KAPSAM_AD, type BelgeKapsam } from "@/lib/belge-turleri";
import { BelgeListe } from "@/components/belgeler/belge-liste";
import { Box, Loading, PageHeader, durumOf, useBelgeler } from "@/components/belgeler/ui";

type Gorunum = "ilgi" | "tum";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

export default function BelgelerOzetPage() {
  const { data, failed, op, reload } = useBelgeler();
  const [gorunum, setGorunum] = useState<Gorunum>("ilgi");
  const [kapsam, setKapsam] = useState<BelgeKapsam | "hepsi">("hepsi");
  const [ara, setAra] = useState("");

  if (!data) return <Loading failed={failed} />;

  const gecerli = data.belgeler.filter((b) => b.durum === "gecerli");
  const kod = (k: string) => gecerli.filter((b) => durumOf(b, data.bugun).kod === k).length;
  const kutular = [
    { ad: "Süresi dolan", sayi: kod("gecti"), renk: "text-red-600 dark:text-red-400" },
    { ad: "Süresi yaklaşan", sayi: kod("yakin"), renk: "text-amber-600 dark:text-amber-400" },
    { ad: "Geçerli (tarihli)", sayi: kod("gecerli"), renk: "text-emerald-600 dark:text-emerald-400" },
    { ad: "Süresiz", sayi: kod("suresiz"), renk: "" },
  ];

  const q = ara.trim().toLocaleLowerCase("tr");
  const sahip = (id: number | null) => data.varliklar.find((v) => v.id === id)?.ad ?? "";
  const liste = data.belgeler.filter((b) => {
    if (kapsam !== "hepsi" && b.kapsam !== kapsam) return false;
    if (gorunum === "ilgi" && !["gecti", "yakin"].includes(durumOf(b, data.bugun).kod)) return false;
    return !q || `${b.tur} ${b.kurum} ${b.belge_no} ${sahip(b.varlik_id)}`.toLocaleLowerCase("tr").includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Şirket ve Özlük Belgeleri"
        description="Şirkete, araçlara ve personele ait bütün belgeler. Süresi dolmaya yaklaşan belgeler için Telegram hatırlatması gönderilir."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kutular.map((k) => (
          <Box key={k.ad} className="p-4">
            <div className="text-sm text-muted-foreground">{k.ad}</div>
            <div className={cn("mt-1 text-3xl font-bold tabular-nums", k.renk)}>{k.sayi}</div>
          </Box>
        ))}
      </div>

      <Box className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip on={gorunum === "ilgi"} onClick={() => setGorunum("ilgi")}>
            İlgi bekleyenler
          </Chip>
          <Chip on={gorunum === "tum"} onClick={() => setGorunum("tum")}>
            Tüm belgeler
          </Chip>
          <span className="mx-1 h-5 w-px bg-border" />
          <Chip on={kapsam === "hepsi"} onClick={() => setKapsam("hepsi")}>
            Hepsi
          </Chip>
          {(Object.keys(KAPSAM_AD) as BelgeKapsam[]).map((k) => (
            <Chip key={k} on={kapsam === k} onClick={() => setKapsam(k)}>
              {KAPSAM_AD[k]}
            </Chip>
          ))}
          <Input className="ml-auto w-56" value={ara} placeholder="Belge, plaka ya da kişi ara…" aria-label="Ara" onChange={(e) => setAra(e.target.value)} />
        </div>
        <BelgeListe
          data={data}
          belgeler={liste}
          op={op}
          reload={reload}
          showSahip
          yeni={{}}
          bos={
            data.belgeler.length === 0
              ? "Henüz belge eklenmemiş. “Belge ekle” ile başlayın."
              : gorunum === "ilgi"
                ? "Süresi dolan ya da yaklaşan belge yok."
                : "Eşleşen belge yok."
          }
        />
      </Box>
    </div>
  );
}
