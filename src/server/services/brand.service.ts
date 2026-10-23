import "server-only";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { brands, products } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { displayName, nameKey } from "@/lib/names";
import { writeAudit } from "./audit.service";

function normalize(name: string) {
  const clean = displayName(name);
  const key = nameKey(clean);
  if (clean.length < 1 || clean.length > 60) throw badRequest("INVALID_BRAND_NAME", "Nama merek 1–60 karakter.");
  if (!key) throw badRequest("INVALID_BRAND_NAME", "Nama merek harus berisi huruf atau angka.");
  return { name: clean, key };
}

async function findByKey(key: string, exceptId?: string) {
  const [row] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(exceptId ? and(eq(brands.nameKey, key), ne(brands.id, exceptId)) : eq(brands.nameKey, key));
  return row ?? null;
}

const duplicate = (existing: { id: string; name: string }) =>
  new ApiError(409, "BRAND_EXISTS", `Merek "${existing.name}" sudah ada. Gunakan merek itu agar tidak ganda.`, { brandId: existing.id, name: existing.name });

/**
 * Daftar merek + jumlah produk (1 query, agregat di SQL). Dengan `q`: cocok sebagian ATAU mirip (trigram),
 * diurutkan dari paling mirip — membantu menemukan ejaan lain sebelum membuat merek baru.
 */
export async function listBrands(params: { q?: string; page: number; pageSize: number }) {
  const q = params.q ? displayName(params.q) : "";
  const key = q ? nameKey(q) : "";
  const where = q
    ? sql`(${brands.name} ilike ${`%${q}%`} or ${brands.nameKey} like ${`%${key}%`} or similarity(${brands.name}, ${q}) > 0.35)`
    : undefined;
  const usage = db.select({ brandId: products.brandId, total: count().as("total") }).from(products).groupBy(products.brandId).as("usage");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: brands.id,
        name: brands.name,
        productCount: sql<number>`coalesce(${usage.total}, 0)::int`,
        exact: key ? sql<boolean>`${brands.nameKey} = ${key}` : sql<boolean>`false`,
        updatedAt: brands.updatedAt,
      })
      .from(brands)
      .leftJoin(usage, eq(usage.brandId, brands.id))
      .where(where)
      .orderBy(...(q ? [sql`${brands.nameKey} = ${key} desc`, sql`similarity(${brands.name}, ${q}) desc`] : []), asc(brands.name))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(brands).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

export async function createBrand(actor: Actor, input: { name: string }) {
  const { name, key } = normalize(input.name);
  const existing = await findByKey(key);
  if (existing) throw duplicate(existing);
  const [row] = await db.insert(brands).values({ name, nameKey: key }).returning();
  await writeAudit(actor, { action: "create", entity: "brand", entityId: row.id, after: row });
  return { ...row, productCount: 0 };
}

export async function updateBrand(actor: Actor, id: string, input: { name: string }) {
  const [before] = await db.select().from(brands).where(eq(brands.id, id));
  if (!before) throw notFound("Merek");
  const { name, key } = normalize(input.name);
  const existing = await findByKey(key, id);
  if (existing) throw duplicate(existing);
  const [row] = await db.update(brands).set({ name, nameKey: key, updatedAt: new Date() }).where(eq(brands.id, id)).returning();
  await writeAudit(actor, { action: "update", entity: "brand", entityId: id, before, after: row });
  return row;
}

export async function deleteBrand(actor: Actor, id: string) {
  const [[before], [{ used }]] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, id)),
    db.select({ used: count() }).from(products).where(eq(products.brandId, id)),
  ]);
  if (!before) throw notFound("Merek");
  if (used > 0) throw new ApiError(409, "BRAND_IN_USE", `Merek dipakai ${used} produk. Gabungkan ke merek lain atau ubah merek produknya dulu.`, { productCount: used });
  await db.delete(brands).where(eq(brands.id, id));
  await writeAudit(actor, { action: "delete", entity: "brand", entityId: id, before });
}

/** Gabungkan merek ganda/typo: semua produk dipindah ke `intoId`, lalu merek asal dihapus — satu transaksi. */
export async function mergeBrand(actor: Actor, id: string, intoId: string) {
  if (id === intoId) throw badRequest("SAME_BRAND", "Pilih merek tujuan yang berbeda.");
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(brands).where(sql`${brands.id} in (${id}, ${intoId})`).for("update");
    const source = rows.find((r) => r.id === id);
    const target = rows.find((r) => r.id === intoId);
    if (!source) throw notFound("Merek asal");
    if (!target) throw notFound("Merek tujuan");
    const moved = await tx.update(products).set({ brandId: intoId, updatedAt: new Date() }).where(eq(products.brandId, id)).returning({ id: products.id });
    await tx.delete(brands).where(eq(brands.id, id));
    await writeAudit(actor, { action: "merge", entity: "brand", entityId: id, before: source, after: { into: target, movedProducts: moved.length } }, tx);
    return { into: target, movedProducts: moved.length };
  });
}

/** Pastikan brandId yang dikirim produk benar-benar ada (pesan jelas, bukan error FK). */
export async function assertBrandExists(brandId: string | null | undefined) {
  if (!brandId) return;
  const [row] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
  if (!row) throw badRequest("BRAND_NOT_FOUND", "Merek tidak ditemukan. Pilih dari daftar atau buat merek baru.");
}
