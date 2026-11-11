"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Building2, CalendarDays, Droplets, Fuel, LayoutDashboard, LayoutGrid, ListChecks, LogOut, Route, Settings, Smartphone, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCark } from "./store";

type NavItem = { href: string; label: string; exact?: boolean; icon: typeof Bell };
const navGroups: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Panel Seçimi", exact: true, icon: LayoutGrid },
      { href: "/cark-mobil", label: "Özet", exact: true, icon: LayoutDashboard },
    ],
  },
  {
    title: "İstasyon",
    items: [
      { href: "/cark-mobil/vardiyalar", label: "Vardiyalar", icon: CalendarDays },
      { href: "/cark-mobil/gorevler", label: "Görevler", icon: ListChecks },
      { href: "/cark-mobil/yikama", label: "Yıkama", icon: Droplets },
    ],
  },
  {
    title: "Tanker",
    items: [
      { href: "/cark-mobil/seferler", label: "Seferler", icon: Route },
      { href: "/cark-mobil/musteriler", label: "Müşteriler", icon: Building2 },
      { href: "/cark-mobil/tankerler", label: "Tankerler", icon: Truck },
      { href: "/cark-mobil/yakit-alimlari", label: "Araç Yakıt Alımları", icon: Fuel },
    ],
  },
  {
    title: "Genel",
    items: [
      { href: "/cark-mobil/ekip", label: "Ekip", icon: Users },
      { href: "/cark-mobil/bildirimler", label: "Bildirimler", icon: Bell },
      { href: "/cark-mobil/ayarlar", label: "Ayarlar", icon: Settings },
    ],
  },
];

export default function CarkMobilSidebar() {
  const pathname = usePathname();
  const { phase, me, notices, logout } = useCark();
  const unread = notices.filter((n) => !n.read).length;

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="border-b p-5">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Smartphone className="h-5 w-5" /> Çark Mobil
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">İstasyon ve tanker yönetimi</p>
      </div>
      <nav className="flex-1 space-y-3 overflow-y-auto p-3">
        {navGroups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.title && (
              <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{group.title}</p>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/cark-mobil/bildirimler" && unread > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{unread}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t p-4">
        {phase === "ready" && me ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{me.displayName || me.username || me.email}</p>
              <p className="text-xs text-muted-foreground">Yönetici</p>
            </div>
            <button
              onClick={logout}
              title="Çıkış yap"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">Mobil uygulamayla aynı veriler</p>
        )}
      </div>
    </aside>
  );
}
