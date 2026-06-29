export interface UyumsoftSettings {
  serviceUrl: string;
  username: string;
  password: string;
  vknTckn?: string;
}

export interface UyumsoftTestResult {
  success: boolean;
  message: string;
  rawResponse?: string;
}

export interface UyumsoftDraftResult {
  success: boolean;
  message: string;
  drafts: {
    id: string;
    number: string;
    scenario: string;
  }[];
  rawResponse?: string;
}

export interface UyumsoftEInvoiceUserResult {
  ok: boolean;
  registered: boolean;
  message: string;
  rawResponse?: string;
}

export interface EInvoiceRouting {
  taxNumber: string;
  scheme: "VKN" | "TCKN";
  isEInvoice: boolean;
  via: "vkn" | "tckn" | "none";
  checked: boolean;
}

const DEFAULT_UYUMSOFT_SERVICE_URL =
  "https://efatura.uyumsoft.com.tr/Services/Integration";

export function getDefaultUyumsoftServiceUrl() {
  return DEFAULT_UYUMSOFT_SERVICE_URL;
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeServiceUrl(serviceUrl: string) {
  const trimmed = serviceUrl.trim();
  return trimmed || DEFAULT_UYUMSOFT_SERVICE_URL;
}

function getTagAttribute(xml: string, tagName: string, attribute: string) {
  const match = xml.match(new RegExp(`<[^>]*${tagName}[^>]*\\s${attribute}="([^"]*)"`, "i"));
  return match?.[1] || "";
}

function getSoapFault(xml: string) {
  const reason =
    xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1] ||
    xml.match(/<[^>]*Text[^>]*>([\s\S]*?)<\/[^>]*Text>/i)?.[1] ||
    "";

  return reason.replace(/<[^>]+>/g, "").trim();
}

function getResponseAttribute(xml: string, resultTag: string, attribute: string) {
  const match = xml.match(
    new RegExp(`<[^>]*${resultTag}[^>]*\\s${attribute}="([^"]*)"`, "i")
  );
  return match?.[1] || "";
}

// Uyumsoft yanıtlarında bayrak alanları kimi metotta öznitelik (IsSucceded="true"),
// kimi metotta alt eleman (<Value>true</Value>, ad alanı önekiyle gelebilir) olarak
// dönüyor. Her iki biçimi de okuyup boş string ile "yok" durumunu ayırt ediyoruz.
function readResultFlag(xml: string, resultTag: string, field: string) {
  const attr = getResponseAttribute(xml, resultTag, field);
  if (attr) return attr.trim();

  const element = xml.match(
    new RegExp(`<(?:\\w+:)?${field}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${field}>`, "i")
  );
  return element?.[1]?.trim() || "";
}

function getDraftIdentities(xml: string) {
  return Array.from(xml.matchAll(/<[^>]*Value\b([^>]*)\/?>/gi)).map((match) => {
    const attrs = match[1] || "";
    const getAttr = (name: string) =>
      attrs.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] || "";

    return {
      id: getAttr("Id"),
      number: getAttr("Number"),
      scenario: getAttr("InvoiceScenario"),
    };
  });
}

function buildSaveAsDraftEnvelope(
  username: string,
  password: string,
  invoiceInfoXml: string
) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <o:UsernameToken u:Id="UsernameToken-1">
        <o:Username>${escapeXml(username)}</o:Username>
        <o:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</o:Password>
      </o:UsernameToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <SaveAsDraft xmlns="http://tempuri.org/">
      <invoices>
${invoiceInfoXml}
      </invoices>
    </SaveAsDraft>
  </s:Body>
</s:Envelope>`;
}

function buildIsEInvoiceUserEnvelope(
  username: string,
  password: string,
  vknTckn: string
) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <o:UsernameToken u:Id="UsernameToken-1">
        <o:Username>${escapeXml(username)}</o:Username>
        <o:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</o:Password>
      </o:UsernameToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <IsEInvoiceUser xmlns="http://tempuri.org/">
      <vknTckn>${escapeXml(vknTckn)}</vknTckn>
      <alias></alias>
    </IsEInvoiceUser>
  </s:Body>
</s:Envelope>`;
}

function buildTestConnectionEnvelope(username: string, password: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <o:UsernameToken u:Id="UsernameToken-1">
        <o:Username>${escapeXml(username)}</o:Username>
        <o:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</o:Password>
      </o:UsernameToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <TestConnection xmlns="http://tempuri.org/" />
  </s:Body>
</s:Envelope>`;
}

async function sendSoapRequest(
  settings: UyumsoftSettings,
  soapAction: string,
  body: string
) {
  const serviceUrl = normalizeServiceUrl(settings.serviceUrl);

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: soapAction,
    },
    body,
    cache: "no-store",
  });

  const rawResponse = await res.text();
  return { ok: res.ok, status: res.status, rawResponse };
}

export async function testUyumsoftConnection(
  settings: UyumsoftSettings
): Promise<UyumsoftTestResult> {
  const username = settings.username.trim();
  const password = settings.password;

  if (!username || !password) {
    return {
      success: false,
      message: "Uyumsoft web servis kullanıcı adı ve şifre bilgisi gerekli",
    };
  }

  const { ok, status, rawResponse } = await sendSoapRequest(
    settings,
    "http://tempuri.org/IIntegration/TestConnection",
    buildTestConnectionEnvelope(username, password)
  );
  const fault = getSoapFault(rawResponse);

  if (!ok || fault) {
    return {
      success: false,
      message: fault || `Uyumsoft bağlantı testi başarısız oldu (${status})`,
      rawResponse,
    };
  }

  const succeeded = getTagAttribute(rawResponse, "TestConnectionResult", "IsSucceded");
  const message = getTagAttribute(rawResponse, "TestConnectionResult", "Message");

  return {
    success: succeeded.toLowerCase() === "true",
    message:
      message ||
      (succeeded.toLowerCase() === "true"
        ? "Uyumsoft web servis bağlantısı başarılı"
        : "Uyumsoft web servis bağlantısı doğrulanamadı"),
    rawResponse,
  };
}

export async function saveUyumsoftDrafts(
  settings: UyumsoftSettings,
  invoiceInfoXml: string
): Promise<UyumsoftDraftResult> {
  const username = settings.username.trim();
  const password = settings.password;

  if (!username || !password) {
    return {
      success: false,
      message: "Uyumsoft web servis kullanıcı adı ve şifre bilgisi gerekli",
      drafts: [],
    };
  }

  if (!invoiceInfoXml.trim()) {
    return {
      success: false,
      message: "Taslak oluşturmak için fatura verisi gerekli",
      drafts: [],
    };
  }

  const { ok, status, rawResponse } = await sendSoapRequest(
    settings,
    "http://tempuri.org/IIntegration/SaveAsDraft",
    buildSaveAsDraftEnvelope(username, password, invoiceInfoXml)
  );
  const fault = getSoapFault(rawResponse);

  if (!ok || fault) {
    return {
      success: false,
      message: fault || `Uyumsoft taslak kaydı başarısız oldu (${status})`,
      drafts: [],
      rawResponse,
    };
  }

  const success =
    getResponseAttribute(rawResponse, "SaveAsDraftResult", "IsSucceded")
      .toLowerCase() === "true";
  const message = getResponseAttribute(rawResponse, "SaveAsDraftResult", "Message");
  const drafts = getDraftIdentities(rawResponse);

  return {
    success,
    message:
      message ||
      (success
        ? `${drafts.length} Uyumsoft taslağı oluşturuldu`
        : "Uyumsoft taslak kaydı doğrulanamadı"),
    drafts,
    rawResponse,
  };
}

// Verilen VKN/TCKN'nin GİB e-fatura kayıtlı kullanıcısı olup olmadığını sorgular.
// E-Fatura mı E-Arşiv mi kararının tek doğru kaynağı budur; profil seçimi değil.
export async function checkEInvoiceUser(
  settings: UyumsoftSettings,
  vknTckn: string
): Promise<UyumsoftEInvoiceUserResult> {
  const number = (vknTckn || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(number)) {
    return { ok: false, registered: false, message: "Geçersiz VKN/TCKN" };
  }

  const username = settings.username.trim();
  const password = settings.password;
  if (!username || !password) {
    return {
      ok: false,
      registered: false,
      message: "Uyumsoft web servis kullanıcı adı ve şifre bilgisi gerekli",
    };
  }

  const { ok, status, rawResponse } = await sendSoapRequest(
    settings,
    "http://tempuri.org/IIntegration/IsEInvoiceUser",
    buildIsEInvoiceUserEnvelope(username, password, number)
  );
  const fault = getSoapFault(rawResponse);

  if (!ok || fault) {
    return {
      ok: false,
      registered: false,
      message: fault || `Uyumsoft mükellef sorgusu başarısız oldu (${status})`,
      rawResponse,
    };
  }

  const succeeded =
    readResultFlag(rawResponse, "IsEInvoiceUserResult", "IsSucceded").toLowerCase() ===
    "true";
  const valueRaw = readResultFlag(rawResponse, "IsEInvoiceUserResult", "Value");
  const message = readResultFlag(rawResponse, "IsEInvoiceUserResult", "Message");

  // Value alanı varsa onu kullan; yanıt sadece IsSucceded ile dönüyorsa ona düş.
  const registered = succeeded && (valueRaw ? valueRaw.toLowerCase() === "true" : true);

  return { ok: succeeded, registered, message, rawResponse };
}

// VKN ve TCKN'nin ikisi de gelebildiği için sırayla sorgular:
// önce VKN kayıtlı mı, değilse TCKN kayıtlı mı. Kayıtlı olan numarayla
// E-Fatura, ikisi de değilse mevcut numarayla E-Arşiv yönlendirmesi döner.
export async function resolveEInvoiceRouting(
  settings: UyumsoftSettings,
  pair: { vkn?: string; tckn?: string },
  cache?: Map<string, UyumsoftEInvoiceUserResult>
): Promise<EInvoiceRouting> {
  const vkn = (pair.vkn || "").replace(/\D/g, "");
  const tckn = (pair.tckn || "").replace(/\D/g, "");

  const lookup = async (number: string) => {
    if (cache?.has(number)) return cache.get(number)!;
    const result = await checkEInvoiceUser(settings, number);
    cache?.set(number, result);
    return result;
  };

  let checked = false;

  if (/^\d{10}$/.test(vkn)) {
    const result = await lookup(vkn);
    checked = checked || result.ok;
    if (result.registered) {
      return { taxNumber: vkn, scheme: "VKN", isEInvoice: true, via: "vkn", checked: true };
    }
  }

  if (/^\d{11}$/.test(tckn)) {
    const result = await lookup(tckn);
    checked = checked || result.ok;
    if (result.registered) {
      return { taxNumber: tckn, scheme: "TCKN", isEInvoice: true, via: "tckn", checked: true };
    }
  }

  const fallback = vkn || tckn;
  return {
    taxNumber: fallback,
    scheme: fallback.length === 11 ? "TCKN" : "VKN",
    isEInvoice: false,
    via: "none",
    checked,
  };
}
