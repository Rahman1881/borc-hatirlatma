"use client";

import { Button } from "@/components/ui/button";
import { Box, Empty, Field, Loading, PageHeader, Tag, selectClass, useBelgeler } from "@/components/belgeler/ui";

export default function BelgeAyarlarPage() {
  const { data, failed, busy, op } = useBelgeler();
  if (!data) return <Loading failed={failed} />;
  const { ayar } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hatırlatma Ayarları"
        description="Süresi yaklaşan belgeler günde bir kez, raporları açık Telegram abonelerine tek mesajda gönderilir."
      />

      <Box className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {data.telegram ? <Tag tone="green">Telegram bağlı</Tag> : <Tag tone="red">Telegram botu ayarlı değil</Tag>}
          <span className="text-muted-foreground">
            {data.abone > 0
              ? `${data.abone} aboneye gönderilir (AI İş Asistanı › Telegram ayarlarındaki erişimi ve raporu açık kişiler).`
              : "Raporu açık abone yok; hatırlatma kimseye ulaşmaz."}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hatırlatma">
            <select
              className={selectClass}
              value={ayar.enabled ? "1" : "0"}
              disabled={busy}
              onChange={(e) => void op("ayar", { enabled: e.target.value === "1" }, "Kaydedildi.")}
            >
              <option value="1">Açık</option>
              <option value="0">Kapalı</option>
            </select>
          </Field>
          <Field label="Gönderim saati" hint="Her gün bu saatten sonraki ilk kontrolde gönderilir.">
            <select className={selectClass} value={ayar.saat} disabled={busy} onChange={(e) => void op("ayar", { saat: Number(e.target.value) }, "Kaydedildi.")}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Her belge için kaç gün kala hatırlatılacağı belgenin kendi formunda seçilir (varsayılan 30, 15, 7 ve 1 gün).</li>
          <li>Süresi dolan belge, yenilenene ya da silinene kadar haftada bir yeniden hatırlatılır.</li>
          <li>Belge “Yenile” ile güncellenince eski kayıt arşive alınır ve hatırlatması durur.</li>
          <li>Pasife alınan araç ve personelin belgeleri için hatırlatma gönderilmez.</li>
        </ul>
      </Box>

      <Box className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Sıradaki hatırlatma</h3>
            <p className="text-sm text-muted-foreground">Bir sonraki gönderimde bildirilecek belgeler.</p>
          </div>
          <Button
            variant="outline"
            disabled={busy || data.bekleyen.length === 0 || !data.telegram || !ayar.enabled}
            onClick={() => {
              if (window.confirm(`${data.bekleyen.length} belge için hatırlatma şimdi Telegram'dan gönderilsin mi?`)) void op("gonder", {}, "Hatırlatma gönderildi.");
            }}
          >
            Şimdi gönder
          </Button>
        </div>
        {data.bekleyen.length === 0 ? (
          <Empty>Bekleyen hatırlatma yok.</Empty>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {data.bekleyen.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="font-medium">{b.sahip}</span> · {b.tur}
                </span>
                <Tag tone={b.kalan < 0 ? "red" : "amber"}>{b.kalan < 0 ? `${-b.kalan} gün önce doldu` : b.kalan === 0 ? "Bugün doluyor" : `${b.kalan} gün kaldı`}</Tag>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}
