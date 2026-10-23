import "server-only";
import { and, count, desc, eq, gt, inArray, notExists, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, inventoryLevels, products, productVariants, stockOpnameItems, stockOpnames, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { branchScope, can } from "@/server/rbac/access";
import { writeAudit } from "./audit.service";
import { applyStockChanges } from "./inventory.service";
import { nextDocNumber } from "./numbering";

type Status = (typeof stockOpnames.$inferSelect)["status"];

async function loadOpname(id: string) {
  const [o] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, id));
  if (!o) throw notFound("Stok opname");
  return o;
}

export async function listOpnames(actor: Actor, params: { branchId?: string; status?: Status; page: number; pageSize: number }) {
  const scope = branchScope(actor.access, "stock_opname:read");
  const filters: (SQL | undefined)[] = [scope === "ALL" ? undefined : scope.length ? inArray(stockOpnames.branchId, scope) : sql`false`];
  if (params.branchId) filters.push(eq(stockOpnames.branchId, params.branchId));
  if (params.status) filters.push(eq(stockOpnames.status, params.status));
  const where = and(...filters);
  const agg = db
    .select({
      opnameId: stockOpnameItems.opnameId,
      lines: sql<number>`count(*)::int`.as("lines"),
      counted: sql<number>`sum(${stockOpnameItems.countedQty})::int`.as("counted"),
      plus: sql<number>`coalesce(sum(${stockOpnameItems.difference}) filter (where ${stockOpnameItems.difference} > 0), 0)::int`.as("plus"),
      minus: sql<number>`coalesce(-sum(${stockOpnameItems.difference}) filter (where ${stockOpnameItems.difference} < 0), 0)::int`.as("minus"),
    })
    .from(stockOpnameItems)
    .groupBy(stockOpnameItems.opnameId)
    .as("agg");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: stockOpnames.id,
        number: stockOpnames.number,
        status: stockOpnames.status,
        mode: stockOpnames.mode,
        branchId: stockOpnames.branchId,
        branchName: branches.name,
        note: stockOpnames.note,
        createdAt: stockOpnames.createdAt,
        postedAt: stockOpnames.postedAt,
        createdByName: user.name,
        lines: sql<number>`coalesce(${agg.lines}, 0)`,
        counted: sql<number>`coalesce(${agg.counted}, 0)`,
        plus: sql<number>`coalesce(${agg.plus}, 0)`,
        minus: sql<number>`coalesce(${agg.minus}, 0)`,
      })
      .from(stockOpnames)
      .innerJoin(branches, eq(branches.id, stockOpnames.branchId))
      .leftJoin(user, eq(user.id, stockOpnames.createdBy))
      .leftJoin(agg, eq(agg.opnameId, stockOpnames.id))
      .where(where)
      .orderBy(desc(stockOpnames.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(stockOpnames).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

/**
 * Detail opname. Selama COUNTING, `systemQty` = stok sistem saat ini (pratinjau selisih);
 * setelah POSTED, nilai yang dibukukan. Juga ringkasan barang berstok yang belum dihitung.
 */
export async function getOpname(actor: Actor, id: string) {
  const [head] = await db
    .select({ opname: stockOpnames, branchName: branches.name, branchCode: branches.code, createdByName: user.name })
    .from(stockOpnames)
    .innerJoin(branches, eq(branches.id, stockOpnames.branchId))
    .leftJoin(user, eq(user.id, stockOpnames.createdBy))
    .where(eq(stockOpnames.id, id));
  if (!head) throw notFound("Stok opname");
  const o = head.opname;
  if (!can(actor.access, "stock_opname:read", o.branchId)) throw forbidden("stock_opname:read");
  const showCost = can(actor.access, "product:view_cost");

  const [items, [uncounted]] = await Promise.all([
    db
      .select({
        variantId: stockOpnameItems.variantId,
        countedQty: stockOpnameItems.countedQty,
        postedSystemQty: stockOpnameItems.systemQty,
        postedDifference: stockOpnameItems.difference,
        liveSystemQty: sql<number>`coalesce(${inventoryLevels.onHand}, 0)::int`,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        variantTitle: productVariants.title,
        productName: products.name,
        costPrice: productVariants.costPrice,
        updatedAt: stockOpnameItems.updatedAt,
      })
      .from(stockOpnameItems)
      .innerJoin(productVariants, eq(productVariants.id, stockOpnameItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventoryLevels, and(eq(inventoryLevels.variantId, stockOpnameItems.variantId), eq(inventoryLevels.branchId, o.branchId)))
      .where(eq(stockOpnameItems.opnameId, id))
      .orderBy(desc(stockOpnameItems.updatedAt)),
    o.status === "COUNTING"
      ? db
          .select({ variants: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int` })
          .from(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.branchId, o.branchId),
              gt(inventoryLevels.onHand, 0),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(stockOpnameItems)
                  .where(and(eq(stockOpnameItems.opnameId, id), eq(stockOpnameItems.variantId, inventoryLevels.variantId))),
              ),
            ),
          )
      : Promise.resolve([{ variants: 0, units: 0 }]),
  ]);

  const rows = items.map((i) => {
    const systemQty = o.status === "POSTED" ? (i.postedSystemQty ?? 0) : i.liveSystemQty;
    const difference = o.status === "POSTED" ? (i.postedDifference ?? 0) : i.countedQty - i.liveSystemQty;
    return {
      variantId: i.variantId,
      sku: i.sku,
      barcode: i.barcode,
      variantTitle: i.variantTitle,
      productName: i.productName,
      countedQty: i.countedQty,
      systemQty,
      difference,
      valueDifference: showCost && i.costPrice != null ? difference * i.costPrice : null,
      updatedAt: i.updatedAt,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    ...o,
    branchName: head.branchName,
    branchCode: head.branchCode,
    createdByName: head.createdByName,
    items: rows,
    summary: {
      lines: rows.length,
      counted: sum((r) => r.countedQty),
      plus: sum((r) => Math.max(0, r.difference)),
      minus: sum((r) => Math.max(0, -r.difference)),
      matched: rows.filter((r) => r.difference === 0).length,
      valueDifference: showCost ? sum((r) => r.valueDifference ?? 0) : null,
      uncountedVariants: uncounted?.variants ?? 0,
      uncountedUnits: uncounted?.units ?? 0,
    },
  };
}

export async function createOpname(actor: Actor, input: { branchId: string; mode: "PARTIAL" | "FULL"; note?: string | null }) {
  if (!can(actor.access, "stock_opname:create", input.branchId)) throw forbidden("stock_opname:create");
  const [branch] = await db.select().from(branches).where(eq(branches.id, input.branchId));
  if (!branch) throw notFound("Cabang");
  try {
    const id = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "OPN", branch);
      const [row] = await tx.insert(stockOpnames).values({ number, branchId: branch.id, mode: input.mode, note: input.note ?? null, createdBy: actor.userId }).returning({ id: stockOpnames.id });
      await writeAudit(actor, { action: "create", entity: "stock_opname", entityId: row.id, after: { number, ...input } }, tx);
      return row.id;
    });
    return getOpname(actor, id);
  } catch (error) {
    if ((error as { cause?: { constraint_name?: string } }).cause?.constraint_name === "stock_opnames_one_counting_per_branch") {
      throw conflict("OPNAME_IN_PROGRESS", `Masih ada stok opname yang berjalan di ${branch.name}. Selesaikan atau batalkan dulu.`);
    }
    throw error;
  }
}

async function assertCounting(actor: Actor, id: string) {
  const o = await loadOpname(id);
  if (!can(actor.access, "stock_opname:create", o.branchId)) throw forbidden("stock_opname:create");
  if (o.status !== "COUNTING") throw conflict("OPNAME_CLOSED", "Stok opname ini sudah diposting atau dibatalkan.");
  return o;
}

/**
 * Catat hitungan: `delta` (scan +1, bisa beberapa perangkat sekaligus) atau `qty` (koreksi manual).
 * Satu UPSERT atomik — aman bila dua orang memindai barang yang sama bersamaan.
 */
export async function countItem(actor: Actor, id: string, input: { variantId: string; delta?: number; qty?: number }) {
  const o = await assertCounting(actor, id);
  const [variant] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, input.variantId));
  if (!variant) throw notFound("Varian");
  const setTo = input.qty;
  const delta = input.delta ?? 1;
  const [row] = await db
    .insert(stockOpnameItems)
    .values({ opnameId: o.id, variantId: input.variantId, countedQty: Math.max(0, setTo ?? delta), countedBy: actor.userId })
    .onConflictDoUpdate({
      target: [stockOpnameItems.opnameId, stockOpnameItems.variantId],
      set: {
        countedQty: setTo !== undefined ? setTo : sql`greatest(${stockOpnameItems.countedQty} + ${delta}, 0)`,
        countedBy: actor.userId,
        updatedAt: new Date(),
      },
    })
    .returning({ countedQty: stockOpnameItems.countedQty });
  return { variantId: input.variantId, countedQty: row.countedQty };
}

export async function removeCountItem(actor: Actor, id: string, variantId: string) {
  await assertCounting(actor, id);
  await db.delete(stockOpnameItems).where(and(eq(stockOpnameItems.opnameId, id), eq(stockOpnameItems.variantId, variantId)));
}

/** Posting: selisih (hitungan − stok sistem saat ini) dibukukan sebagai pergerakan OPNAME dalam satu transaksi. */
export async function postOpname(actor: Actor, id: string) {
  const o = await loadOpname(id);
  if (!can(actor.access, "stock_opname:approve", o.branchId)) throw forbidden("stock_opname:approve");
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(stockOpnames)
      .set({ status: "POSTED", postedBy: actor.userId, postedAt: new Date() })
      .where(and(eq(stockOpnames.id, id), eq(stockOpnames.status, "COUNTING")))
      .returning({ id: stockOpnames.id });
    if (!locked) throw conflict("OPNAME_CLOSED", "Stok opname ini sudah diposting atau dibatalkan.");

    // Mode FULL: barang berstok yang tidak dihitung dianggap 0.
    if (o.mode === "FULL") {
      await tx.execute(sql`
        insert into stock_opname_items (opname_id, variant_id, counted_qty, counted_by)
        select ${id}, il.variant_id, 0, ${actor.userId}
        from inventory_levels il
        where il.branch_id = ${o.branchId} and il.on_hand > 0
        on conflict do nothing
      `);
    }
    // Kunci baris stok cabang yang terlibat agar penjualan bersamaan tidak membuat selisih salah hitung.
    const rows = await tx.execute<{ variant_id: string; counted_qty: number; on_hand: number }>(sql`
      select i.variant_id, i.counted_qty, coalesce(il.on_hand, 0) as on_hand
      from stock_opname_items i
      left join inventory_levels il on il.variant_id = i.variant_id and il.branch_id = ${o.branchId}
      where i.opname_id = ${id}
      for update of i
    `);
    if (rows.length === 0) throw new ApiError(400, "OPNAME_EMPTY", "Belum ada barang yang dihitung.");

    const values = sql.join(
      rows.map((r) => sql`(${r.variant_id}::uuid, ${Number(r.on_hand)}::int, ${Number(r.counted_qty) - Number(r.on_hand)}::int)`),
      sql`, `,
    );
    await tx.execute(sql`
      update stock_opname_items as i set system_qty = v.sys, difference = v.diff
      from (values ${values}) as v(variant_id, sys, diff)
      where i.opname_id = ${id} and i.variant_id = v.variant_id
    `);
    const changes = rows
      .map((r) => ({ variantId: r.variant_id, diff: Number(r.counted_qty) - Number(r.on_hand) }))
      .filter((c) => c.diff !== 0)
      .map((c) => ({ branchId: o.branchId, variantId: c.variantId, qtyChange: c.diff, type: "OPNAME" as const, reason: o.number, referenceType: "stock_opname", referenceId: id }));
    try {
      await applyStockChanges(tx, actor, changes);
    } catch (error) {
      if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
        throw new ApiError(409, "OPNAME_BELOW_RESERVED", "Hasil hitung lebih kecil dari stok yang sudah dipesan (order online). Selesaikan atau batalkan pesanan itu dulu.", error.details);
      }
      throw error;
    }
    await writeAudit(actor, { action: "post", entity: "stock_opname", entityId: id, after: { lines: rows.length, adjusted: changes.length } }, tx);
  });
  return getOpname(actor, id);
}

export async function cancelOpname(actor: Actor, id: string) {
  const o = await loadOpname(id);
  if (!can(actor.access, "stock_opname:create", o.branchId)) throw forbidden("stock_opname:create");
  const [row] = await db
    .update(stockOpnames)
    .set({ status: "CANCELLED" })
    .where(and(eq(stockOpnames.id, id), eq(stockOpnames.status, "COUNTING")))
    .returning({ id: stockOpnames.id });
  if (!row) throw conflict("OPNAME_CLOSED", "Stok opname ini sudah diposting atau dibatalkan.");
  await writeAudit(actor, { action: "cancel", entity: "stock_opname", entityId: id });
  return getOpname(actor, id);
}
