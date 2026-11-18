"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, Building2, FolderOpen, LayoutGrid, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Panel Seçimi", exact: true, icon: LayoutGrid },
  { href: "/belgeler", label: "Genel Bakış", exact: true, icon: FolderOpen },
  { href: "/belgeler/sirket", label: "Şirket Belgeleri", icon: Building2 },
  { href: "/belgeler/araclar", label: "Araç Belgeleri", icon: Truck },
  { href: "/belgeler/personel", label: "Personel Belgeleri", icon: Users },
  { href: "/belgeler/ayarlar", label: "Hatırlatma Ayarları", icon: BellRing },
];

export default function BelgelerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-5 border-b">
        <h1 className="text-lg font-bold tracking-tight">Şirket ve Özlük Belgeleri</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Belgeler ve süre hatırlatmaları</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <p className="text-xs text-muted-foreground text-center">Dosyalar sunucuda saklanır</p>
      </div>
    </aside>
  );
}
