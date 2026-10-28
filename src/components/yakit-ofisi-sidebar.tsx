"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, BarChart3, CreditCard, Gauge, LayoutGrid, LayoutDashboard, Settings, TrendingDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Panel Seçimi", exact: true, icon: LayoutGrid },
  { href: "/yakit-ofisi", label: "Genel Bakış", exact: true, icon: LayoutDashboard },
  { href: "/yakit-ofisi/satislar", label: "Satışlar", icon: BarChart3 },
  { href: "/yakit-ofisi/borclar", label: "Borçlar", icon: Wallet },
  { href: "/yakit-ofisi/limit", label: "Limiti Azalanlar", icon: Gauge },
  { href: "/yakit-ofisi/alim-dusen", label: "Alımı Düşen veya Bırakanlar", icon: TrendingDown },
  { href: "/yakit-ofisi/reddedilen", label: "Pompada Reddedilenler", icon: Ban },
  { href: "/yakit-ofisi/kart-hatalari", label: "Kart Hataları", icon: CreditCard },
  { href: "/yakit-ofisi/ayarlar", label: "Bağlantı Ayarları", icon: Settings },
];

export default function YakitOfisiSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-5 border-b">
        <h1 className="text-lg font-bold tracking-tight">Yakıt Ofisi</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Filo, borç ve limit takibi</p>
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
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <p className="text-xs text-muted-foreground text-center">Yalnız okuma · Yakıt Ofisi&apos;nde değişiklik yapmaz</p>
      </div>
    </aside>
  );
}
