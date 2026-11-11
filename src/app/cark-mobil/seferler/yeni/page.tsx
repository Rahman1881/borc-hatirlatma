"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/cark-mobil/ui";
import { TripForm } from "@/components/cark-mobil/trip-form";

export default function YeniSeferPage() {
  return (
    <div className="space-y-6">
      <Link href="/cark-mobil/seferler" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Seferler
      </Link>
      <PageHeader title="Yeni sefer" description="Tanker, şoför ve durakları seçin; sefer şoförün telefonuna atanır." />
      <TripForm />
    </div>
  );
}
