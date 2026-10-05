// Next.js sunucu açılırken bir kez çağırır.
export async function register() {
  // WhatsApp yalnızca Node çalışma ortamında ve canlıda kendiliğinden bağlansın;
  // geliştirme ortamında her açılışta arka planda Chrome başlatmayalım.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { autoStartWhatsApp } = await import("@/lib/whatsapp");
  autoStartWhatsApp();
}
