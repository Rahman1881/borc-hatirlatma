"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCark } from "@/components/cark-mobil/store";
import { Empty, PageHeader } from "@/components/cark-mobil/ui";
import { TripForm } from "@/components/cark-mobil/trip-form";

export default function SeferDuzenlePage() {
  const { id } = useParams<{ id: string }>();
  const { activeTrips } = useCark();
  const trip = activeTrips.find((t) => t.id === id);

  return (
    <div className="space-y-6">
      <Link
        href={`/cark-mobil/seferler/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Sefer
      </Link>
      <PageHeader title="Seferi düzenle" description="Yalnız henüz başlamamış (atanmış) sefer düzenlenebilir." />
      {trip?.status === "assigned" ? (
        <TripForm key={trip.id} editing={trip} />
      ) : (
        <Empty>Bu sefer düzenlenemez (başlamış, tamamlanmış ya da bulunamadı).</Empty>
      )}
    </div>
  );
}
