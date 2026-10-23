import "server-only";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { categories, products } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { badRequest, conflict, notFound } from "@/server/api/errors";
import { slugify } from "@/lib/slug";
import { writeAudit } from "./audit.service";

const MAX_DEPTH = 3;

/** Kategori jumlahnya kecil: kembalikan semua (flat) + jumlah produk, client menyusun pohon. 2 query. */
export async function listCategories() {
  const [rows, counts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({ categoryId: products.categoryId, total: count() }).from(products).groupBy(products.categoryId),
  ]);
  const byId = new Map(counts.map((c) => [c.categoryId, c.total]));
  return rows.map((r) => ({ ...r, productCount: byId.get(r.id) ?? 0 }));
}

async function depthOf(parentId: string | null): Promise<number> {
  if (!parentId) return 0;
  // Pohon maks 3 level, jadi paling banyak 3 lookup — dan tiap lookup memakai PK.
  let depth = 0;
  let current: string | null = parentId;
  while (current) {
    depth++;
    if (depth > MAX_DEPTH) break;
    const [row] = await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, current));
    if (!row) throw notFound("Kategori induk");
    current = row.parentId;
  }
  return depth;
}

export async function createCategory(actor: Actor, input: { name: string; parentId?: string | null; sortOrder?: number }) {
  if ((await depthOf(input.parentId ?? null)) >= MAX_DEPTH) {
    throw badRequest("CATEGORY_TOO_DEEP", `Kategori maksimal ${MAX_DEPTH} tingkat.`);
  }
  const [row] = await db
    .insert(categories)
    .values({ name: input.name, slug: slugify(input.name), parentId: input.parentId ?? null, sortOrder: input.sortOrder ?? 0 })
    .returning();
  await writeAudit(actor, { action: "create", entity: "category", entityId: row.id, after: row });
  return row;
}

export async function updateCategory(
  actor: Actor,
  id: string,
  input: { name?: string; parentId?: string | null; sortOrder?: number },
) {
  const [before] = await db.select().from(categories).where(eq(categories.id, id));
  if (!before) throw notFound("Kategori");
  if (input.parentId === id) throw badRequest("CATEGORY_CYCLE", "Kategori tidak bisa menjadi induk dirinya sendiri.");
  if (input.parentId !== undefined && (await depthOf(input.parentId)) >= MAX_DEPTH) {
    throw badRequest("CATEGORY_TOO_DEEP", `Kategori maksimal ${MAX_DEPTH} tingkat.`);
  }
  const [row] = await db
    .update(categories)
    .set({ ...input, slug: input.name ? slugify(input.name) : undefined })
    .where(eq(categories.id, id))
    .returning();
  await writeAudit(actor, { action: "update", entity: "category", entityId: id, before, after: row });
  return row;
}

export async function deleteCategory(actor: Actor, id: string) {
  const [[child], [product]] = await Promise.all([
    db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1),
    db.select({ id: products.id }).from(products).where(eq(products.categoryId, id)).limit(1),
  ]);
  if (child) throw conflict("CATEGORY_HAS_CHILDREN", "Hapus atau pindahkan sub-kategori terlebih dahulu.");
  if (product) throw conflict("CATEGORY_IN_USE", "Masih ada produk di kategori ini. Pindahkan produknya dulu.");
  const [row] = await db.delete(categories).where(eq(categories.id, id)).returning();
  if (!row) throw notFound("Kategori");
  await writeAudit(actor, { action: "delete", entity: "category", entityId: id, before: row });
}
