"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Camera, Pencil, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, ReceiptThumb, Spinner, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import type { AppUser, Shift, ShiftTemplate, StationTask, TaskMode, TaskTemplate, WorkRole } from "@/lib/cark-mobil/types";
import {
  WEEKDAYS_SHORT,
  WORK_ROLES,
  addDaysIso,
  dayLabel,
  hasDuty,
  istClock,
  istMs,
  minuteText,
  newId,
  parseMinute,
  roleLabel,
  todayIso,
} from "@/lib/cark-mobil/util";

// Görevler: vardiyalara bağlı işler. "Sabit görev" her hafta seçilen günlerde (ya da tek bir
// günde) ilgili bölümün vardiyasına kendiliğinden düşer; "tek seferlik görev" yayınlanmış bir
// vardiyaya elle eklenir. Ortak görevi vardiyadan bir kişi üstlenir; kişisel görev herkese ayrı düşer.

const MODE: Record<TaskMode, string> = { common: "Ortak", personal: "Kişisel", person: "Kişiye özel" };
const STATE: Record<StationTask["status"], { text: string; tone: "muted" | "amber" | "green" | "red" }> = {
  todo: { text: "Bekliyor", tone: "muted" },
  doing: { text: "Yapılıyor", tone: "amber" },
  completed: { text: "Tamamlandı", tone: "green" },
  cancelled: { text: "İptal", tone: "red" },
};

type Tab = "gunluk" | "sabit";

export default function GorevlerPage() {
  const { users } = useCark();
  const [tab, setTab] = useState<Tab>("gunluk");
  const [day, setDay] = useState(todayIso());
  const [tasks, setTasks] = useState<StationTask[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);
  const [returning, setReturning] = useState<StationTask | null>(null);

  const from = istMs(day);
  const to = istMs(addDaysIso(day, 1));

  useEffect(() => {
    const { db } = fb();
    const subs = [
      onSnapshot(
        query(collection(db, "stationTasks"), where("startsAtMs", ">=", from), where("startsAtMs", "<", to), orderBy("startsAtMs")),
        (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() }) as StationTask)),
        () => setTasks([])
      ),
      // Tek seferlik görev eklenebilecek vardiyalar: seçili günde başlayanlar.
      onSnapshot(
        query(collection(db, "shifts"), where("startsAtMs", ">=", from), where("startsAtMs", "<", to), orderBy("startsAtMs")),
        (s) => setShifts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift)),
        () => setShifts([])
      ),
    ];
    return () => subs.forEach((off) => off());
  }, [from, to]);

  useEffect(() => {
    const { db } = fb();
    const subs = [
      onSnapshot(collection(db, "taskTemplates"), (s) => setTemplates(s.docs.map((d) => ({ id: d.id, ...d.data() }) as TaskTemplate))),
      onSnapshot(collection(db, "shiftTemplates"), (s) =>
        setShiftTemplates(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ShiftTemplate))
      ),
    ];
    return () => subs.forEach((off) => off());
  }, []);

  // Görevler vardiyaya göre gruplanır.
  const groups = useMemo(() => {
    const map = new Map<string, StationTask[]>();
    for (const t of tasks ?? []) map.set(t.shiftId, [...(map.get(t.shiftId) ?? []), t]);
    return [...map.entries()].map(([shiftId, list]) => ({ shiftId, shift: shifts.find((s) => s.id === shiftId), list }));
  }, [tasks, shifts]);

  const open = (tasks ?? []).filter((t) => t.status === "todo" || t.status === "doing").length;
  const done = (tasks ?? []).filter((t) => t.status === "completed").length;
  const publishedShifts = shifts.filter((s) => s.status === "published");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Görevler"
        description="Vardiyalara düşen işler, fotoğraflı tamamlamalar ve her hafta tekrarlanan sabit görevler."
        action={
          tab === "gunluk" ? (
            <Button className="h-9" onClick={() => setAdding(true)} disabled={publishedShifts.length === 0} title={publishedShifts.length === 0 ? "Bu günde yayınlanmış vardiya yok" : undefined}>
              <Plus className="h-4 w-4" /> Tek seferlik görev
            </Button>
          ) : (
            <Button className="h-9" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Sabit görev
            </Button>
          )
        }
      />

      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm sm:w-fit">
        {(
          [
            ["gunluk", "Günün görevleri"],
            ["sabit", `Sabit görevler (${templates.filter((t) => t.active).length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("rounded-md px-4 py-1.5", tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "gunluk" ? (
        <>
          <Box className="flex flex-wrap items-center gap-3">
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-44" />
            {day !== todayIso() && (
              <Button variant="ghost" size="sm" onClick={() => setDay(todayIso())}>
                Bugün
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              {dayLabel(day)} · {open} açık · {done} tamamlandı
            </span>
          </Box>

          {tasks === null ? (
            <div className="grid place-items-center py-16">
              <Spinner />
            </div>
          ) : groups.length === 0 ? (
            <Box>
              <Empty>
                Bu günde görev yok. Görevler, vardiya yayınlandıktan sonra (başlamasına en çok iki gün kala) oluşur.
              </Empty>
            </Box>
          ) : (
            groups.map((g) => (
              <Box key={g.shiftId}>
                <p className="mb-3 text-sm font-semibold">
                  {g.shift?.name ?? g.list[0].shiftName ?? "Vardiya"}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {roleLabel(g.list[0].workRole)}
                    {g.shift && ` · ${istClock(g.shift.startsAtMs)}–${istClock(g.shift.endsAtMs)}`}
                  </span>
                </p>
                <div className="divide-y">
                  {g.list.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {t.title}
                          {t.photoRequired && <Camera className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" />}
                        </p>
                        {t.instructions && <p className="text-xs text-muted-foreground">{t.instructions}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {MODE[t.mode]} · {istClock(t.startsAtMs)}
                          {t.dueAtMs ? ` – en geç ${istClock(t.dueAtMs)}` : ""}
                          {t.mode !== "common" && ` · ${names(users, t.assigneeIds)}`}
                        </p>
                        {t.status === "doing" && <p className="mt-0.5 text-xs">Üstlenen: {t.claimedName}</p>}
                        {t.status === "completed" && (
                          <p className="mt-0.5 text-xs">
                            {t.completedName} · {istClock(t.completedAtMs)}
                            {t.note && ` · ${t.note}`}
                          </p>
                        )}
                        {t.returnReason && t.status !== "completed" && (
                          <p className="mt-0.5 text-xs text-amber-600">Geri gönderildi: {t.returnReason}</p>
                        )}
                        {t.status === "cancelled" && t.cancelReason && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{t.cancelReason}</p>
                        )}
                      </div>
                      {(t.photoPaths ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {t.photoPaths!.map((p) => (
                            <ReceiptThumb key={p} path={p} />
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Tag tone={STATE[t.status].tone}>{STATE[t.status].text}</Tag>
                        {t.status === "completed" && (
                          <Button variant="outline" size="sm" onClick={() => setReturning(t)}>
                            <Undo2 className="h-4 w-4" /> Geri gönder
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Box>
            ))
          )}
        </>
      ) : (
        <Box>
          {templates.length === 0 ? (
            <Empty>Henüz sabit görev yok.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Görev</th>
                    <th className="px-3 py-2 font-medium">Bölüm</th>
                    <th className="px-3 py-2 font-medium">Ne zaman</th>
                    <th className="px-3 py-2 font-medium">Kime</th>
                    <th className="px-3 py-2 font-medium">Durum</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {[...templates]
                    .sort((a, b) => Number(b.active) - Number(a.active) || a.workRole.localeCompare(b.workRole) || a.title.localeCompare(b.title, "tr"))
                    .map((t) => (
                      <tr key={t.id} className={cn("border-b last:border-0", !t.active && "opacity-60")}>
                        <td className="py-2.5 pr-3">
                          <span className="font-medium">{t.title}</span>
                          {t.photoRequired && <Camera className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" />}
                          {t.instructions && <p className="max-w-md truncate text-xs text-muted-foreground">{t.instructions}</p>}
                        </td>
                        <td className="px-3 py-2.5">{roleLabel(t.workRole)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {t.date ? dayLabel(t.date) : (t.weekdays ?? []).length === 7 ? "Her gün" : (t.weekdays ?? []).map((d) => WEEKDAYS_SHORT[d - 1]).join(", ")}
                          {t.atMinute != null ? ` · ${minuteText(t.atMinute)}` : " · vardiya boyunca"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {t.mode === "person" ? (users.find((u) => u.id === t.assigneeId)?.displayName ?? "—") : MODE[t.mode]}
                        </td>
                        <td className="px-3 py-2.5">{t.active ? <Tag tone="green">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
                        <td className="py-2.5 pl-3 text-right">
                          <Button variant="ghost" size="icon-sm" title="Düzenle" onClick={() => setEditing(t)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      )}

      {adding && <AdhocTask shifts={publishedShifts} users={users} onClose={() => setAdding(false)} />}
      {editing && (
        <TemplateForm
          template={editing === "new" ? null : editing}
          users={users}
          shiftTemplates={shiftTemplates}
          onClose={() => setEditing(null)}
        />
      )}
      {returning && <ReturnTask task={returning} onClose={() => setReturning(null)} />}
    </div>
  );
}

function names(users: AppUser[], ids: string[] | undefined): string {
  return (ids ?? []).map((id) => users.find((u) => u.id === id)?.displayName ?? "Personel").join(", ");
}

// Görevin ortak alanları (sabit ve tek seferlik görevde aynı).
type TaskFields = { title: string; instructions: string; mode: TaskMode; assigneeId: string; photoRequired: boolean; due: string; remind: string };
const blankFields: TaskFields = { title: "", instructions: "", mode: "common", assigneeId: "", photoRequired: false, due: "", remind: "" };

function fieldsPayload(f: TaskFields): Record<string, unknown> | string {
  if (f.title.trim().length < 2) return "Görev adını girin.";
  if (f.mode === "person" && !f.assigneeId) return "Görevi yapacak kişiyi seçin.";
  const due = f.due.trim() ? Number(f.due) : null;
  const remind = f.remind.trim() ? Number(f.remind) : null;
  if (due != null && (!Number.isInteger(due) || due < 1 || due > 1440)) return "Süre 1–1440 dakika olmalı.";
  if (remind != null && (!Number.isInteger(remind) || remind < 15 || remind > 480)) return "Hatırlatma aralığı 15–480 dakika olmalı.";
  return {
    title: f.title.trim(),
    instructions: f.instructions.trim(),
    mode: f.mode,
    assigneeId: f.mode === "person" ? f.assigneeId : null,
    photoRequired: f.photoRequired,
    dueMinutes: due,
    remindEveryMinutes: remind,
  };
}

function TaskFieldsForm({ value, onChange, people }: { value: TaskFields; onChange: (v: TaskFields) => void; people: AppUser[] }) {
  return (
    <>
      <Field label="Görev">
        <Input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} maxLength={150} placeholder="Küllükleri boşalt" />
      </Field>
      <Field label="Açıklama (isteğe bağlı)">
        <Textarea value={value.instructions} onChange={(e) => onChange({ ...value, instructions: e.target.value })} rows={2} maxLength={1000} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kim yapacak?">
          <select className={selectClass} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as TaskMode })}>
            <option value="common">Ortak (vardiyadan biri üstlenir)</option>
            <option value="personal">Kişisel (herkes ayrı yapar)</option>
            <option value="person">Kişiye özel</option>
          </select>
        </Field>
        {value.mode === "person" && (
          <Field label="Kişi">
            <select className={selectClass} value={value.assigneeId} onChange={(e) => onChange({ ...value, assigneeId: e.target.value })}>
              <option value="">Seçin</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Süre (dakika, isteğe bağlı)" hint="Başlangıçtan itibaren tamamlanması gereken süre.">
          <Input inputMode="numeric" value={value.due} onChange={(e) => onChange({ ...value, due: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Hatırlatma aralığı (dakika)" hint="Boşsa yalnız başlangıçta bildirim gider.">
          <Input inputMode="numeric" value={value.remind} onChange={(e) => onChange({ ...value, remind: e.target.value.replace(/\D/g, "") })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.photoRequired} onChange={(e) => onChange({ ...value, photoRequired: e.target.checked })} />
        Tamamlarken fotoğraf zorunlu
      </label>
    </>
  );
}

function AdhocTask({ shifts, users, onClose }: { shifts: Shift[]; users: AppUser[]; onClose: () => void }) {
  const { busy, run } = useOp();
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");
  const [fields, setFields] = useState(blankFields);
  const shift = shifts.find((s) => s.id === shiftId);
  const people = users.filter((u) => shift?.memberIds.includes(u.id));

  async function save() {
    if (!shift) return toast.error("Vardiya seçin.");
    const payload = fieldsPayload(fields);
    if (typeof payload === "string") return toast.error(payload);
    const ok = await run("stationCreateTask", { operationId: newId(), id: newId(), shiftId, ...payload }, "Görev vardiyaya eklendi.");
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Tek seferlik görev" description="Yayınlanmış bir vardiyaya bugünlük görev ekler; vardiyadaki personele bildirim gider.">
      <div className="space-y-4">
        <Field label="Vardiya">
          <select
            className={selectClass}
            value={shiftId}
            onChange={(e) => {
              setShiftId(e.target.value);
              setFields((f) => ({ ...f, assigneeId: "" }));
            }}
          >
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {roleLabel(s.workRole)} · {istClock(s.startsAtMs)}–{istClock(s.endsAtMs)}
              </option>
            ))}
          </select>
        </Field>
        <TaskFieldsForm value={fields} onChange={setFields} people={people} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} Görevi ekle
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateForm({
  template,
  users,
  shiftTemplates,
  onClose,
}: {
  template: TaskTemplate | null;
  users: AppUser[];
  shiftTemplates: ShiftTemplate[];
  onClose: () => void;
}) {
  const { busy, run } = useOp();
  const [workRole, setWorkRole] = useState<WorkRole>(template?.workRole ?? "pump");
  const [fields, setFields] = useState<TaskFields>(
    template
      ? {
          title: template.title,
          instructions: template.instructions ?? "",
          mode: template.mode,
          assigneeId: template.assigneeId ?? "",
          photoRequired: template.photoRequired,
          due: template.dueMinutes ? String(template.dueMinutes) : "",
          remind: template.remindEveryMinutes ? String(template.remindEveryMinutes) : "",
        }
      : blankFields
  );
  const [once, setOnce] = useState(!!template?.date);
  const [date, setDate] = useState(template?.date ?? todayIso());
  const [weekdays, setWeekdays] = useState<number[]>(template?.weekdays?.length ? template.weekdays : [1, 2, 3, 4, 5, 6, 7]);
  const [timed, setTimed] = useState(template?.atMinute != null);
  const [at, setAt] = useState(template?.atMinute != null ? minuteText(template.atMinute) : "09:00");
  const [shiftTemplateId, setShiftTemplateId] = useState(template?.shiftTemplateId ?? "");
  const [active, setActive] = useState(template?.active ?? true);

  const people = users.filter((u) => u.active && hasDuty(u, workRole));
  const roleShiftTemplates = shiftTemplates.filter((t) => t.workRole === workRole);

  async function save() {
    const payload = fieldsPayload(fields);
    if (typeof payload === "string") return toast.error(payload);
    if (!once && weekdays.length === 0) return toast.error("En az bir gün seçin.");
    const atMinute = timed ? parseMinute(at) : null;
    if (timed && atMinute == null) return toast.error("Saati girin.");
    const r = await run(
      "stationSaveTaskTemplate",
      {
        operationId: newId(),
        id: template?.id ?? newId(),
        ...payload,
        workRole,
        shiftTemplateId: !timed && shiftTemplateId ? shiftTemplateId : null,
        weekdays: once ? [] : [...weekdays].sort(),
        date: once ? date : null,
        atMinute,
        active,
      },
      "Sabit görev kaydedildi."
    );
    if (r) onClose();
  }

  return (
    <Modal open onClose={onClose} title={template ? "Sabit görevi düzenle" : "Yeni sabit görev"}>
      <div className="space-y-4">
        <Field label="Bölüm">
          <select
            className={selectClass}
            value={workRole}
            onChange={(e) => {
              setWorkRole(e.target.value as WorkRole);
              setShiftTemplateId("");
              setFields((f) => ({ ...f, assigneeId: "" }));
            }}
          >
            {WORK_ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <TaskFieldsForm value={fields} onChange={setFields} people={people} />

        <div className="rounded-lg border p-3">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!once} onChange={() => setOnce(false)} /> Her hafta
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={once} onChange={() => setOnce(true)} /> Tek bir gün
            </label>
          </div>
          {once ? (
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-3 w-44" />
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {WEEKDAYS_SHORT.map((d, i) => {
                const on = weekdays.includes(i + 1);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWeekdays((l) => (on ? l.filter((x) => x !== i + 1) : [...l, i + 1]))}
                    className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Belirli saatte
            </label>
            {timed ? (
              <Input type="time" value={at} onChange={(e) => setAt(e.target.value)} className="w-32" />
            ) : (
              <select className={cn(selectClass, "w-64")} value={shiftTemplateId} onChange={(e) => setShiftTemplateId(e.target.value)}>
                <option value="">Bölümün tüm vardiyalarında</option>
                {roleShiftTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Yalnız: {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {timed
              ? "Görev, o saatte vardiyada olan ekibe düşer."
              : "Görev, vardiya boyunca yapılır."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReturnTask({ task, onClose }: { task: StationTask; onClose: () => void }) {
  const { busy, run } = useOp();
  const [note, setNote] = useState("");

  async function save() {
    if (note.trim().length < 3) return toast.error("Neyin düzeltilmesi gerektiğini yazın.");
    const ok = await run("stationTaskAction", { operationId: newId(), taskId: task.id, kind: "return", note: note.trim() }, "Görev düzeltme için geri gönderildi.");
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Görevi geri gönder" description={`${task.title} · ${task.completedName ?? ""}`}>
      <div className="space-y-4">
        <Field label="Ne düzeltilmeli?" hint="Görev yeniden açılır; önceki fotoğraf ve not işlem geçmişinde kalır.">
          <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} Geri gönder
          </Button>
        </div>
      </div>
    </Modal>
  );
}
