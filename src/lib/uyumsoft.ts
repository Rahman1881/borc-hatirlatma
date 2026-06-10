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
