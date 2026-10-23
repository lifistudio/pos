import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error bisnis dengan kode stabil. UI memetakan `code` ke pesan; `message` sudah ramah pengguna (Bahasa Indonesia).
 */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHENTICATED", "Sesi berakhir. Silakan masuk lagi.");
export const forbidden = (permission?: string) =>
  new ApiError(403, "FORBIDDEN", "Anda tidak punya akses untuk tindakan ini.", permission ? { permission } : undefined);
export const notFound = (entity: string) => new ApiError(404, "NOT_FOUND", `${entity} tidak ditemukan.`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
