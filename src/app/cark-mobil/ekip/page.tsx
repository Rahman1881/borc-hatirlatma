"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCark } from "@/components/cark-mobil/store";
import { Box, Empty, Field, Modal, PageHeader, Spinner, Tag, selectClass, useOp } from "@/components/cark-mobil/ui";
import type { AppUser, WorkRole } from "@/lib/cark-mobil/types";
import { WORK_ROLES, duties, personnelLabel } from "@/lib/cark-mobil/util";

// Ekip: yönetici ve personel hesapları. Bir kişi birden fazla iş yapabilir (şoför, pompacı,
// market görevlisi, yıkamacı). Personel kullanıcı adı + 6 haneli PIN ile girer; yönetici PIN ya
// da e-posta ile girebilir. PIN'ler sunucuda özetlenerek saklanır, burada görüntülenemez.

export default function EkipPage() {
  const { users, me } = useCark();
  const [editing, setEditing] = useState<AppUser | "new" | null>(null);

  const list = [...users].sort(
    (a, b) =>
      Number(b.active ?? false) - Number(a.active ?? false) ||
      Number(b.role === "admin") - Number(a.role === "admin") ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "", "tr")
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ekip"
        description="Yönetici ve personel hesapları. Pasife alınan kişi uygulamaya giremez; geçmiş kayıtları korunur."
        action={
          <Button className="h-9" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Yeni kişi
          </Button>
        }
      />
      <Box>
        {list.length === 0 ? (
          <Empty>Henüz ekip üyesi yok.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Ad</th>
                  <th className="px-3 py-2 font-medium">Görev</th>
                  <th className="px-3 py-2 font-medium">Giriş</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">
                      {u.displayName}
                      {u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(siz)</span>}
                    </td>
                    <td className="px-3 py-2.5">{personnelLabel(u)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {u.loginMethod === "pin" || u.role !== "admin" ? `${u.username ?? "—"} · PIN` : u.email || "—"}
                    </td>
                    <td className="px-3 py-2.5">{u.active ? <Tag tone="green">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
                    <td className="py-2.5 pl-3 text-right">
                      <Button variant="ghost" size="icon-sm" title="Düzenle" onClick={() => setEditing(u)}>
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
      {editing && <UserForm user={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  const { me } = useCark();
  const { busy, run } = useOp();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [admin, setAdmin] = useState(user?.role === "admin");
  const [jobs, setJobs] = useState<WorkRole[]>(() => (user ? duties(user) : ["driver"]));
  const [loginMethod, setLoginMethod] = useState<"pin" | "email">(user?.loginMethod ?? (user?.role === "admin" ? "email" : "pin"));
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(user?.active ?? true);

  const usePin = !admin || loginMethod === "pin";
  const hadPin = !!user && (user.loginMethod === "pin" || user.role !== "admin") && !!user.username;
  const self = user?.id === me?.id;

  async function save() {
    if (displayName.trim().length < 2) return toast.error("Adı girin.");
    if (!admin && jobs.length === 0) return toast.error("En az bir görev seçin.");
    // Hesabın ana görevi: yönetici ya da (varsa önceki) seçili ilk iş.
    const role = admin ? "admin" : jobs.includes(user?.role as WorkRole) ? (user!.role as WorkRole) : jobs[0];
    if (usePin) {
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username.trim().toLowerCase()))
        return toast.error("Kullanıcı adı 3–32 karakter olmalı; küçük harf, rakam, nokta ve tire kullanılabilir.");
      if (pin && !/^\d{6}$/.test(pin)) return toast.error("PIN tam 6 rakam olmalı.");
      if (!pin && !hadPin) return toast.error("İlk giriş için 6 haneli PIN belirleyin.");
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return toast.error("Geçerli bir e-posta girin.");
    }
    const ok = await run(
      "saveUser",
      {
        ...(user ? { id: user.id } : {}),
        displayName: displayName.trim(),
        role,
        workRoles: jobs,
        active,
        loginMethod: usePin ? "pin" : "email",
        ...(usePin ? { username: username.trim().toLowerCase(), ...(pin ? { pin } : {}) } : { email: email.trim() }),
      },
      "Kişi kaydedildi."
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={user ? "Kişiyi düzenle" : "Yeni kişi"}>
      <div className="space-y-4">
        <Field label="Ad soyad">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hesap türü">
            <select
              className={selectClass}
              value={admin ? "admin" : "staff"}
              disabled={self}
              onChange={(e) => setAdmin(e.target.value === "admin")}
            >
              <option value="staff">Personel</option>
              <option value="admin">Yönetici</option>
            </select>
          </Field>
          {admin && (
            <Field label="Giriş yöntemi">
              <select className={selectClass} value={loginMethod} onChange={(e) => setLoginMethod(e.target.value as "pin" | "email")}>
                <option value="pin">Kullanıcı adı + PIN</option>
                <option value="email">E-posta</option>
              </select>
            </Field>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{admin ? "Yaptığı işler (isteğe bağlı)" : "Yaptığı işler"}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WORK_ROLES.map((r) => (
              <label key={r.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={jobs.includes(r.key)}
                  onChange={(e) => setJobs((l) => (e.target.checked ? [...l, r.key] : l.filter((x) => x !== r.key)))}
                />
                {r.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Bir kişi birden fazla iş yapabilir. Vardiyaya ve sefere yalnız o işi yapabilen kişiler atanır.
          </p>
        </div>
        {usePin ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kullanıcı adı">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={hadPin ? "Yeni PIN (değişmeyecekse boş)" : "PIN (6 rakam)"}>
              <Input
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
        ) : (
          <Field label="E-posta" hint="Şifre bu e-postadaki hesapla belirlenir; mobil uygulamadaki mevcut yönetici girişi korunur.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} /> Aktif
        </label>
        {self && <p className="text-xs text-muted-foreground">Kendi yönetici yetkinizi ya da aktifliğinizi kaldıramazsınız.</p>}
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
