/**
 * Client API untuk komponen client. Semua data aplikasi lewat /api/v1 (lihat docs/ARCHITECTURE.md §2).
 */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(query?: Query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function api<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { query?: Query; body?: unknown } = {},
): Promise<T> {
  const { query, body, headers, ...rest } = init;
  const res = await fetch(`/api/v1${path}${buildQuery(query)}`, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiClientError(
      res.status,
      payload?.error?.code ?? "UNKNOWN",
      payload?.error?.message ?? "Terjadi kesalahan. Coba lagi.",
      payload?.error?.details,
    );
  }
  return payload as T;
}
