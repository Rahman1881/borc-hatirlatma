"use client";

import { BelgeListe } from "@/components/belgeler/belge-liste";
import { Box, Loading, PageHeader, useBelgeler } from "@/components/belgeler/ui";

export default function SirketBelgeleriPage() {
  const { data, failed, op, reload } = useBelgeler();
  if (!data) return <Loading failed={failed} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Şirket Belgeleri"
        description="Lisanslar, ruhsatlar, resmî evrak, sigorta poliçeleri, periyodik kontroller ve sözleşmeler."
      />
      <Box>
        <BelgeListe
          data={data}
          belgeler={data.belgeler.filter((b) => b.kapsam === "sirket")}
          op={op}
          reload={reload}
          yeni={{ kapsam: "sirket" }}
          bos="Henüz şirket belgesi eklenmemiş."
        />
      </Box>
    </div>
  );
}
