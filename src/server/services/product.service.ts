import "server-only";
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import {
  brands,
  categories,
  inventoryLevels,
  productImages,
  productOptions,
  productOptionValues,
  products,
  productVariants,
  variantOptionValues,
} from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { badRequest, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { branchScope, can } from "@/server/rbac/access";
import { displayName, nameKey } from "@/lib/names";
import { slugify } from "@/lib/slug";
import { inCategoryTree, matchAllTerms } from "@/server/db/search";
import { writeAudit } from "./audit.service";
import { applyStockChanges } from "./inventory.service";
import { cloudinaryDestroy } from "@/server/media/cloudinary";
import { assertBrandExists } from "./brand.service";
import { resolveVariantCodes } from "./product-codes";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type VariantInput = {
  optionValues: string[];
  sku?: string | null;
  barcode?: string | null;
  price: number;
  compareAtPrice?: number | null;
  costPrice?: number | null;
  isActive?: boolean;
  initialStock?: { branchId: string; qty: number }[];
};

export type ProductInput = {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  status?: ProductStatus;
  weightGram?: number | null;
  imageUrl?: string | null;
  options: { name: string; values: string[] }[];
  variants: VariantInput[];
};

/** Total stok per produk dihitung di SQL, hanya dari cabang yang boleh dilihat actor. */
function stockSubquery(actor: Actor) {
  const scope = branchScope(actor.access, "inventory:read");
  const scopeWhere = scope === "ALL" ? undefined : scope.length ? inArray(inventoryLevels.branchId, scope) : sql`false`;
  return db
    .select({
      productId: productVariants.productId,
      onHand: sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int`.as("on_hand"),
    })
    .from(inventoryLevels)
    .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
    .where(scopeWhere)
    .groupBy(productVariants.productId)
    .as("stock");
}

const variantAgg = db
  .select({
    productId: productVariants.productId,
    variantCount: sql<number>`count(*)::int`.as("variant_count"),
    minPrice: sql<number>`min(${productVariants.price})::bigint`.mapWith(Number).as("min_price"),
    maxPrice: sql<number>`max(${productVariants.price})::bigint`.mapWith(Number).as("max_price"),
  })
  .from(productVariants)
  .groupBy(productVariants.productId)
  .as("variant_agg");

/** List produk: 2 query (halaman + total) dengan agregat varian & stok via join, bukan per baris. */
export async function listProducts(
  actor: Actor,
  params: { q?: string; status?: ProductStatus; categoryId?: string; brandId?: string; page: number; pageSize: number },
) {
  const filters: SQL[] = [];
  if (params.status) filters.push(eq(products.status, params.status));
  else filters.push(sql`${products.status} <> 'ARCHIVED'`);
  if (params.categoryId) filters.push(inCategoryTree(products.categoryId, params.categoryId));
  if (params.brandId) filters.push(eq(products.brandId, params.brandId));
  if (params.q) {
    // Cocok bila semua kata ada di nama produk/merek, atau ada varian yang SKU/barcode-nya cocok.
    filters.push(
      or(
        matchAllTerms(params.q, [products.name, brands.name]),
        exists(
          db
            .select({ one: sql`1` })
            .from(productVariants)
            .where(
              and(
                eq(productVariants.productId, products.id),
                or(ilike(productVariants.sku, `%${params.q}%`), eq(productVariants.barcode, params.q)),
              ),
            ),
        ),
      )!,
    );
  }
  const where = and(...filters);
  const stock = stockSubquery(actor);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
        brand: brands.name,
        brandId: products.brandId,
        imageUrl: products.imageUrl,
        hasVariants: products.hasVariants,
        categoryId: products.categoryId,
        categoryName: categories.name,
        variantCount: variantAgg.variantCount,
        minPrice: variantAgg.minPrice,
        maxPrice: variantAgg.maxPrice,
        stockOnHand: sql<number>`coalesce(${stock.onHand}, 0)`,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(variantAgg, eq(variantAgg.productId, products.id))
      .leftJoin(stock, eq(stock.productId, products.id))
      .where(where)
      .orderBy(desc(products.updatedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(products).leftJoin(brands, eq(brands.id, products.brandId)).where(where),
  ]);

  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

/** Detail lengkap dalam satu relational query (Drizzle menyusun JSON lateral join). */
export async function getProduct(actor: Actor, id: string) {
  const scope = branchScope(actor.access, "inventory:read");
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      category: { columns: { id: true, name: true } },
      brand: { columns: { id: true, name: true } },
      options: {
        orderBy: asc(productOptions.position),
        with: { values: { orderBy: asc(productOptionValues.position) } },
      },
      variants: {
        orderBy: [asc(productVariants.createdAt), asc(productVariants.id)],
        with: {
          optionValues: { columns: { optionValueId: true } },
          inventory: {
            where: scope === "ALL" ? undefined : scope.length ? inArray(inventoryLevels.branchId, scope) : sql`false`,
            with: { branch: { columns: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  });
  if (!product) throw notFound("Produk");

  const showCost = can(actor.access, "product:view_cost");
  return {
    ...product,
    variants: product.variants.map(({ costPrice, optionValues, inventory, ...v }) => ({
      ...v,
      costPrice: showCost ? costPrice : undefined,
      optionValueIds: optionValues.map((o) => o.optionValueId),
      inventory: inventory.map((i) => ({
        branchId: i.branchId,
        branchName: i.branch.name,
        branchCode: i.branch.code,
        onHand: i.onHand,
        reserved: i.reserved,
        reorderPoint: i.reorderPoint,
      })),
    })),
  };
}

/** Rapikan nama variasi & nilainya, lalu tolak duplikat (tanpa beda kapital/spasi) — berlaku juga untuk klien API luar. */
function normalizeOptions(input: ProductInput) {
  const names = new Set<string>();
  input.options = input.options.map((o) => {
    const name = displayName(o.name);
    if (!name) throw badRequest("INVALID_OPTION", "Nama variasi wajib diisi.");
    if (names.has(nameKey(name))) throw badRequest("DUPLICATE_OPTION", `Variasi "${name}" ditulis lebih dari sekali.`);
    names.add(nameKey(name));
    const seen = new Set<string>();
    const values = o.values.map((v) => {
      const value = displayName(v);
      if (!value) throw badRequest("INVALID_OPTION_VALUE", `Nilai variasi ${name} tidak boleh kosong.`);
      if (seen.has(value.toLowerCase())) throw badRequest("DUPLICATE_OPTION_VALUE", `Nilai "${value}" muncul dua kali di variasi ${name}.`);
      seen.add(value.toLowerCase());
      return value;
    });
    return { name, values };
  });
  input.variants = input.variants.map((v) => ({ ...v, optionValues: v.optionValues.map(displayName) }));
}

/**
 * Nama variasi yang sudah dipakai (ejaan terbanyak per kunci) — untuk saran di form dan untuk menyeragamkan:
 * produk baru dengan "warna"/"WARNA" memakai ejaan yang sudah ada, mis. "Warna".
 */
export async function listOptionNames(q?: string) {
  const rows = await db.execute<{ name: string; uses: number }>(sql`
    select distinct on (k) name, uses from (
      select ${productOptions.name} as name, lower(regexp_replace(${productOptions.name}, '[^[:alnum:]]', '', 'g')) as k, count(*)::int as uses
      from ${productOptions} group by 1, 2
    ) t
    ${q ? sql`where k like ${`%${nameKey(q)}%`}` : sql``}
    order by k, uses desc, name
    limit 50`);
  return [...rows].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

async function canonicalOptionNames(input: ProductInput) {
  if (!input.options.length) return;
  const known = new Map((await listOptionNames()).map((r) => [nameKey(r.name), r.name]));
  input.options = input.options.map((o) => ({ ...o, name: known.get(nameKey(o.name)) ?? o.name }));
}

async function assertCategoryExists(categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId));
  if (!row) throw badRequest("CATEGORY_NOT_FOUND", "Kategori tidak ditemukan.");
}

function validateStructure(input: ProductInput) {
  normalizeOptions(input);
  input.variants.forEach((v, i) => {
    if (v.compareAtPrice != null && v.compareAtPrice <= v.price) {
      throw badRequest("INVALID_COMPARE_PRICE", `Varian ke-${i + 1}: harga coret harus lebih tinggi dari harga jual.`);
    }
  });
  if (input.options.length > 3) throw badRequest("TOO_MANY_OPTIONS", "Maksimal 3 jenis variasi per produk.");
  if (input.options.length === 0 && input.variants.length !== 1) {
    throw badRequest("INVALID_VARIANTS", "Produk tanpa variasi harus punya tepat 1 varian.");
  }
  const seen = new Set<string>();
  for (const v of input.variants) {
    if (v.optionValues.length !== input.options.length) {
      throw badRequest("INVALID_VARIANTS", "Setiap varian harus memilih satu nilai untuk tiap variasi.");
    }
    v.optionValues.forEach((value, i) => {
      if (!input.options[i].values.includes(value)) {
        throw badRequest("INVALID_VARIANTS", `Nilai "${value}" tidak ada di variasi ${input.options[i].name}.`);
      }
    });
    const k = v.optionValues.join("\u0000").toLowerCase();
    if (seen.has(k)) throw badRequest("DUPLICATE_VARIANT", `Kombinasi ${v.optionValues.join(" / ")} muncul dua kali.`);
    seen.add(k);
  }
}

export async function createProduct(actor: Actor, input: ProductInput) {
  input = { ...input, name: displayName(input.name) };
  validateStructure(input);
  await Promise.all([assertCategoryExists(input.categoryId), assertBrandExists(input.brandId), canonicalOptionNames(input)]);
  const hasStock = input.variants.some((v) => v.initialStock?.some((s) => s.qty > 0));
  if (hasStock) {
    for (const v of input.variants)
      for (const s of v.initialStock ?? [])
        if (s.qty > 0 && !can(actor.access, "inventory:adjust", s.branchId)) {
          throw badRequest("STOCK_FORBIDDEN", "Anda tidak punya akses mengisi stok awal di salah satu cabang.");
        }
  }

  const productId = await db.transaction(async (tx) => {
    const baseSlug = slugify(input.name) || "produk";
    const [taken] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, baseSlug)).limit(1);
    const [product] = await tx
      .insert(products)
      .values({
        name: input.name,
        slug: taken ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug,
        description: input.description,
        categoryId: input.categoryId,
        brandId: input.brandId ?? null,
        status: input.status ?? "DRAFT",
        weightGram: input.weightGram,
        imageUrl: input.imageUrl,
        hasVariants: input.options.length > 0,
      })
      .returning({ id: products.id });

    // Opsi & nilai: insert batch, lalu petakan "indexOpsi:nilai" → id.
    const valueIds = new Map<string, string>();
    if (input.options.length) {
      const optionRows = await tx
        .insert(productOptions)
        .values(input.options.map((o, position) => ({ productId: product.id, name: o.name, position })))
        .returning({ id: productOptions.id, position: productOptions.position });
      const optionIdByPos = new Map(optionRows.map((o) => [o.position, o.id]));
      const valueRows = await tx
        .insert(productOptionValues)
        .values(
          input.options.flatMap((o, pos) =>
            o.values.map((value, position) => ({ optionId: optionIdByPos.get(pos)!, value, position })),
          ),
        )
        .returning({ id: productOptionValues.id, optionId: productOptionValues.optionId, value: productOptionValues.value });
      const posByOptionId = new Map(optionRows.map((o) => [o.id, o.position]));
      for (const v of valueRows) valueIds.set(`${posByOptionId.get(v.optionId)}:${v.value}`, v.id);
    }

    // SKU & barcode: manual divalidasi unik (termasuk silang SKU↔barcode), kosong dibuat otomatis (product-codes.ts).
    const codes = await resolveVariantCodes(tx, input.name, input.variants);
    const variantRows = await tx
      .insert(productVariants)
      .values(
        input.variants.map((v, i) => ({
          productId: product.id,
          sku: codes[i].sku!,
          barcode: codes[i].barcode,
          title: v.optionValues.length ? v.optionValues.join(" / ") : "Default",
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          costPrice: v.costPrice,
          isActive: v.isActive ?? true,
        })),
      )
      .returning({ id: productVariants.id });

    const links = input.variants.flatMap((v, i) =>
      v.optionValues.map((value, pos) => ({ variantId: variantRows[i].id, optionValueId: valueIds.get(`${pos}:${value}`)! })),
    );
    if (links.length) await tx.insert(variantOptionValues).values(links);

    const stock = input.variants.flatMap((v, i) =>
      (v.initialStock ?? [])
        .filter((s) => s.qty > 0)
        .map((s) => ({
          branchId: s.branchId,
          variantId: variantRows[i].id,
          qtyChange: s.qty,
          type: "INITIAL" as const,
          reason: "Stok awal produk baru",
          referenceType: "product",
          referenceId: product.id,
        })),
    );
    await applyStockChanges(tx, actor, stock);

    await writeAudit(actor, { action: "create", entity: "product", entityId: product.id, after: input }, tx);
    return product.id;
  });

  return getProduct(actor, productId);
}

export async function updateProduct(
  actor: Actor,
  id: string,
  input: Partial<Omit<ProductInput, "options" | "variants">>,
) {
  const [before] = await db.select().from(products).where(eq(products.id, id));
  if (!before) throw notFound("Produk");
  if (input.name !== undefined) input = { ...input, name: displayName(input.name) };
  await Promise.all([assertCategoryExists(input.categoryId), assertBrandExists(input.brandId)]);
  const [oldImage] =
    input.imageUrl !== undefined
      ? await db.select({ provider: productImages.provider, externalId: productImages.externalId }).from(productImages).where(eq(productImages.productId, id))
      : [];
  await db.transaction(async (tx) => {
    // imageUrl diisi manual (URL eksternal / null) → thumbnail unggahan lama tidak dipakai lagi.
    if (input.imageUrl !== undefined) await tx.delete(productImages).where(eq(productImages.productId, id));
    await tx
      .update(products)
      .set({
        ...input,
        archivedAt: input.status === "ARCHIVED" ? new Date() : input.status ? null : undefined,
      })
      .where(eq(products.id, id));
    await writeAudit(actor, { action: "update", entity: "product", entityId: id, before, after: input }, tx);
  });
  if (oldImage?.provider === "cloudinary" && oldImage.externalId) {
    await cloudinaryDestroy(oldImage.externalId).catch((e) => console.error("[media] gagal hapus aset lama", e));
  }
  return getProduct(actor, id);
}

export async function updateVariant(
  actor: Actor,
  variantId: string,
  input: {
    sku?: string;
    barcode?: string | null;
    /** true = ganti dengan SKU/barcode otomatis baru. */
    generateSku?: boolean;
    generateBarcode?: boolean;
    price?: number;
    compareAtPrice?: number | null;
    costPrice?: number | null;
    isActive?: boolean;
  },
) {
  if (input.compareAtPrice != null) {
    const [cur] = await db.select({ price: productVariants.price }).from(productVariants).where(eq(productVariants.id, variantId));
    if (cur && input.compareAtPrice <= (input.price ?? cur.price)) throw badRequest("INVALID_COMPARE_PRICE", "Harga coret harus lebih tinggi dari harga jual.");
  }
  if (input.costPrice !== undefined && !can(actor.access, "product:view_cost")) {
    throw badRequest("COST_FORBIDDEN", "Anda tidak punya akses mengubah harga modal.");
  }
  const [before] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  if (!before) throw notFound("Varian");
  const { generateSku, generateBarcode, sku, barcode, ...rest } = input;
  await db.transaction(async (tx) => {
    const set: Partial<typeof productVariants.$inferInsert> = { ...rest };
    const skuChanged = !!generateSku || (sku !== undefined && sku.trim().toUpperCase() !== before.sku.toUpperCase());
    // barcode null/kosong = hapus barcode (diizinkan, misal produk tanpa barcode).
    const barcodeCleared = !generateBarcode && barcode !== undefined && !barcode?.trim();
    const barcodeChanged = !!generateBarcode || (!barcodeCleared && barcode != null && barcode.replace(/\s+/g, "") !== before.barcode);
    if (skuChanged || barcodeChanged) {
      const [product] = await tx.select({ name: products.name }).from(products).where(eq(products.id, before.productId));
      const [resolved] = await resolveVariantCodes(
        tx,
        product.name,
        [
          {
            sku: !skuChanged ? false : generateSku ? null : sku,
            barcode: !barcodeChanged ? false : generateBarcode ? null : barcode,
            optionValues: before.title === "Default" ? [] : before.title.split(" / "),
          },
        ],
        { excludeVariantId: variantId },
      );
      if (skuChanged) set.sku = resolved.sku!;
      if (barcodeChanged) set.barcode = resolved.barcode;
    }
    if (barcodeCleared) set.barcode = null;
    await tx.update(productVariants).set(set).where(eq(productVariants.id, variantId));
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, before.productId));
    await writeAudit(actor, { action: "update", entity: "product_variant", entityId: variantId, before, after: set }, tx);
  });
  return getProduct(actor, before.productId);
}

/** Cari varian untuk input cepat (scan barcode / ketik SKU / nama). Exact match barcode & SKU diurutkan teratas. */
export async function searchVariants(params: { q: string; limit: number; includeInactive?: boolean }) {
  return db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      title: productVariants.title,
      price: productVariants.price,
      isActive: productVariants.isActive,
      productId: products.id,
      productName: products.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        params.includeInactive ? undefined : eq(productVariants.isActive, true),
        sql`${products.status} <> 'ARCHIVED'`,
        or(
          eq(productVariants.barcode, params.q),
          ilike(productVariants.sku, `%${params.q}%`),
          matchAllTerms(params.q, [products.name, productVariants.title, productVariants.sku]),
        ),
      ),
    )
    .orderBy(
      sql`case when ${productVariants.barcode} = ${params.q} or upper(${productVariants.sku}) = upper(${params.q}) then 0 else 1 end`,
      asc(products.name),
      asc(productVariants.sku),
    )
    .limit(params.limit);
}
