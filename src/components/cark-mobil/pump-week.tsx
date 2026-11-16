"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { RotateCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { callOp, errorText, fb } from "@/lib/cark-mobil/firebase";
import { Field, Modal, Spinner, selectClass } from "./ui";
import type { AppUser, Shift } from "@/lib/cark-mobil/types";
import {
  EMPTY_ROSTER,
  PUMP_SLOTS,
  buildWeek,
  cellNote,
  existingCells,
  fixOffs,
  rosterFromShifts,
  rotated,
  slotTimes,
  type PumpRoster,
} from "@/lib/cark-mobil/pump-roster";
import { WEEKDAYS, WEEKDAYS_SHORT, addDaysIso, dayLabel, hasDuty, istMs, newId } from "@/lib/cark-mobil/util";

// Pompa haftası: istasyonun düzenine göre (çiftler her hafta yer değiştirir, gececi ile yedek
// yer değiştirir, izinlinin yerine yedek bakar) haftanın 21 vardiyasını tek seferde oluşturur.
// Geçen hafta kayıtlıysa düzen ondan devralınır. Mobil uygulamadaki planlayıcıyla aynı kayıtları üretir.

type Source = "bu hafta" | "geçen hafta" | "boş";

export function PumpWeekModal({ users, week, shifts, onClose }: { users: AppUser[]; week: string; shifts: Shift[]; onClose: () => void }) {
  const [roster, setRoster] = useState<PumpRoster | null>(null);
  const [source, setSource] = useState<Source>("boş");
  const [skipPast, setSkipPast] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Başlangıç düzeni: bu hafta kayıtlıysa o; değilse geçen haftanın döndürülmüş hâli.
  useEffect(() => {
    let alive = true;
    (async () => {
      const current = rosterFromShifts(week, shifts);
      if (current) {
        if (alive) {
          setRoster(current);
          setSource("bu hafta");
        }
        return;
      }
      const prevWeek = addDaysIso(week, -7);
      try {
        // Gece vardiyası gece yarısı başladığı için aralık (pazartesi 00:00, sonraki pazartesi 00:00] alınır.
        const s = await getDocs(
          query(collection(fb().db, "shifts"), where("startsAtMs", ">", istMs(prevWeek)), where("startsAtMs", "<=", istMs(week)))
        );
        const prev = rosterFromShifts(prevWeek, s.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift));
        if (!alive) return;
        setRoster(prev ? rotated(prev) : EMPTY_ROSTER);
        setSource(prev ? "geçen hafta" : "boş");
      } catch {
        if (alive) setRoster(EMPTY_ROSTER);
      }
    })();
    return () => {
      alive = false;
    };
    // Pencere açılırken bir kez hesaplanır; sonradan gelen canlı değişiklikler düzenlemeyi ezmesin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  const staff = useMemo(
    () => users.filter((u) => u.active && hasDuty(u, "pump")).sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "tr")),
    [users]
  );
  const name = (uid: string) => users.find((u) => u.id === uid)?.displayName ?? "Personel";
  const first = (uid: string) => name(uid).split(" ")[0];

  const cells = useMemo(() => (roster ? buildWeek(roster) : []), [roster]);
  const saved = useMemo(() => existingCells(week, shifts), [week, shifts]);

  if (!roster) {
    return (
      <Modal open onClose={onClose} title="Pompa haftası">
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      </Modal>
    );
  }

  // Bir kişi haftada tek görevde olur: yeni yere atanınca eski yerinden çıkar.
  function assign(role: "day" | "evening" | "night" | "floater", index: number, uid: string) {
    setRoster((r) => {
      if (!r) return r;
      const strip = (list: string[]) => list.filter((u) => u !== uid);
      const next: PumpRoster = {
        day: strip(r.day),
        evening: strip(r.evening),
        night: r.night === uid ? null : r.night,
        floater: r.floater === uid ? null : r.floater,
        off: { ...r.off },
      };
      delete next.off[uid];
      if (role === "day" || role === "evening") {
        const list = [...(role === "day" ? r.day : r.evening)];
        const old = list[index];
        if (old) delete next.off[old];
        list[index] = uid;
        const clean = list.filter((u, i) => u && (u !== uid || i === index));
        if (role === "day") next.day = clean;
        else next.evening = clean;
      } else if (role === "night") {
        if (r.night) delete next.off[r.night];
        next.night = uid || null;
      } else {
        next.floater = uid || null;
      }
      return fixOffs(next);
    });
  }
  const setOff = (uid: string, day: number) => setRoster((r) => (r ? { ...r, off: { ...r.off, [uid]: day } } : r));

  const now = Date.now();
  // Kaydedilecek değişiklikler: mevcut kayıtla aynı olan hücreler atlanır.
  const changes = cells.flatMap((c) => {
    const t = slotTimes(week, c.day, c.slot);
    if (skipPast && t.endsAtMs <= now) return [];
    const old = saved.get(`${c.day}|${c.slot}`);
    const notes = cellNote(c, name);
    if (c.memberIds.length === 0) return old ? [{ cell: c, t, old, notes, cancel: true }] : [];
    const same =
      old &&
      old.memberIds.length === c.memberIds.length &&
      c.memberIds.every((u) => old.memberIds.includes(u)) &&
      (old.notes ?? "") === notes;
    return same ? [] : [{ cell: c, t, old, notes, cancel: false }];
  });
  const drafts = [...saved.values()].filter((s) => s.status === "draft").length;

  const missing = [
    roster.day.length < 2 && "sabahçı çifti",
    roster.evening.length < 2 && "akşamcı çifti",
    !roster.night && "gececi",
    !roster.floater && "yedek",
  ].filter(Boolean);

  async function save(publish: boolean) {
    if (roster!.day.length === 0 && roster!.evening.length === 0 && !roster!.night) return toast.error("Önce ekipleri seçin.");
    // Yayınlamada, içeriği aynı kalan taslaklar da yayınlanır.
    const list = publish
      ? [
          ...changes,
          ...cells.flatMap((c) => {
            const old = saved.get(`${c.day}|${c.slot}`);
            const t = slotTimes(week, c.day, c.slot);
            const already = changes.some((x) => x.cell === c);
            return old?.status === "draft" && !already && !(skipPast && t.endsAtMs <= now) && c.memberIds.length
              ? [{ cell: c, t, old, notes: cellNote(c, name), cancel: false }]
              : [];
          }),
        ]
      : changes;
    if (list.length === 0) return toast.info("Kaydedilecek değişiklik yok.");
    if (publish && !confirm(`${list.length} vardiya yayınlansın mı? İlgili personele bildirim gider.`)) return;
    setProgress({ done: 0, total: list.length });
    const failed: string[] = [];
    for (const ch of list) {
      const slot = PUMP_SLOTS.find((s) => s.key === ch.cell.slot)!;
      try {
        if (ch.cancel) {
          await callOp("stationCancelShift", { operationId: newId(), id: ch.old!.id, reason: "Haftalık planda bu vardiya kaldırıldı." });
        } else {
          await callOp("stationSaveShift", {
            operationId: newId(),
            id: ch.old?.id ?? newId(),
            name: slot.name,
            workRole: "pump",
            templateId: null,
            ...ch.t,
            memberIds: ch.cell.memberIds,
            // Yayınlanmış vardiya taslağa döndürülemez; değişikliği yeniden yayınlanır.
            publish: publish || ch.old?.status === "published",
            expectedRevision: ch.old?.revision ?? 0,
            notes: ch.notes,
          });
        }
      } catch (e) {
        failed.push(`${WEEKDAYS[ch.cell.day]} ${slot.name}: ${errorText(e)}`);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    const ok = list.length - failed.length;
    if (ok) toast.success(publish ? `${ok} vardiya yayınlandı.` : `${ok} vardiya taslak olarak kaydedildi.`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" · "));
    else onClose();
  }

  const personSelect = (value: string | null | undefined, onChange: (uid: string) => void) => (
    <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Seçin</option>
      {staff.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </select>
  );
  const offSelect = (uid: string | null | undefined) =>
    uid ? (
      <select className={cn(selectClass, "w-36")} value={roster.off[uid] ?? ""} onChange={(e) => setOff(uid, Number(e.target.value))} title="İzin günü">
        {WEEKDAYS.map((d, i) => (
          <option key={i} value={i}>
            İzin: {d}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Pompa haftası · ${dayLabel(week)} – ${dayLabel(addDaysIso(week, 6))}`}
      description={
        source === "bu hafta"
          ? "Bu haftanın kayıtlı vardiyalarından okundu; değişiklik yapıp yeniden kaydedebilirsiniz."
          : source === "geçen hafta"
            ? "Geçen haftanın düzeninden devralındı: çiftler yer değiştirdi, gececi yedek oldu, izin günleri ilerledi."
            : "Geçen hafta kayıtlı değil; ekipleri bir kez seçin. Sonraki haftalarda düzen kendiliğinden devralınır."
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Sabahçılar (08–16)</p>
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2">
              {personSelect(roster.day[i], (uid) => assign("day", i, uid))}
              {offSelect(roster.day[i])}
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Akşamcılar (16–24)</p>
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2">
              {personSelect(roster.evening[i], (uid) => assign("evening", i, uid))}
              {offSelect(roster.evening[i])}
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Gececi (24–08)</p>
          <div className="flex gap-2">
            {personSelect(roster.night, (uid) => assign("night", 0, uid))}
            {offSelect(roster.night)}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <Field label="Yedek (izinlilerin yerine bakar)" hint="Geçen haftanın gececisi; izinli olanın vardiyasını doldurur.">
            {personSelect(roster.floater, (uid) => assign("floater", 0, uid))}
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setRoster((r) => (r ? rotated(r) : r))} title="Çiftleri ve gececi-yedeği yer değiştir">
          <RotateCw className="h-4 w-4" /> Düzeni bir hafta ilerlet
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={skipPast} onChange={(e) => setSkipPast(e.target.checked)} /> Bitmiş vardiyaları atla
        </label>
        {missing.length > 0 && <span className="text-xs text-amber-600">Eksik: {missing.join(", ")}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium" />
              {WEEKDAYS_SHORT.map((d, i) => (
                <th key={d} className="px-2 py-2 font-medium">
                  {d} <span className="font-normal">{dayLabel(addDaysIso(week, i))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PUMP_SLOTS.map((s) => (
              <tr key={s.key} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-2 text-xs font-medium text-muted-foreground">{s.name}</td>
                {Array.from({ length: 7 }, (_, d) => {
                  const c = cells.find((x) => x.day === d && x.slot === s.key)!;
                  const covers = new Set(c.leaves.flatMap((l) => (l.cover ? [l.cover] : [])));
                  const ended = skipPast && slotTimes(week, d, s.key).endsAtMs <= now;
                  const changed = changes.some((x) => x.cell === c);
                  return (
                    <td key={d} className={cn("px-2 py-2 align-top", ended && "opacity-40")}>
                      {c.memberIds.map((u) => (
                        <p key={u} className={cn("leading-snug", covers.has(u) && "font-semibold text-primary")}>
                          {first(u)}
                        </p>
                      ))}
                      {c.memberIds.length < s.minPeople && <p className="text-xs text-red-600">Eksik kişi</p>}
                      {changed && <p className="text-[10px] text-amber-600">kaydedilecek</p>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Koyu yazılan kişi o gün izinlinin yerine bakan yedektir. {changes.length} vardiya kaydedilecek
        {drafts > 0 && `, ${drafts} taslak yayınlanmayı bekliyor`}.
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        {progress && (
          <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {progress.done} / {progress.total}
          </span>
        )}
        <Button variant="outline" className="h-9" onClick={() => save(false)} disabled={!!progress}>
          Taslak olarak kaydet
        </Button>
        <Button className="h-9" onClick={() => save(true)} disabled={!!progress}>
          <Send className="h-4 w-4" /> Yayınla
        </Button>
      </div>
    </Modal>
  );
}
