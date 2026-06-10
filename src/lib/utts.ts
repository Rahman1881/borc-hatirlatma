const UTTS_API_BASE_URL = "https://api.utts.gov.tr";

export interface UttsCredentials {
  email: string;
  password: string;
}

export interface UttsLoginResponse {
  tokenType?: string;
  accessToken: string;
  expiresIn?: number;
  refreshToken?: string;
  succeeded?: boolean;
  errors?: unknown;
  code?: number;
  user?: {
    id?: string;
    email?: string;
    emailConfirmed?: boolean;
    phoneNumberConfirmed?: boolean;
    phoneNumber?: string | number;
  };
}

export interface UttsInstallationQuery {
  pageNumber?: number;
  pageSize?: number;
  installationCode?: string;
  licensePlate?: string;
  startActivationDate?: string;
  endActivationDate?: string;
  referenceNumber?: string;
  vehicleOrderInstallationStatus?: string;
}

export class UttsApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "UttsApiError";
    this.status = status;
    this.details = details;
  }
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (typeof record.errors === "string") return record.errors;
    if (Array.isArray(record.errors)) return record.errors.join(", ");
    if (record.errors && typeof record.errors === "object") {
      const messages = Object.entries(record.errors as Record<string, unknown>)
        .flatMap(([field, value]) => {
          if (Array.isArray(value)) {
            return value.map((item) => `${field}: ${String(item)}`);
          }
          return [`${field}: ${String(value)}`];
        })
        .filter(Boolean);
      if (messages.length > 0) return messages.join(" ");
    }
    if (typeof record.title === "string") return record.title;
  }
  return fallback;
}

function extractLoginData(payload: unknown): UttsLoginResponse {
  if (!payload || typeof payload !== "object") {
    throw new UttsApiError("UTTS giriş cevabı okunamadı", 400, payload);
  }

  const record = payload as Record<string, unknown>;
  if (record.succeeded === false) {
    throw new UttsApiError(
      getErrorMessage(record, "UTTS giriş bilgileri doğrulanamadı"),
      400,
      payload
    );
  }

  const item = record.item;
  const data =
    item && typeof item === "object"
      ? ({
          ...(item as Record<string, unknown>),
          succeeded: record.succeeded,
        } as unknown as UttsLoginResponse)
      : (record as unknown as UttsLoginResponse);

  if (!data.accessToken) {
    throw new UttsApiError(
      getErrorMessage(payload, "UTTS access token cevabı alınamadı"),
      400,
      payload
    );
  }

  return data;
}

export async function loginUtts(
  credentials: UttsCredentials
): Promise<UttsLoginResponse> {
  const res = await fetch(`${UTTS_API_BASE_URL}/users/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });

  const payload = await readJsonResponse(res);

  if (!res.ok) {
    throw new UttsApiError(
      getErrorMessage(payload, "UTTS giriş isteği başarısız oldu"),
      res.status,
      payload
    );
  }

  return extractLoginData(payload);
}

export async function fetchUttsInstallations(
  accessToken: string,
  query: UttsInstallationQuery
): Promise<unknown> {
  const params = new URLSearchParams();
  const pageNumber = Math.max(1, query.pageNumber || 1);
  const pageSize = Math.min(Math.max(1, query.pageSize || 100), 500);

  params.set("pageNumber", String(pageNumber));
  params.set("pageSize", String(pageSize));

  if (query.installationCode) {
    params.set("InstallationCode", query.installationCode);
  }
  if (query.licensePlate) {
    params.set("LicensePlate", query.licensePlate);
  }
  if (query.startActivationDate) {
    params.set("StartActivationDate", query.startActivationDate);
  }
  if (query.endActivationDate) {
    params.set("EndActivationDate", query.endActivationDate);
  }
  if (query.referenceNumber) {
    params.set("ReferenceNumber", query.referenceNumber);
  }
  if (query.vehicleOrderInstallationStatus) {
    params.set(
      "VehicleOrderInstallationStatus",
      query.vehicleOrderInstallationStatus
    );
  }

  const res = await fetch(
    `${UTTS_API_BASE_URL}/support-operations/installation-progresses?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  const payload = await readJsonResponse(res);

  if (!res.ok) {
    throw new UttsApiError(
      getErrorMessage(payload, "UTTS montaj verileri alınamadı"),
      res.status,
      payload
    );
  }

  return payload;
}
