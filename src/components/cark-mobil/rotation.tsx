"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fb } from "@/lib/cark-mobil/firebase";
import { Field, Modal, Spinner, selectClass, useOp } from "./ui";
import type { AppUser, Rotation, WashHours, WashKind } from "@/lib/cark-mobil/types";
import { WEEKDAYS, hasDuty, newId, weekStart } from "@/lib/cark-mobil/util";

// Market ve yıkama için kayıtlı vardiya düzeni. Kaydedilince sunucu önümüzdeki 4 haftanın
// vardiyalarını kendisi yayınlar ve her gün ileriye doğru tamamlar. Elle değiştirilen ya da
// iptal edilen vardiyalara ve elle vardiya girilmiş günlere dokunmaz.

type Role = "market" | "wash";

// Market: 2 gün gündüz (08–20), 2 gün gece (20–08), 2 gün izin. Kişinin, düzenin başladığı
// pazartesi günü bu döngünün neresinde olduğu.
const PHASES = ["Gündüz · 1. gün", "Gündüz · 2. gün", "Gece · 1. gün", "Gece · 2. gün", "İzinli · 1. gün", "İzinli · 2. gün"];
const KINDS: { key: WashKind; label: string }[] = [
  { key: "morning", label: "Sabahçı" },
  { key: "evening", label: "Akşamcı" },
  { key: "afternoon", label: "Öğleden sonra" },
];
const DEFAULT_HOURS: WashHours = { open: 6, morningEnd: 13, cover: 8, eveningStart: 12, afternoon: 14, close: 24 };
const HOUR_FIELDS: { key: keyof WashHours; label: string }[] = [
  { key: "open", label: "Açılış" },
  { key: "morningEnd", label: "Sabahçı çıkışı" },
  { key: "cover", label: "Akşamcının erken girişi" },
  { key: "eveningStart", label: "Akşamcı girişi" },
  { key: "afternoon", label: "Öğleden sonra girişi" },
  { key: "close", label: "Kapanış" },
];

type Report = { created: number; updated: number; cancelled: number; kept: number; failed: string[] };

export function RotationModal({ users, week, onClose }: { users: AppUser[]; week: string; onClose: () => void }) {
  const [saved, setSaved] = useState<Partial<Record<Role, Rotation>> | null>(null);
  const [role, setRole] = useState<Role>("market");

  useEffect(
    () =>
      onSnapshot(
        collection(fb().db, "shiftRotations"),
        (s) => setSaved(Object.fromEntries(s.docs.map((d) => [d.id, { role: d.id, ...d.data() } as Rotation]))),
        () => setSaved({})
      ),
    []
  );

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Otomatik vardiya düzeni"
      description="Kaydedilen düzene göre sunucu önümüzdeki 4 haftanın vardiyalarını kendisi yayınlar. Elle değiştirdiğiniz vardiyalara dokunmaz."
    >
      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm sm:w-fit">
        {(["market", "wash"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={cn("rounded-md px-4 py-1.5", role === r ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {r === "market" ? "Market" : "Yıkama"}
            {saved?.[r]?.active && " ●"}
          </button>
        ))}
      </div>
      {saved === null ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : (
        <RotationForm key={`${role}-${saved[role]?.version ?? 0}`} role={role} saved={saved[role]} users={users} week={week} />
      )}
    </Modal>
  );
}

function RotationForm({ role, saved, users, week }: { role: Role; saved?: Rotation; users: AppUser[]; week: string }) {
  const { busy, run } = useOp();
  const [active, setActive] = useState(saved?.active ?? true);
  const [anchorDate, setAnchorDate] = useState(saved?.anchorDate ?? week);
  const [people, setPeople] = useState<string[]>(saved?.people ?? []);
  const [phases, setPhases] = useState<Record<string, number>>(saved?.phases ?? {});
  const [kinds, setKinds] = useState<Record<string, WashKind>>(saved?.kinds ?? {});
  const [off, setOff] = useState<Record<string, number>>(saved?.off ?? {});
  const [hours, setHours] = useState<WashHours>({ ...DEFAULT_HOURS, ...(saved?.hours ?? {}) });

  const staff = users
    .filter((u) => (u.active && hasDuty(u, role)) || people.includes(u.id))
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "tr"));

  function toggle(id: string, on: boolean) {
    setPeople((l) => (on ? [...l, id] : l.filter((x) => x !== id)));
    if (on && role === "market" && phases[id] == null) setPhases((p) => ({ ...p, [id]: 0 }));
    if (on && role === "wash" && kinds[id] == null) setKinds((k) => ({ ...k, [id]: "morning" }));
  }

  async function save() {
    if (weekStart(anchorDate) !== anchorDate) return toast.error("Düzenin başlangıcı bir pazartesi olmalı.");
    if (active && people.length === 0) return toast.error("En az bir personel seçin.");
    const pick = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => people.includes(id)));
    const r = await run<{ generated: Report | null }>("stationSaveRotation", {
      operationId: newId(),
      role,
      active,
      anchorDate,
      generateFrom: saved?.generateFrom && saved.generateFrom >= anchorDate ? saved.generateFrom : anchorDate,
      people,
      ...(role === "market" ? { phases: pick(phases) } : { kinds: pick(kinds), off: pick(off), hours }),
    });
    if (!r) return;
    const g = r.generated;
    toast.success(
      g
        ? `Düzen kaydedildi: ${g.created} vardiya oluşturuldu, ${g.updated} güncellendi, ${g.cancelled} iptal edildi.`
        : "Düzen kaydedildi."
    );
    if (g?.failed?.length) toast.error(`Oluşturulamayan vardiyalar: ${g.failed.slice(0, 3).join(" · ")}`);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Düzenin başladığı pazartesi" hint="Kişilerin sırası ve izin günleri bu haftaya göre sayılır.">
          <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-center text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Düzen açık (sunucu vardiyaları kendisi yayınlasın)
        </label>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">
          {role === "market" ? "Market görevlileri" : "Yıkamacılar"} ({people.length})
        </p>
        {staff.length === 0 ? (
          <p className="text-sm text-amber-600">Bu bölümde çalışabilen aktif personel yok. Ekip bölümünden işi ekleyin.</p>
        ) : (
          <div className="divide-y rounded-lg border text-sm">
            {staff.map((u) => {
              const on = people.includes(u.id);
              return (
                <div key={u.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <label className="flex min-w-40 flex-1 items-center gap-2">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(u.id, e.target.checked)} />
                    {u.displayName}
                  </label>
                  {on && role === "market" && (
                    <select
                      className={cn(selectClass, "w-44")}
                      value={phases[u.id] ?? 0}
                      onChange={(e) => setPhases((p) => ({ ...p, [u.id]: Number(e.target.value) }))}
                      title="Başlangıç pazartesisinde döngüdeki yeri"
                    >
                      {PHASES.map((label, i) => (
                        <option key={i} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                  {on && role === "wash" && (
                    <>
                      <select
                        className={cn(selectClass, "w-36")}
                        value={kinds[u.id] ?? "morning"}
                        onChange={(e) => setKinds((k) => ({ ...k, [u.id]: e.target.value as WashKind }))}
                      >
                        {KINDS.map((k) => (
                          <option key={k.key} value={k.key}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={cn(selectClass, "w-40")}
                        value={off[u.id] ?? ""}
                        onChange={(e) =>
                          setOff((o) => {
                            const next = { ...o };
                            if (e.target.value === "") delete next[u.id];
                            else next[u.id] = Number(e.target.value);
                            return next;
                          })
                        }
                      >
                        <option value="">İzin günü yok</option>
                        {WEEKDAYS.map((d, i) => (
                          <option key={i} value={i}>
                            İzin: {d}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {role === "market" ? (
        <p className="text-xs text-muted-foreground">
          Market düzeni: 2 gün gündüz (08–20), 2 gün gece (20–08), 2 gün izin; sonra baştan. Her kişi için, başlangıç
          pazartesisinde bu döngünün neresinde olduğunu seçin.
        </p>
      ) : (
        <div>
          <p className="mb-1.5 text-sm font-medium">Yıkama saatleri</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {HOUR_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={hours[f.key]}
                  onChange={(e) => setHours((h) => ({ ...h, [f.key]: Number(e.target.value) }))}
                />
              </Field>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Sabahçı açılışta başlar, akşamcı kapanışa kadar kalır. Birinin izin gününde diğeri tüm günü kapatır (akşamcı
            erken girer ya da sabahçı kapanışa kadar kalır).
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button className="h-9" onClick={save} disabled={busy}>
          {busy && <Spinner />} Düzeni kaydet ve vardiyaları oluştur
        </Button>
      </div>
    </div>
  );
}
