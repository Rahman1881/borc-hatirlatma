"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { aiNavItems } from "@/lib/ai-nav";
import { Sparkles, ChevronLeft } from "lucide-react";

export default function AiSidebar() {
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
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="leading-none">
            <h1 className="text-base font-bold tracking-tight">Çark Petrol AI</h1>
            <p className="text-xs text-muted-foreground mt-0.5">İş Asistanı</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {aiNavItems.map((item) => {
          const isActive =
            item.href === "/ai"
              ? pathname === "/ai"
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
          Petrol Ofisi · AI Modülü
        </p>
      </div>
    </aside>
  );
}
