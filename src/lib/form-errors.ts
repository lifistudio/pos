import { ApiClientError } from "./api-client";

/** Pisahkan error API menjadi pesan umum + pesan per field (dari detail validasi Zod). */
export function readApiError(error: unknown, fallback = "Gagal menyimpan. Coba lagi.") {
  if (!(error instanceof ApiClientError)) return { message: fallback, fields: {} as Record<string, string> };
  const fields: Record<string, string> = {};
  if (Array.isArray(error.details)) {
    for (const d of error.details as { path?: string; message?: string }[]) {
      if (d?.path && d.message && !fields[d.path]) fields[d.path] = d.message;
    }
  }
  return { message: error.message, fields };
}
