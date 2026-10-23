import { z } from "@hono/zod-openapi";

export const MAX_LIMIT = 100;

/** Offset pagination untuk tabel admin yang butuh nomor halaman. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(MAX_LIMIT).default(25).openapi({ example: 25 }),
});

/** Cursor (keyset) pagination untuk data besar & append-only (audit log, stock movement). */
export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(25),
});

export const pageMeta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  pageCount: z.number(),
});

export function toPageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), id })).toString("base64url");
}

export function decodeCursor(cursor?: string): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.t === "string" && typeof parsed?.id === "string" && !Number.isNaN(Date.parse(parsed.t))) {
      return parsed;
    }
  } catch {}
  return null;
}
