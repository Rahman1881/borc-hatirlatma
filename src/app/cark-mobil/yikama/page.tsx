"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Pencil, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fb } from "@/lib/cark-mobil/firebase";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, Spinner, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import type { WashJob, WashPayment, WashService } from "@/lib/cark-mobil/types";
import { dateTime, istClock, istDay, money, newId, parseMoney, todayIso } from "@/lib/cark-mobil/util";

// Araç yıkama: market ödemeyi alıp kaydı açar, araç sıraya girer, yıkamacı başlatıp bitirir.
// Aynı anda tek araç yıkanır. Uygulama ödeme ya da iade işlemi yapmaz; yalnız kaydını tutar.

const JOB: Record<WashJob["status"], { text: string; tone: "muted" | "amber" | "green" | "red" }> = {
  waiting: { text: "Sırada", tone: "muted" },
  washing: { text: "Yıkanıyor", tone: "amber" },
  completed: { text: "Tamamlandı", tone: "green" },
  cancelled: { text: "İptal", tone: "red" },
};
const PAY: Record<WashPayment["status"], { text: string; tone: "green" | "amber" | "muted" }> = {
  paid: { text: "Ödendi", tone: "green" },
  refund_pending: { text: "İade bekliyor", tone: "amber" },
  refunded: { text: "İade yapıldı", tone: "muted" },
};
const METHOD: Record<string, string> = { cash: "Nakit", card: "Kart" };

type Action = { job: WashJob; kind: "complete" | "cancel" | "refund" };

export default function YikamaPage() {
  const { busy, run } = useOp();
  const [services, setServices] = useState<WashService[]>([]);
  const [queue, setQueue] = useState<WashJob[] | null>(null);
  const [history, setHistory] = useState<WashJob[]>([]);
  const [payments, setPayments] = useState<Record<string, WashPayment>>({});
  const [adding, setAdding] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [action, setAction] = useState<Action | null>(null);

  useEffect(() => {
    const { db } = fb();
    const jobs = (s: { docs: { id: string; data: () => object }[] }) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as WashJob);
    const subs = [
      onSnapshot(collection(db, "washServices"), (s) => setServices(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WashService))),
      onSnapshot(
        query(collection(db, "washJobs"), where("status", "in", ["waiting", "washing"]), orderBy("createdAtMs"), limit(200)),
        (s) => setQueue(jobs(s)),
        () => setQueue([])
      ),
      onSnapshot(
        query(collection(db, "washJobs"), where("status", "in", ["completed", "cancelled"]), orderBy("createdAtMs", "desc"), limit(200)),
        (s) => setHistory(jobs(s)),
        () => setHistory([])
      ),
      onSnapshot(
        query(collection(db, "washPayments"), orderBy("createdAtMs", "desc"), limit(400)),
        (s) => setPayments(Object.fromEntries(s.docs.map((d) => [d.id, { id: d.id, ...d.data() } as WashPayment]))),
        () => setPayments({})
      ),
    ];
    return () => subs.forEach((off) => off());
  }, []);

  const today = todayIso();
  const stats = useMemo(() => {
    const todays = [...(queue ?? []), ...history].filter((j) => istDay(j.createdAtMs) === today);
    const paid = todays.map((j) => payments[j.id]).filter((p): p is WashPayment => !!p && p.status === "paid");
    return {
      count: todays.filter((j) => j.status !== "cancelled").length,
      total: paid.reduce((a, p) => a + p.priceCents, 0),
      cash: paid.filter((p) => p.paymentMethod === "cash").reduce((a, p) => a + p.priceCents, 0),
      card: paid.filter((p) => p.paymentMethod === "card").reduce((a, p) => a + p.priceCents, 0),
      refunds: Object.values(payments).filter((p) => p.status === "refund_pending").length,
    };
  }, [queue, history, payments, today]);

  const washing = (queue ?? []).some((j) => j.status === "washing");

  async function start(job: WashJob) {
    await run("washOrderAction", { operationId: newId(), id: job.id, kind: "start", note: "" }, `${job.plate} yıkamaya alındı.`);
  }

  const active = services.filter((s) => s.active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yıkama"
        description="Yıkama sırası, ödeme kayıtları ve hizmet fiyatları."
        action={
          <div className="flex gap-2">
            <Button variant="outline" className="h-9" onClick={() => setShowServices(true)}>
              <Settings2 className="h-4 w-4" /> Hizmetler ve fiyatlar
            </Button>
            <Button className="h-9" onClick={() => setAdding(true)} disabled={active.length === 0} title={active.length === 0 ? "Önce bir yıkama hizmeti tanımlayın" : undefined}>
              <Plus className="h-4 w-4" /> Yeni yıkama
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Bugünkü araç", String(stats.count)],
          ["Bugünkü tahsilat", money(stats.total)],
          ["Nakit · kart", `${money(stats.cash)} · ${money(stats.card)}`],
          ["İade bekleyen", String(stats.refunds)],
        ].map(([label, value]) => (
          <Box key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
          </Box>
        ))}
      </div>

      <Box>
        <p className="mb-3 text-sm font-semibold">Sıra</p>
        {queue === null ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : queue.length === 0 ? (
          <Empty>Sırada araç yok.</Empty>
        ) : (
          <div className="divide-y">
            {queue.map((j) => (
              <div key={j.id} className={cn("flex flex-wrap items-center gap-3 py-3", j.status === "washing" && "bg-amber-500/5")}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">{j.queueNumber}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{j.plate}</p>
                  <p className="text-xs text-muted-foreground">
                    {j.serviceName} · {istClock(j.createdAtMs)} · kaydı açan {j.createdByName || "—"}
                    {j.status === "washing" && ` · yıkayan ${j.washerName || "—"} (${istClock(j.startedAtMs)})`}
                    {j.note && ` · ${j.note}`}
                  </p>
                </div>
                <span className="text-sm tabular-nums">{money(payments[j.id]?.priceCents)}</span>
                <Tag tone={JOB[j.status].tone}>{JOB[j.status].text}</Tag>
                {j.status === "waiting" ? (
                  <>
                    <Button variant="outline" size="sm" disabled={busy || washing} onClick={() => start(j)} title={washing ? "Önce yıkanan araç tamamlanmalı" : undefined}>
                      Yıkamaya başla
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAction({ job: j, kind: "cancel" })}>
                      İptal
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => setAction({ job: j, kind: "complete" })}>
                    Tamamlandı
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Box>

      <Box>
        <p className="mb-3 text-sm font-semibold">Geçmiş (son 200)</p>
        {history.length === 0 ? (
          <Empty>Henüz tamamlanan ya da iptal edilen yıkama yok.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Kayıt</th>
                  <th className="px-3 py-2 font-medium">Sıra</th>
                  <th className="px-3 py-2 font-medium">Plaka</th>
                  <th className="px-3 py-2 font-medium">Hizmet</th>
                  <th className="px-3 py-2 font-medium">Yıkayan</th>
                  <th className="px-3 py-2 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2 font-medium">Ödeme</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {history.map((j) => {
                  const p = payments[j.id];
                  return (
                    <tr key={j.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3">{dateTime(j.createdAtMs)}</td>
                      <td className="px-3 py-2 tabular-nums">{j.queueNumber}</td>
                      <td className="px-3 py-2 font-medium">{j.plate}</td>
                      <td className="px-3 py-2">{j.serviceName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{j.washerName || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {p ? money(p.priceCents) : "—"}
                        {p?.discounted && <span className="ml-1 text-xs text-muted-foreground">(indirimli)</span>}
                      </td>
                      <td className="px-3 py-2">
                        {p && (
                          <>
                            <Tag tone={PAY[p.status].tone}>{PAY[p.status].text}</Tag>
                            {p.paymentMethod && <span className="ml-1.5 text-xs text-muted-foreground">{METHOD[p.paymentMethod]}</span>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Tag tone={JOB[j.status].tone}>{JOB[j.status].text}</Tag>
                        {j.cancelReason && <p className="mt-0.5 max-w-40 text-xs text-muted-foreground">{j.cancelReason}</p>}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {p?.status === "refund_pending" && (
                          <Button variant="outline" size="sm" onClick={() => setAction({ job: j, kind: "refund" })}>
                            İade yapıldı
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      {adding && <NewWash services={active} onClose={() => setAdding(false)} />}
      {showServices && <ServicesModal services={services} onClose={() => setShowServices(false)} />}
      {action && <ActionModal action={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function NewWash({ services, onClose }: { services: WashService[]; onClose: () => void }) {
  const { busy, run } = useOp();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [plate, setPlate] = useState("");
  const [method, setMethod] = useState<"" | "cash" | "card">("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const service = services.find((s) => s.id === serviceId);

  async function save() {
    if (!service) return toast.error("Hizmet seçin.");
    if (plate.trim().length < 3) return toast.error("Plakayı girin.");
    const priceCents = price.trim() ? parseMoney(price) : null;
    if (price.trim() && priceCents == null) return toast.error("Tutar geçersiz.");
    const r = await run<{ queueNumber: number }>("washCreateOrder", {
      operationId: newId(),
      id: newId(),
      serviceId,
      plate: plate.trim(),
      paymentMethod: method || null,
      ...(priceCents != null ? { priceCents } : {}),
      note: note.trim(),
    });
    if (!r) return;
    toast.success(`Kayıt açıldı · sıra numarası ${r.queueNumber}`);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Yeni yıkama" description="Ödeme alındıktan sonra kayıt açılır; araç sıraya girer ve yıkamacıya bildirim gider.">
      <div className="space-y-4">
        <Field label="Plaka">
          <Input autoFocus value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} placeholder="54 ABC 123" />
        </Field>
        <Field label="Hizmet">
          <select className={selectClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {money(s.priceCents)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Alınan tutar (TL)" hint="Boşsa liste fiyatı; indirimliyse alınan tutarı yazın.">
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={service ? (service.priceCents / 100).toLocaleString("tr-TR") : ""} />
          </Field>
          <Field label="Ödeme şekli (isteğe bağlı)">
            <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as "" | "cash" | "card")}>
              <option value="">Belirtilmedi</option>
              <option value="cash">Nakit</option>
              <option value="card">Kart</option>
            </select>
          </Field>
        </div>
        <Field label="Not (isteğe bağlı)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} Sıraya ekle
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const ACTION_TEXT: Record<Action["kind"], { title: string; label: string; button: string; ok: string }> = {
  complete: { title: "Yıkamayı tamamla", label: "Not (başka personel adına tamamlıyorsanız gerekçe)", button: "Tamamlandı", ok: "Yıkama tamamlandı." },
  cancel: { title: "Yıkamayı iptal et", label: "İptal gerekçesi", button: "İptal et", ok: "Kayıt iptal edildi; iade bekliyor." },
  refund: { title: "İade yapıldı", label: "Açıklama (iade nasıl yapıldı?)", button: "İadeyi kaydet", ok: "İade kaydedildi." },
};

function ActionModal({ action, onClose }: { action: Action; onClose: () => void }) {
  const { busy, run } = useOp();
  const { me } = useCark();
  const [note, setNote] = useState("");
  const t = ACTION_TEXT[action.kind];
  // Kendi başlattığı yıkamayı tamamlarken açıklama gerekmez.
  const required = action.kind !== "complete" || action.job.washerId !== me?.id;

  async function save() {
    if (required && note.trim().length < 3) return toast.error("Açıklama yazın (en az 3 harf).");
    const ok = await run("washOrderAction", { operationId: newId(), id: action.job.id, kind: action.kind, note: note.trim() }, t.ok);
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={t.title} description={`${action.job.plate} · ${action.job.serviceName ?? ""}`}>
      <div className="space-y-4">
        <Field label={t.label}>
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={onClose}>
            Vazgeç
          </Button>
          <Button className="h-9" onClick={save} disabled={busy}>
            {busy && <Spinner />} {t.button}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ServicesModal({ services, onClose }: { services: WashService[]; onClose: () => void }) {
  const { busy, run } = useOp();
  const blank = { id: "", name: "", price: "", active: true };
  const [form, setForm] = useState(blank);

  async function save() {
    const priceCents = parseMoney(form.price);
    if (form.name.trim().length < 2) return toast.error("Hizmet adını girin.");
    if (priceCents == null) return toast.error("Fiyatı girin.");
    const ok = await run(
      "washSaveService",
      { operationId: newId(), id: form.id || newId(), name: form.name.trim(), priceCents, active: form.active },
      "Hizmet kaydedildi."
    );
    if (ok) setForm(blank);
  }

  return (
    <Modal open onClose={onClose} title="Yıkama hizmetleri ve fiyatlar" description="Fiyat değişikliği eski ödeme kayıtlarını değiştirmez.">
      {services.length === 0 ? (
        <Empty>Henüz hizmet tanımlanmadı.</Empty>
      ) : (
        <div className="divide-y rounded-lg border text-sm">
          {[...services]
            .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "tr"))
            .map((s) => (
              <div key={s.id} className={cn("flex items-center gap-3 px-3 py-2", form.id === s.id && "bg-primary/5")}>
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="tabular-nums">{money(s.priceCents)}</span>
                {!s.active && <Tag>Pasif</Tag>}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Düzenle"
                  onClick={() => setForm({ id: s.id, name: s.name, price: (s.priceCents / 100).toLocaleString("tr-TR"), active: s.active })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </div>
      )}
      <div className="rounded-lg border p-3">
        <p className="mb-3 text-sm font-medium">{form.id ? "Hizmeti düzenle" : "Yeni hizmet"}</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Hizmet adı" className="col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} placeholder="İç-dış yıkama" />
          </Field>
          <Field label="Fiyat (TL)">
            <Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif
          </label>
          <div className="flex gap-2">
            {form.id && (
              <Button variant="outline" className="h-9" onClick={() => setForm(blank)}>
                Yeni hizmet
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
