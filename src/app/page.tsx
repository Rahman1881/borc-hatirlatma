"use client";

import Link from "next/link";
import { ArrowRight, Fuel, RadioTower } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const modules = [
  {
    href: "/dashboard",
    title: "Borç Hatırlatma",
    description:
      "Excel müşteri listesi, WhatsApp mesaj gönderimi, şablonlar ve gönderim geçmişi.",
    icon: Fuel,
  },
  {
    href: "/utts",
    title: "UTTS Modülü",
    description:
      "UTTS giriş bilgileriyle bağlantı kurun ve montaj verilerini ayrı ekranda takip edin.",
    icon: RadioTower,
  },
];

export default function ModuleSelectPage() {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center">
      <div className="w-full max-w-5xl mx-auto space-y-8">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Panel Seçimi</h2>
          <p className="text-muted-foreground">
            Kullanmak istediğiniz modülü seçerek devam edin.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Card key={module.href} className="transition-colors hover:border-primary/50">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <h3 className="text-xl font-semibold">{module.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {module.description}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={module.href}
                    className={cn(buttonVariants(), "mt-6 w-full")}
                  >
                    Devam Et
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
