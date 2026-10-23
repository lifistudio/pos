import { z } from "@hono/zod-openapi";

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "FORBIDDEN" }),
      message: z.string().openapi({ example: "Anda tidak punya akses untuk tindakan ini." }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export const idParam = z.object({ id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }) });
export const userIdParam = z.object({ id: z.string().min(1).openapi({ param: { name: "id", in: "path" } }) });

export const money = z.number().int().min(0).max(1_000_000_000_000).openapi({ description: "Rupiah (integer)", example: 149000 });

/** Respons error standar yang dipakai hampir semua route. */
export const errorResponses = {
  400: { description: "Input tidak valid", content: { "application/json": { schema: errorSchema } } },
  401: { description: "Belum login / API key tidak valid", content: { "application/json": { schema: errorSchema } } },
  403: { description: "Tidak punya permission", content: { "application/json": { schema: errorSchema } } },
  404: { description: "Data tidak ditemukan", content: { "application/json": { schema: errorSchema } } },
  409: { description: "Konflik data (duplikat, stok tidak cukup, dll.)", content: { "application/json": { schema: errorSchema } } },
} as const;

export const json = <T extends z.ZodType>(schema: T, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});

export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

/** `{ data: T }` */
export const dataOf = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

/** Tipe hasil serialisasi JSON: Date → string (ISO), rekursif. */
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

/** Ubah semua Date menjadi string ISO agar cocok dengan schema OpenAPI (`z.string()`). */
export function serialize<T>(value: T): Serialized<T> {
  if (value instanceof Date) return value.toISOString() as Serialized<T>;
  if (Array.isArray(value)) return value.map(serialize) as Serialized<T>;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)])) as Serialized<T>;
  }
  return value as Serialized<T>;
}
