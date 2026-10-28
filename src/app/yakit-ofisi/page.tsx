"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, PageHeader, fmtDate, fmtNum, fmtTL, useYoData, type Section } from "./shared";

type Overview = {
  overdue: Section<{ count: number; dueBeforeToday: number; pastDue: number }>;
  upcoming: Section<{ count: number; amount: number }>;
  runway: Section<{ count: number; critical: number }>;
  churn: Section<{ count: number }>;
  rejected: Section<{ count: number }>;
  cardErrors: Section<{ count: number }>;
  fetchedAt: number;
};

function StatCard({
  title,
  href,
  section,
  value,
  detail,
}: {
  title: string;
  href: string;
  section: Section<unknown> | undefined;
  value: (d: never) => string;
  detail?: (d: never) => string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {!section ? (
            <div className="text-3xl font-bold text-muted-foreground">…</div>
          ) : section.error ? (
            <p className="text-xs text-destructive">{section.error}</p>
          ) : (
            <>
              <div className="text-3xl font-bold">{value(section.data as never)}</div>
              {detail && <p className="text-xs text-muted-foreground mt-1">{detail(section.data as never)}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function YakitOfisiOverviewPage() {
  const { data, loading, error, reload } = useYoData<Overview>("ozet");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yakıt Ofisi"
        description="Yakıt Ofisi'ndeki filo müşterilerinin özeti. Veriler yalnız okunur, Yakıt Ofisi'nde hiçbir şey değiştirilmez."
        loading={loading}
        onRefresh={reload}
      />
      {error && <ErrorNote message={error} />}
      {data?.overdue.error?.includes("anahtarı girilmemiş") ? (
        <ErrorNote message={data.overdue.error} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <StatCard
            title="Vadesi geçen borç"
            href="/yakit-ofisi/borclar"
            section={data?.overdue}
            value={(d: { dueBeforeToday: number }) => fmtTL(d.dueBeforeToday)}
            detail={(d: { count: number; pastDue: number }) => `${d.count} müşteri · gecikme sınırını aşan ${fmtTL(d.pastDue)}`}
          />
          <StatCard
            title="Vadesi gelmemiş borç"
            href="/yakit-ofisi/borclar?tab=gelen"
            section={data?.upcoming}
            value={(d: { amount: number }) => fmtTL(d.amount)}
            detail={(d: { count: number }) => `${d.count} müşteri`}
          />
          <StatCard
            title="Limiti 7 gün içinde bitecek"
            href="/yakit-ofisi/limit"
            section={data?.runway}
            value={(d: { count: number }) => fmtNum(d.count)}
            detail={(d: { critical: number }) => `${d.critical} tanesi 3 gün içinde`}
          />
          <StatCard
            title="Alımı düşen / bırakan müşteri"
            href="/yakit-ofisi/alim-dusen"
            section={data?.churn}
            value={(d: { count: number }) => fmtNum(d.count)}
          />
          <StatCard
            title="Pompada reddedilen alım (3 gün)"
            href="/yakit-ofisi/reddedilen"
            section={data?.rejected}
            value={(d: { count: number }) => fmtNum(d.count)}
          />
          <StatCard
            title="Kart hatası veren abonelik"
            href="/yakit-ofisi/kart-hatalari"
            section={data?.cardErrors}
            value={(d: { count: number }) => fmtNum(d.count)}
          />
        </div>
      )}
      {data && (
        <p className="text-xs text-muted-foreground">Son çekim: {fmtDate(new Date(data.fetchedAt).toISOString(), true)} (5 dk önbellek)</p>
      )}
    </div>
  );
}
