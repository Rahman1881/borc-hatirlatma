"use client";

import { useState } from "react";
import { Panel, SectionTitle, Pill } from "@/components/ai/ui";
import { reportSchedules } from "@/lib/ai-mock";
import { Send, Clock, Check } from "lucide-react";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors ${
        on ? "bg-primary" : "bg-input ring-1 ring-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function RaporlarPage() {
  const [schedules, setSchedules] = useState(reportSchedules.map((r) => ({ ...r })));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel>
          <SectionTitle title="Otomatik Raporlar" />
          <div className="space-y-3">
            {schedules.map((r, i) => (
              <div
                key={r.title}
                className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{r.title}</p>
                    {r.active && <Pill tone="positive">Aktif</Pill>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.content}</p>
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> {r.time}
                  </p>
                </div>
                <Toggle
                  on={r.active}
                  onClick={() =>
                    setSchedules((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, active: !x.active } : x))
                    )
                  }
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionTitle title="Telegram Bot Bağlantısı" />
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#229ED9]/15 text-[#229ED9]">
                  <Send className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">@CarkPetrolBot</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Bağlı · Patron (sohbet ID: 84***21)
                  </p>
                </div>
              </div>
              <Pill tone="positive">
                <Check className="h-3 w-3" /> Çevrimiçi
              </Pill>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Patron, Telegram üzerinden bota yazıp anlık soru sorabilir; otomatik
              raporlar da bu sohbete düşer. Gerçek bağlantı için Ayarlar&apos;dan bot
              token girilir.
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="bg-muted/30">
        <SectionTitle title="Telegram Önizleme" />
        <div className="space-y-3 rounded-xl bg-[#0e1621] p-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[#2b5278] px-3 py-2 text-sm text-white">
            Bugün ne kadar sattık?
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            📊 <b>Bugünkü Satış</b>
            <br />⛽ Yakıt: ₺487.250 (+%8,4)
            <br />🛒 Market: ₺62.180 (+%3,1)
            <br />🚗 Müşteri: 1.284
            <br />
            <br />En yoğun: 17:00–20:00
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            ⚠️ <b>Uyarı:</b> Tank 2 motorin %22. Tedarik planlaması öneririm.
          </div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[#2b5278] px-3 py-2 text-sm text-white">
            Bu hafta en kârlı yakıt hangisi?
          </div>
          <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm text-[#e8edf7]">
            💡 Marj bazında <b>benzin</b> önde (litre +0,38 ₺). Net katkı: Motorin
            ₺212K, Benzin ₺86K, LPG ₺41K.
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Örnek görünüm · gerçek veriyle otomatik gönderilir
        </p>
      </Panel>
    </div>
  );
}
