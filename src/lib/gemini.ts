import getDb from "@/lib/db";

// Şimdilik Gemini kullanıyoruz; ileride başka bir AI sağlayıcıya geçilebilir.
// Model adı ve anahtarı Ayarlar'dan (settings tablosu) ya da ortam değişkeninden gelir.

const DEFAULT_MODEL = "gemini-3.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// AI yanıtları yavaş olabilir; yine de takılı kalmamak için üst sınır koyuyoruz.
const REQUEST_TIMEOUT_MS = 45_000;

export type ChatMessage = { role: "user" | "model"; text: string };

// fetch'i bir zaman aşımı ile sarmalar; süre dolarsa isteği iptal eder.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Gemini isteği zaman aşımına uğradı (${timeoutMs / 1000}sn).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getGeminiApiKey(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("gemini_api_key") as { value: string } | undefined;
  return (row?.value || process.env.GEMINI_API_KEY || "").trim();
}

export function getGeminiModel(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("gemini_model") as { value: string } | undefined;
  return (row?.value || process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
}

export function isGeminiConfigured(): boolean {
  return getGeminiApiKey().length > 0;
}

export async function askGemini(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      "Gemini API anahtarı tanımlı değil. Ayarlar > Yapay Zeka bölümünden anahtarı girin."
    );
  }

  const model = getGeminiModel();
  const url = `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    generationConfig: {
      temperature: 0.4,
      // "Düşünme" (thinking) tokenları da OUTPUT olarak faturalandırılır ve çok
      // değişkendir; kapatıp çıktıyı sınırlayarak maliyeti öngörülebilir tutuyoruz.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 800,
    },
  };

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Gemini isteği başarısız (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p?.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini boş cevap döndürdü.");
  }

  return text;
}

export type GroundingSource = { title: string; url: string };

// Gemini'ye Google Arama (grounding) aracıyla güncel web'i kendisi araştırtır.
// Düz metin + kaynak listesi döner. NOT: grounding ile responseMimeType=json
// AYNI ANDA kullanılamaz; JSON gerekiyorsa metin içinden ayrıştırılmalıdır.
export async function askGeminiGrounded(
  systemPrompt: string,
  userText: string
): Promise<{ text: string; sources: GroundingSource[] }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API anahtarı tanımlı değil.");
  }

  const model = getGeminiModel();
  const url = `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.3,
      // "Düşünme" tokenları da OUTPUT olarak faturalandırılır; kapatıp çıktıyı
      // sınırlıyoruz. Grounding metni için yine de biraz daha geniş tutuluyor.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2000,
    },
  };

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Gemini isteği başarısız (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text: string = (cand?.content?.parts ?? [])
    .map((p: { text?: string }) => p?.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini boş cevap döndürdü.");

  // Grounding kaynaklarını (varsa) topla.
  const chunks: { web?: { title?: string; uri?: string } }[] =
    cand?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const c of chunks) {
    const title = c?.web?.title || "";
    const uri = c?.web?.uri || "";
    if (!title || seen.has(title)) continue;
    seen.add(title);
    sources.push({ title, url: uri });
  }

  return { text, sources };
}
