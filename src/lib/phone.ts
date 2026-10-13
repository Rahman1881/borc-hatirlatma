// Google'dan gelen telefon numarasını WhatsApp biçimine (90XXXXXXXXXX) çevirir.
// Yalnız Türkiye cep numaraları (5xx) kabul edilir; sabit hatlarda WhatsApp
// neredeyse hiç olmadığı için onlar için null döner. İstemci (buton görünürlüğü)
// ve sunucu (gönderim) aynı kuralı kullansın diye ortak modülde.
export function toWhatsAppNumber(raw: string): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("90") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length !== 10 || !d.startsWith("5")) return null;
  return `90${d}`;
}
