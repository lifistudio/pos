import "server-only";
import { and, asc, count, desc, eq, gt, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { branches, inventoryLevels, products, productVariants, stockMovements, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, forbidden } from "@/server/api/errors";
import { decodeCursor, encodeCursor, toPageMeta } from "@/server/api/pagination";
import { scheduleStockPush } from "@/server/marketplace/stock-sync";
import { branchScope, can } from "@/server/rbac/access";
import { matchAllTerms } from "@/server/db/search";
import { writeAudit } from "./audit.service";

type MovementType = (typeof stockMovements.$inferInsert)["type"];

export type StockChange = {
  branchId: string;
  variantId: string;
  qtyChange: number;
  type: MovementType;
  reason?: string | null;
  referenceType?: string;
  referenceId?: string;
};

/**
 * Satu-satunya jalan untuk mengubah stok. Wajib dipanggil di dalam transaksi.
 * - Baris diproses urut (branch, variant) agar dua transaksi tidak saling deadlock.
 * - Update atomik `on_hand + delta >= reserved`, jadi stok tidak bisa minus walau dua kasir menjual bersamaan.
 */
export async function applyStockChanges(tx: Tx, actor: Actor | null, changes: StockChange[]) {
  if (changes.length === 0) return [];
  const key = (c: { branchId: string; variantId: string }) => `${c.branchId}:${c.variantId}`;

  // Gabungkan baris ganda (varian sama di cabang sama) menjadi satu delta.
  const deltas = new Map<string, { branchId: string; variantId: string; delta: number }>();
  for (const c of changes) {
    const d = deltas.get(key(c)) ?? { branchId: c.branchId, variantId: c.variantId, delta: 0 };
    d.delta += c.qtyChange;
    deltas.set(key(c), d);
  }
  const rows = [...deltas.values()].sort((a, b) => key(a).localeCompare(key(b)));

  await tx.insert(inventoryLevels).values(rows.map(({ branchId, variantId }) => ({ branchId, variantId }))).onConflictDoNothing();

  // Satu UPDATE untuk semua baris (bukan satu query per item).
  const values = sql.join(
    rows.map((r) => sql`(${r.branchId}::uuid, ${r.variantId}::uuid, ${r.delta}::int)`),
    sql`, `,
  );
  const updated = await tx.execute<{ branch_id: string; variant_id: string; on_hand: number }>(sql`
    UPDATE inventory_levels AS il
    SET on_hand = il.on_hand + v.delta, updated_at = now()
    FROM (VALUES ${values}) AS v(branch_id, variant_id, delta)
    WHERE il.branch_id = v.branch_id AND il.variant_id = v.variant_id
      AND il.on_hand + v.delta >= il.reserved
    RETURNING il.branch_id, il.variant_id, il.on_hand
  `);

  const balances = new Map(updated.map((r) => [`${r.branch_id}:${r.variant_id}`, Number(r.on_hand)]));
  const failed = rows.filter((r) => !balances.has(key(r)));
  if (failed.length) {
    throw new ApiError(409, "INSUFFICIENT_STOCK", "Stok tidak cukup untuk perubahan ini.", {
      items: failed.map(({ branchId, variantId }) => ({ branchId, variantId })),
    });
  }

  // balance_after per baris ledger dihitung mundur dari saldo akhir agar urutan baris tetap konsisten.
  const running = new Map(balances);
  const ledger = [...changes].reverse().map((c) => {
    const after = running.get(key(c))!;
    running.set(key(c), after - c.qtyChange);
    return { ...c, balanceAfter: after };
  }).reverse();

  await tx.insert(stockMovements).values(
    ledger.map((c) => ({
      branchId: c.branchId,
      variantId: c.variantId,
      type: c.type,
      qtyChange: c.qtyChange,
      balanceAfter: c.balanceAfter,
      reason: c.reason ?? null,
      referenceType: c.referenceType ?? null,
      referenceId: c.referenceId ?? null,
      actorId: actor?.userId ?? null,
    })),
  );
  scheduleStockPush(rows.map((r) => r.branchId));
  return rows.map(({ branchId, variantId }) => ({ branchId, variantId, onHand: balances.get(`${branchId}:${variantId}`)! }));
}

function scopeFilter(actor: Actor, column: typeof inventoryLevels.branchId | typeof stockMovements.branchId) {
  const scope = branchScope(actor.access, "inventory:read");
  if (scope === "ALL") return undefined;
  return scope.length ? inArray(column, scope) : sql`false`;
}

export async function listInventory(
  actor: Actor,
  params: { branchId?: string; q?: string; status?: "low" | "out"; page: number; pageSize: number },
) {
  if (params.branchId && !can(actor.access, "inventory:read", params.branchId)) throw forbidden("inventory:read");
  const filters: (SQL | undefined)[] = [scopeFilter(actor, inventoryLevels.branchId)];
  if (params.branchId) filters.push(eq(inventoryLevels.branchId, params.branchId));
  if (params.q) {
    filters.push(
      or(
        eq(productVariants.barcode, params.q),
        matchAllTerms(params.q, [products.name, productVariants.title, productVariants.sku]),
      ),
    );
  }
  if (params.status === "out") filters.push(lte(inventoryLevels.onHand, 0));
  if (params.status === "low") {
    filters.push(and(gt(inventoryLevels.onHand, 0), lte(inventoryLevels.onHand, inventoryLevels.reorderPoint)));
  }
  const where = and(...filters);

  const base = db
    .select({
      branchId: inventoryLevels.branchId,
      branchName: branches.name,
      variantId: productVariants.id,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      variantTitle: productVariants.title,
      productId: products.id,
      productName: products.name,
      onHand: inventoryLevels.onHand,
      reserved: inventoryLevels.reserved,
      reorderPoint: inventoryLevels.reorderPoint,
      updatedAt: inventoryLevels.updatedAt,
    })
    .from(inventoryLevels)
    .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(branches, eq(branches.id, inventoryLevels.branchId));

  const [rows, [{ total }]] = await Promise.all([
    base
      .where(where)
      .orderBy(asc(products.name), asc(productVariants.sku), asc(branches.name))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db
      .select({ total: count() })
      .from(inventoryLevels)
      .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
  ]);

  return {
    data: rows.map((r) => ({ ...r, available: r.onHand - r.reserved })),
    meta: toPageMeta(params.page, params.pageSize, total),
  };
}

export async function adjustStock(
  actor: Actor,
  input: {
    branchId: string;
    type: "RECEIPT" | "ADJUSTMENT";
    reason: string;
    items: { variantId: string; qtyChange: number }[];
  },
) {
  if (!can(actor.access, "inventory:adjust", input.branchId)) throw forbidden("inventory:adjust");
  return db.transaction(async (tx) => {
    const results = await applyStockChanges(
      tx,
      actor,
      input.items.map((item) => ({ branchId: input.branchId, type: input.type, reason: input.reason, ...item })),
    );
    await writeAudit(actor, { action: "adjust", entity: "inventory", entityId: input.branchId, after: input }, tx);
    return results;
  });
}

export async function setReorderPoint(actor: Actor, input: { branchId: string; variantId: string; reorderPoint: number }) {
  if (!can(actor.access, "inventory:adjust", input.branchId)) throw forbidden("inventory:adjust");
  await db
    .insert(inventoryLevels)
    .values(input)
    .onConflictDoUpdate({
      target: [inventoryLevels.branchId, inventoryLevels.variantId],
      set: { reorderPoint: input.reorderPoint, updatedAt: new Date() },
    });
}

export async function listStockMovements(
  actor: Actor,
  params: { branchId?: string; variantId?: string; cursor?: string; limit: number },
) {
  const filters: (SQL | undefined)[] = [scopeFilter(actor, stockMovements.branchId)];
  if (params.branchId) filters.push(eq(stockMovements.branchId, params.branchId));
  if (params.variantId) filters.push(eq(stockMovements.variantId, params.variantId));
  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    const t = new Date(cursor.t);
    filters.push(or(lt(stockMovements.createdAt, t), and(eq(stockMovements.createdAt, t), lt(stockMovements.id, cursor.id))));
  }

  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      qtyChange: stockMovements.qtyChange,
      balanceAfter: stockMovements.balanceAfter,
      reason: stockMovements.reason,
      referenceType: stockMovements.referenceType,
      referenceId: stockMovements.referenceId,
      createdAt: stockMovements.createdAt,
      branchName: branches.name,
      sku: productVariants.sku,
      variantTitle: productVariants.title,
      productName: products.name,
      actorName: user.name,
    })
    .from(stockMovements)
    .innerJoin(branches, eq(branches.id, stockMovements.branchId))
    .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(user, eq(user.id, stockMovements.actorId))
    .where(and(...filters))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data.at(-1);
  return { data, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

export type StockReservation = { branchId: string; variantId: string; qty: number };

/**
 * Reservasi untuk order yang belum dikirim: `reserved` naik hanya bila stok tersedia (on_hand − reserved) cukup.
 * Satu UPDATE untuk semua baris; on_hand tidak berubah sehingga tidak masuk ledger (dicatat di order & audit).
 */
export async function reserveStock(tx: Tx, rows: StockReservation[]) {
  if (rows.length === 0) return;
  const sorted = [...rows].sort((a, b) => `${a.branchId}:${a.variantId}`.localeCompare(`${b.branchId}:${b.variantId}`));
  await tx.insert(inventoryLevels).values(sorted.map(({ branchId, variantId }) => ({ branchId, variantId }))).onConflictDoNothing();
  const values = sql.join(
    sorted.map((r) => sql`(${r.branchId}::uuid, ${r.variantId}::uuid, ${r.qty}::int)`),
    sql`, `,
  );
  const updated = await tx.execute<{ variant_id: string }>(sql`
    UPDATE inventory_levels AS il
    SET reserved = il.reserved + v.qty, updated_at = now()
    FROM (VALUES ${values}) AS v(branch_id, variant_id, qty)
    WHERE il.branch_id = v.branch_id AND il.variant_id = v.variant_id
      AND il.on_hand - il.reserved >= v.qty
    RETURNING il.variant_id
  `);
  const ok = new Set(updated.map((r) => r.variant_id));
  const failed = sorted.filter((r) => !ok.has(r.variantId));
  if (failed.length) {
    throw new ApiError(409, "INSUFFICIENT_STOCK", "Stok tersedia tidak cukup untuk direservasi.", { items: failed.map(({ branchId, variantId }) => ({ branchId, variantId })) });
  }
  scheduleStockPush(sorted.map((r) => r.branchId));
}

/** Lepas reservasi (order batal/kedaluwarsa, atau sebelum stok dipotong saat dikirim). */
export async function releaseStock(tx: Tx, rows: StockReservation[]) {
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map((r) => sql`(${r.branchId}::uuid, ${r.variantId}::uuid, ${r.qty}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE inventory_levels AS il
    SET reserved = greatest(il.reserved - v.qty, 0), updated_at = now()
    FROM (VALUES ${values}) AS v(branch_id, variant_id, qty)
    WHERE il.branch_id = v.branch_id AND il.variant_id = v.variant_id
  `);
  scheduleStockPush(rows.map((r) => r.branchId));
}
