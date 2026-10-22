// Next.js sunucu açılırken bir kez çağırır.
export async function register() {
  // Arka plan işleri yalnız Node çalışma ortamında ve canlıda başlasın; geliştirme
  // ortamında her açılışta Chrome başlatmayalım, Google'a tarama isteği atmayalım.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { autoStartWhatsApp } = await import("@/lib/whatsapp");
  autoStartWhatsApp();
  // Müşteri Bulucu → Yeni İşletmeler: haftalık otomatik tarama.
  const { startProspectScheduler } = await import("@/lib/prospect-watch");
  startProspectScheduler();
  // Zam/İndirim Tahmini: sabah pompa fiyatı kontrolü + eksik veri hatırlatması.
  const { startForecastScheduler } = await import("@/lib/fuel-forecast");
  startForecastScheduler();
}
