"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ChevronLeft, ChevronRight, Copy, LayoutTemplate, Plus, Repeat, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { callOp, errorText, fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, Spinner, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import { RotationModal } from "@/components/cark-mobil/rotation";
import type { AppUser, Attendance, Shift, ShiftTemplate, WorkRole } from "@/lib/cark-mobil/types";
import {
  WEEKDAYS_SHORT,
  WORK_ROLES,
  addDaysIso,
  dayLabel,
  hasDuty,
  istClock,
  istDay,
  istMinute,
  istMs,
  minuteText,
  newId,
  parseMinute,
  roleLabel,
  todayIso,
  weekStart,
} from "@/lib/cark-mobil/util";

// Haftalık vardiya planı. Vardiya taslak kaydedilir, yayınlanınca personelin telefonuna düşer.
// Market ve yıkama için "otomatik düzen" tanımlanırsa sunucu sonraki haftaları kendisi yayınlar.

const ROLE_TONE: Record<WorkRole, string> = {
  pump: "border-l-amber-500",
  market: "border-l-violet-500",
  wash: "border-l-sky-500",
  driver: "border-l-emerald-500",
};

const STATUS: Record<Shift["status"], { text: string; tone: "amber" | "green" | "red" }> = {
  draft: { text: "Taslak", tone: "amber" },
  published: { text: "Yayında", tone: "green" },
  cancelled: { text: "İptal", tone: "red" },
};

export default function VardiyalarPage() {
  const { users } = useCark();
  const { busy, run } = useOp();
  const [week, setWeek] = useState(() => weekStart(todayIso()));
  const [role, setRole] = useState<WorkRole | "">("");
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [editing, setEditing] = useState<{ shift: Shift | null; day: string } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRotation, setShowRotation] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const from = istMs(week);
  const to = istMs(addDaysIso(week, 7));

  useEffect(() => {
    const { db } = fb();
    const subs = [
      onSnapshot(
        query(collection(db, "shifts"), where("startsAtMs", ">=", from), where("startsAtMs", "<", to), orderBy("startsAtMs")),
        (s) => setShifts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift)),
        () => setShifts([])
      ),
      onSnapshot(
        query(collection(db, "attendance"), where("shiftStartsAtMs", ">=", from), where("shiftStartsAtMs", "<", to)),
        (s) => setAttendance(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Attendance)),
        () => setAttendance([])
      ),
    ];
    return () => subs.forEach((off) => off());
  }, [from, to]);

  useEffect(
    () =>
      onSnapshot(collection(fb().db, "shiftTemplates"), (s) =>
        setTemplates(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ShiftTemplate))
      ),
    []
  );

  const visible = useMemo(() => (shifts ?? []).filter((s) => !role || s.workRole === role), [shifts, role]);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(week, i));
  const drafts = visible.filter((s) => s.status === "draft");
  const today = todayIso();

  async function copyWeek() {
    if (!confirm("Önceki haftanın vardiyaları bu haftaya taslak olarak kopyalansın mı?")) return;
    const r = await run<{ copied: number }>("stationCopyWeek", {
      operationId: newId(),
      sourceStartMs: istMs(addDaysIso(week, -7)),
      targetStartMs: from,
    });
    if (r) toast.success(r.copied ? `${r.copied} vardiya taslak olarak kopyalandı.` : "Kopyalanacak yeni vardiya yok.");
  }

  // Yayınlama vardiya bazındadır; taslaklar sırayla yayınlanır, hata olan atlanır.
  async function publishDrafts() {
    if (!confirm(`${drafts.length} taslak vardiya yayınlansın mı? Personele bildirim gider.`)) return;
    setPublishing(true);
    let ok = 0;
    const failed: string[] = [];
    for (const s of drafts) {
      try {
        await callOp("stationSaveShift", shiftPayload(s, true));
        ok++;
      } catch (e) {
        failed.push(`${s.name}: ${errorText(e)}`);
      }
    }
    setPublishing(false);
    if (ok) toast.success(`${ok} vardiya yayınlandı.`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" · "));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vardiyalar"
        description="Haftalık vardiya planı, personel giriş-çıkışları ve otomatik vardiya düzeni."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-9" onClick={() => setShowRotation(true)}>
              <Repeat className="h-4 w-4" /> Otomatik düzen
            </Button>
            <Button variant="outline" className="h-9" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate className="h-4 w-4" /> Saat şablonları
            </Button>
            <Button className="h-9" onClick={() => setEditing({ shift: null, day: week <= today && today < addDaysIso(week, 7) ? today : week })}>
              <Plus className="h-4 w-4" /> Yeni vardiya
            </Button>
          </div>
        }
      />

      <Box className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setWeek(addDaysIso(week, -7))} title="Önceki hafta">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-44 text-center text-sm font-semibold">
            {dayLabel(week)} – {dayLabel(addDaysIso(week, 6))}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeek(addDaysIso(week, 7))} title="Sonraki hafta">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {week !== weekStart(today) && (
            <Button variant="ghost" size="sm" onClick={() => setWeek(weekStart(today))}>
              Bu hafta
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[{ key: "" as const, short: "Tümü" }, ...WORK_ROLES].map((r) => (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                role === r.key ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground"
              )}
            >
              {r.short}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyWeek} disabled={busy}>
            <Copy className="h-4 w-4" /> Önceki haftayı kopyala
          </Button>
          {drafts.length > 0 && (
            <Button size="sm" onClick={publishDrafts} disabled={publishing}>
              {publishing ? <Spinner /> : <Send className="h-4 w-4" />} Taslakları yayınla ({drafts.length})
            </Button>
          )}
        </div>
      </Box>

      {shifts === null ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((day, i) => {
            const list = visible.filter((s) => istDay(s.startsAtMs) === day);
            return (
              <div key={day} className={cn("rounded-xl border bg-card p-3", day === today && "ring-2 ring-primary/40")}>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-sm font-semibold">
                    {WEEKDAYS_SHORT[i]} <span className="font-normal text-muted-foreground">{dayLabel(day)}</span>
                  </p>
                  <button
                    onClick={() => setEditing({ shift: null, day })}
                    title="Bu güne vardiya ekle"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {list.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Vardiya yok</p>}
                  {list.map((s) => {
                    const inCount = attendance.filter((a) => a.shiftId === s.id && a.checkedInAtMs).length;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setEditing({ shift: s, day })}
                        className={cn(
                          "block w-full rounded-lg border border-l-4 p-2 text-left hover:bg-muted/50",
                          ROLE_TONE[s.workRole],
                          s.status === "cancelled" && "opacity-50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs font-semibold leading-tight">{s.name}</p>
                          <Tag tone={STATUS[s.status].tone}>{STATUS[s.status].text}</Tag>
                        </div>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {istClock(s.startsAtMs)}–{istClock(s.endsAtMs)} · {roleLabel(s.workRole)}
                        </p>
                        <p className="mt-1 text-xs leading-snug">
                          {(s.members ?? []).map((m) => m.name).join(", ") || `${s.memberIds.length} kişi`}
                        </p>
                        {s.status === "published" && s.startsAtMs <= Date.now() && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Giriş: {inCount}/{s.memberIds.length}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ShiftModal
          key={editing.shift?.id ?? `new-${editing.day}`}
          shift={editing.shift}
          day={editing.day}
          users={users}
          templates={templates}
          attendance={attendance.filter((a) => a.shiftId === editing.shift?.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {showTemplates && <TemplatesModal templates={templates} onClose={() => setShowTemplates(false)} />}
      {showRotation && <RotationModal users={users} week={week} onClose={() => setShowRotation(false)} />}
    </div>
  );
}

function shiftPayload(s: Shift, publish: boolean) {
  return {
    operationId: newId(),
    id: s.id,
    name: s.name,
    workRole: s.workRole,
    templateId: s.templateId ?? null,
    startsAtMs: s.startsAtMs,
    endsAtMs: s.endsAtMs,
    memberIds: s.memberIds,
    publish,
    expectedRevision: s.revision ?? 0,
    notes: s.notes ?? "",
  };
}

function ShiftModal({
  shift,
  day,
  users,
  templates,
  attendance,
  onClose,
}: {
  shift: Shift | null;
  day: string;
  users: AppUser[];
  templates: ShiftTemplate[];
  attendance: Attendance[];
  onClose: () => void;
}) {
  const { busy, run } = useOp();
  const [workRole, setWorkRole] = useState<WorkRole>(shift?.workRole ?? "pump");
  const [templateId, setTemplateId] = useState(shift?.templateId ?? "");
  const [name, setName] = useState(shift?.name ?? "");
  const [date, setDate] = useState(shift ? istDay(shift.startsAtMs) : day);
  const [start, setStart] = useState(shift ? istClock(shift.startsAtMs) : "08:00");
  const [end, setEnd] = useState(shift ? istClock(shift.endsAtMs) : "16:00");
  const [memberIds, setMemberIds] = useState<string[]>(shift?.memberIds ?? []);
  const [notes, setNotes] = useState(shift?.notes ?? "");
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [fixing, setFixing] = useState<AppUser | null>(null);

  const cancelled = shift?.status === "cancelled";
  const published = shift?.status === "published";
  const roleTemplates = templates.filter((t) => t.active && t.workRole === workRole);
  const staff = users
    .filter((u) => (u.active && hasDuty(u, workRole)) || memberIds.includes(u.id))
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "tr"));

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setName(t.name);
    setStart(minuteText(t.startMinute));
    setEnd(minuteText(t.endMinute));
  }

  async function save(publish: boolean) {
    const s = parseMinute(start);
    const e = parseMinute(end);
    if (name.trim().length < 2) return toast.error("Vardiya adını girin.");
    if (s == null || e == null) return toast.error("Başlangıç ve bitiş saatini girin.");
    if (memberIds.length === 0) return toast.error("En az bir personel seçin.");
    // Bitiş başlangıçtan küçük ya da eşitse vardiya ertesi güne sarkar (gece vardiyası).
    const startsAtMs = istMs(date, s);
    const endsAtMs = istMs(date, e <= s ? e + 1440 : e);
    const r = await run<{ overlaps?: { userId: string; name: string }[] }>(
      "stationSaveShift",
      {
        operationId: newId(),
        id: shift?.id ?? newId(),
        name: name.trim(),
        workRole,
        templateId: templateId || null,
        startsAtMs,
        endsAtMs,
        memberIds,
        publish,
        expectedRevision: shift?.revision ?? 0,
        notes: notes.trim(),
      },
      publish ? "Vardiya yayınlandı." : "Taslak kaydedildi."
    );
    if (!r) return;
    if (r.overlaps?.length) {
      const names = [...new Set(r.overlaps.map((o) => users.find((u) => u.id === o.userId)?.displayName ?? "Personel"))];
      toast.warning(`${names.join(", ")} aynı saatlerde başka vardiyada da görünüyor.`);
    }
    onClose();
  }

  async function cancel() {
    if (!shift || (cancelReason ?? "").trim().length < 3) return toast.error("İptal gerekçesini yazın.");
    const ok = await run("stationCancelShift", { operationId: newId(), id: shift.id, reason: cancelReason!.trim() }, "Vardiya iptal edildi.");
    if (ok) onClose();
  }

  // Giriş kaydı olanlar: vardiyadaki kişiler + ataması kaldırılmış ama kaydı olanlar.
  const rows = [
    ...memberIds.map((id) => users.find((u) => u.id === id)).filter((u): u is AppUser => !!u),
    ...attendance
      .filter((a) => !memberIds.includes(a.userId))
      .map((a) => users.find((u) => u.id === a.userId) ?? ({ id: a.userId, displayName: a.userName } as AppUser)),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={shift ? `Vardiya · ${shift.name}` : "Yeni vardiya"}
      description={cancelled ? `İptal edildi: ${shift?.cancelReason ?? ""}` : undefined}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bölüm">
              <select
                className={selectClass}
                value={workRole}
                disabled={cancelled}
                onChange={(e) => {
                  setWorkRole(e.target.value as WorkRole);
                  setTemplateId("");
                  setMemberIds([]);
                }}
              >
                {WORK_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Saat şablonu">
              <select className={selectClass} value={templateId} disabled={cancelled} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">Şablonsuz</option>
                {roleTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({minuteText(t.startMinute)}–{minuteText(t.endMinute)})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Vardiya adı">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={cancelled} placeholder="Sabah vardiyası" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tarih">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={cancelled} />
            </Field>
            <Field label="Başlangıç">
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={cancelled} />
            </Field>
            <Field label="Bitiş" hint={(parseMinute(end) ?? 0) <= (parseMinute(start) ?? 0) ? "Ertesi gün" : undefined}>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={cancelled} />
            </Field>
          </div>
          <Field label="Not (isteğe bağlı)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} disabled={cancelled} />
          </Field>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Personel ({memberIds.length})</p>
            {staff.length === 0 ? (
              <p className="text-sm text-amber-600">
                Bu bölümde çalışabilen aktif personel yok. Ekip bölümünden kişiye &quot;{roleLabel(workRole)}&quot; işini ekleyin.
              </p>
            ) : (
              <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-2">
                {staff.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={cancelled}
                      checked={memberIds.includes(u.id)}
                      onChange={(e) => setMemberIds((l) => (e.target.checked ? [...l, u.id] : l.filter((x) => x !== u.id)))}
                    />
                    {u.displayName}
                  </label>
                ))}
              </div>
            )}
          </div>

          {shift && shift.status !== "draft" && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Giriş – çıkış</p>
              <div className="divide-y rounded-lg border text-sm">
                {rows.map((u) => {
                  const a = attendance.find((x) => x.userId === u.id);
                  return (
                    <div key={u.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {a?.checkedInAtMs ? `${istClock(a.checkedInAtMs)} – ${a.checkedOutAtMs ? istClock(a.checkedOutAtMs) : "içeride"}` : "Giriş yok"}
                      </span>
                      {a?.correctedBy && <Tag tone="blue">Düzeltildi</Tag>}
                      <Button variant="ghost" size="sm" onClick={() => setFixing(u)}>
                        Düzelt
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {cancelReason !== null && (
        <div className="flex items-end gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <Field label="İptal gerekçesi (personele bildirilir)" className="flex-1">
            <Input autoFocus value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={1000} />
          </Field>
          <Button variant="destructive" className="h-8" onClick={cancel} disabled={busy}>
            Vardiyayı iptal et
          </Button>
        </div>
      )}

      {!cancelled && (
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {shift && cancelReason === null && (
              <Button variant="destructive" className="h-9" onClick={() => setCancelReason("")}>
                İptal et
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!published && (
              <Button variant="outline" className="h-9" onClick={() => save(false)} disabled={busy}>
                Taslak kaydet
              </Button>
            )}
            <Button className="h-9" onClick={() => save(true)} disabled={busy}>
              {busy ? <Spinner /> : <Send className="h-4 w-4" />} {published ? "Değişiklikleri yayınla" : "Yayınla"}
            </Button>
          </div>
        </div>
      )}

      {fixing && shift && (
        <AttendanceFix
          shift={shift}
          user={fixing}
          current={attendance.find((a) => a.userId === fixing.id)}
          onClose={() => setFixing(null)}
        />
      )}
    </Modal>
  );
}

// "2026-11-11T08:05" (İstanbul saati) <-> epoch ms
function toLocalInput(ms: number | null | undefined): string {
  return ms ? `${istDay(ms)}T${minuteText(istMinute(ms))}` : "";
}
function fromLocalInput(v: string): number | null {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const minute = m ? parseMinute(m[2]) : null;
  return m && minute != null ? istMs(m[1], minute) : null;
}

function AttendanceFix({ shift, user, current, onClose }: { shift: Shift; user: AppUser; current?: Attendance; onClose: () => void }) {
  const { busy, run } = useOp();
  const [inAt, setInAt] = useState(toLocalInput(current?.checkedInAtMs ?? shift.startsAtMs));
  const [outAt, setOutAt] = useState(toLocalInput(current?.checkedOutAtMs));
  const [reason, setReason] = useState("");

  async function save() {
    const checkedInAtMs = fromLocalInput(inAt);
    const checkedOutAtMs = outAt ? fromLocalInput(outAt) : null;
    if (!checkedInAtMs) return toast.error("Giriş saatini girin.");
    if (reason.trim().length < 3) return toast.error("Düzeltme gerekçesini yazın.");
    const ok = await run(
      "stationCorrectAttendance",
      { operationId: newId(), shiftId: shift.id, userId: user.id, checkedInAtMs, checkedOutAtMs, reason: reason.trim() },
      "Giriş-çıkış kaydı düzeltildi."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${user.displayName} · giriş-çıkış düzelt`} description={`${shift.name} · ${dayLabel(istDay(shift.startsAtMs))}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giriş">
            <Input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} />
          </Field>
          <Field label="Çıkış (içerideyse boş)">
            <Input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Gerekçe" hint="Önceki ve sonraki değerler kayıtta saklanır.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
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

function TemplatesModal({ templates, onClose }: { templates: ShiftTemplate[]; onClose: () => void }) {
  const { busy, run } = useOp();
  const blank = { id: "", name: "", workRole: "pump" as WorkRole, start: "08:00", end: "16:00", active: true };
  const [form, setForm] = useState(blank);

  const list = [...templates].sort((a, b) => a.workRole.localeCompare(b.workRole) || a.startMinute - b.startMinute);

  async function save() {
    const startMinute = parseMinute(form.start);
    const endMinute = parseMinute(form.end);
    if (form.name.trim().length < 2) return toast.error("Şablon adını girin.");
    if (startMinute == null || endMinute == null) return toast.error("Saatleri girin.");
    const ok = await run(
      "stationSaveShiftTemplate",
      { operationId: newId(), id: form.id || newId(), name: form.name.trim(), workRole: form.workRole, startMinute, endMinute, active: form.active },
      "Şablon kaydedildi."
    );
    if (ok) setForm(blank);
  }

  return (
    <Modal open onClose={onClose} wide title="Saat şablonları" description="Bölüm bazında hazır vardiya saatleri. Şablonu değiştirmek, yayınlanmış vardiyaları değiştirmez.">
      {list.length === 0 ? (
        <Empty>Henüz şablon yok.</Empty>
      ) : (
        <div className="divide-y rounded-lg border text-sm">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() =>
                setForm({ id: t.id, name: t.name, workRole: t.workRole, start: minuteText(t.startMinute), end: minuteText(t.endMinute), active: t.active })
              }
              className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50", form.id === t.id && "bg-primary/5")}
            >
              <span className="w-28 text-muted-foreground">{roleLabel(t.workRole)}</span>
              <span className="flex-1 font-medium">{t.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {minuteText(t.startMinute)}–{minuteText(t.endMinute)}
              </span>
              {!t.active && <Tag>Pasif</Tag>}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-lg border p-3">
        <p className="mb-3 text-sm font-medium">{form.id ? "Şablonu düzenle" : "Yeni şablon"}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Bölüm">
            <select className={selectClass} value={form.workRole} onChange={(e) => setForm({ ...form, workRole: e.target.value as WorkRole })}>
              {WORK_ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ad" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Başlangıç">
            <Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </Field>
          <Field label="Bitiş">
            <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif
          </label>
          <div className="flex gap-2">
            {form.id && (
              <Button variant="outline" className="h-9" onClick={() => setForm(blank)}>
                Yeni şablon
              </Button>
            )}
            <Button className="h-9" onClick={save} disabled={busy}>
              {busy && <Spinner />} Kaydet
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
