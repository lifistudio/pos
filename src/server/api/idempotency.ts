import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { db } from "@/server/db";
import { idempotencyKeys } from "@/server/db/schema";
import type { AppEnv } from "./context";
import { ApiError, badRequest, conflict } from "./errors";

/** Setelah ini permintaan yang belum selesai dianggap mati dan boleh diulang. */
const IN_PROGRESS_MS = 60_000;
const RETENTION_MS = 24 * 3_600_000;

/**
 * Untuk aksi tulis tanpa kunci alami: klik ganda atau percobaan ulang jaringan tidak mengulang efeknya.
 * Hanya berlaku bila klien mengirim header `Idempotency-Key`. Hanya respons sukses yang disimpan, jadi permintaan
 * yang gagal bisa diulang dengan kunci sama. Kunci yang sama untuk isi berbeda ditolak.
 */
export const idempotent = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header("idempotency-key");
  if (!key) return next();
  if (key.length < 8 || key.length > 100) throw badRequest("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key harus 8–100 karakter.");

  const userId = c.get("actor").userId;
  const route = `${c.req.method} ${c.req.path}`;
  const requestHash = createHash("sha256").update(await c.req.text()).digest("hex");
  const mine = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key));

  const [claimed] = await db.insert(idempotencyKeys).values({ userId, key, route, requestHash }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
  if (!claimed) {
    const [row] = await db.select().from(idempotencyKeys).where(mine);
    if (!row) throw conflict("REQUEST_IN_PROGRESS", "Permintaan yang sama masih diproses.");
    if (row.route !== route || row.requestHash !== requestHash) throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Kunci ini sudah dipakai untuk permintaan lain. Muat ulang halaman lalu coba lagi.");
    if (row.responseStatus !== null) {
      c.header("Idempotent-Replayed", "true");
      return row.responseBody === null ? c.body(null, row.responseStatus as 204) : c.json(row.responseBody, row.responseStatus as ContentfulStatusCode);
    }
    if (Date.now() - row.createdAt.getTime() < IN_PROGRESS_MS) throw conflict("REQUEST_IN_PROGRESS", "Permintaan yang sama masih diproses.");
    const [taken] = await db.update(idempotencyKeys).set({ createdAt: new Date() }).where(and(mine, eq(idempotencyKeys.createdAt, row.createdAt))).returning({ key: idempotencyKeys.key });
    if (!taken) throw conflict("REQUEST_IN_PROGRESS", "Permintaan yang sama masih diproses.");
  }

  await next();

  // Error sudah diubah menjadi respons oleh app.onError, jadi status yang menentukan.
  if (c.res.status >= 200 && c.res.status < 300) {
    const responseBody = await c.res.clone().json().catch(() => null);
    await db.update(idempotencyKeys).set({ responseStatus: c.res.status, responseBody }).where(mine);
  } else {
    await db.delete(idempotencyKeys).where(mine);
  }
  if (Math.random() < 0.01) void db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - RETENTION_MS))).catch(() => null);
});
