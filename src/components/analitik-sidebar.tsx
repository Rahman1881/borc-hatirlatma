"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Users, ChevronLeft, Percent, Layers, Clock, Car } from "lucide-react";

const navItems = [
  {
    href: "/analitik",
    label: "Genel Bakış",
    description: "Dönemsel özet ve KPI'lar",
    icon: Users,
    exact: true,
  },
  {
    href: "/analitik/iskonto",
    label: "İskonto & Zarar",
    description: "Vazgeçilen ciro, yakıt & temsilci",
    icon: Percent,
    exact: false,
  },
  {
    href: "/analitik/segmentler",
    label: "Segmentler",
    description: "RFM: Sadık / Yeni / Kaçan",
    icon: Layers,
    exact: false,
  },
  {
    href: "/analitik/zaman",
    label: "Zaman & Yoğunluk",
    description: "Saatlik ve haftalık desen",
    icon: Clock,
    exact: false,
  },
  {
    href: "/analitik/plakalar",
    label: "Plakalar",
    description: "Plaka ara ve profil incele",
    icon: Car,
    exact: false,
  },
];

export default function AnalitikSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-5 border-b">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Panel Seçimi
        </Link>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <Users className="h-5 w-5" />
          </span>
          <div className="leading-none">
            <h1 className="text-base font-bold tracking-tight">Müşteri Analitiği</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Plaka bazlı analiz</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-5 w-5 shrink-0 mt-0.5" />
              <span className="flex flex-col">
                <span className="font-medium leading-tight">{item.label}</span>
                <span
                  className={cn(
                    "text-[11px] leading-tight",
                    isActive ? "text-primary-foreground/75" : "text-muted-foreground/70"
                  )}
                >
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        <p className="text-xs text-muted-foreground text-center">
          Petrol Ofisi · Analitik Modülü
        </p>
      </div>
    </aside>
  );
}
