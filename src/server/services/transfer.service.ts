import "server-only";
import { aliasedTable, and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, inventoryLevels, products, productVariants, stockTransferItems, stockTransfers, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { branchScope, can } from "@/server/rbac/access";
import { writeAudit } from "./audit.service";
import { applyStockChanges } from "./inventory.service";
import { nextDocNumber } from "./numbering";

type Status = (typeof stockTransfers.$inferSelect)["status"];
export type TransferItemInput = { variantId: string; qty: number };

const fromB = aliasedTable(branches, "from_branch");
const toB = aliasedTable(branches, "to_branch");

function mergeItems(items: TransferItemInput[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.variantId, (m.get(i.variantId) ?? 0) + i.qty);
  return [...m].map(([variantId, qty]) => ({ variantId, qty })).filter((i) => i.qty > 0);
}

async function loadTransfer(id: string) {
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
  if (!t) throw notFound("Transfer");
  return t;
}

/** Boleh melihat bila punya stock_transfer:read di cabang asal atau tujuan. */
function canSee(actor: Actor, t: { fromBranchId: string; toBranchId: string }) {
  return can(actor.access, "stock_transfer:read", t.fromBranchId) || can(actor.access, "stock_transfer:read", t.toBranchId);
}

export async function listTransfers(actor: Actor, params: { branchId?: string; direction?: "in" | "out"; status?: Status; page: number; pageSize: number }) {
  const scope = branchScope(actor.access, "stock_transfer:read");
  const filters: (SQL | undefined)[] = [];
  if (scope !== "ALL") filters.push(scope.length ? or(inArray(stockTransfers.fromBranchId, scope), inArray(stockTransfers.toBranchId, scope)) : sql`false`);
  if (params.branchId) {
    filters.push(
      params.direction === "in"
        ? eq(stockTransfers.toBranchId, params.branchId)
        : params.direction === "out"
          ? eq(stockTransfers.fromBranchId, params.branchId)
          : or(eq(stockTransfers.fromBranchId, params.branchId), eq(stockTransfers.toBranchId, params.branchId)),
    );
  }
  if (params.status) filters.push(eq(stockTransfers.status, params.status));
  const where = and(...filters);

  const agg = db
    .select({
      transferId: stockTransferItems.transferId,
      lines: sql<number>`count(*)::int`.as("lines"),
      qtySent: sql<number>`sum(${stockTransferItems.qtySent})::int`.as("qty_sent"),
      qtyReceived: sql<number | null>`sum(${stockTransferItems.qtyReceived})::int`.as("qty_received"),
    })
    .from(stockTransferItems)
    .groupBy(stockTransferItems.transferId)
    .as("agg");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: stockTransfers.id,
        number: stockTransfers.number,
        status: stockTransfers.status,
        fromBranchId: stockTransfers.fromBranchId,
        fromBranchName: fromB.name,
        toBranchId: stockTransfers.toBranchId,
        toBranchName: toB.name,
        note: stockTransfers.note,
        createdAt: stockTransfers.createdAt,
        sentAt: stockTransfers.sentAt,
        receivedAt: stockTransfers.receivedAt,
        lines: sql<number>`coalesce(${agg.lines}, 0)`,
        qtySent: sql<number>`coalesce(${agg.qtySent}, 0)`,
        qtyReceived: agg.qtyReceived,
      })
      .from(stockTransfers)
      .innerJoin(fromB, eq(fromB.id, stockTransfers.fromBranchId))
      .innerJoin(toB, eq(toB.id, stockTransfers.toBranchId))
      .leftJoin(agg, eq(agg.transferId, stockTransfers.id))
      .where(where)
      .orderBy(desc(stockTransfers.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(stockTransfers).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

/** Detail + item dengan nama, SKU, barcode, dan stok tersedia di asal (1 query item). */
export async function getTransfer(actor: Actor, id: string) {
  const [head] = await db
    .select({
      transfer: stockTransfers,
      fromBranchName: fromB.name,
      fromBranchCode: fromB.code,
      toBranchName: toB.name,
      toBranchCode: toB.code,
      createdByName: user.name,
    })
    .from(stockTransfers)
    .innerJoin(fromB, eq(fromB.id, stockTransfers.fromBranchId))
    .innerJoin(toB, eq(toB.id, stockTransfers.toBranchId))
    .leftJoin(user, eq(user.id, stockTransfers.createdBy))
    .where(eq(stockTransfers.id, id));
  if (!head) throw notFound("Transfer");
  if (!canSee(actor, head.transfer)) throw forbidden("stock_transfer:read");

  const items = await db
    .select({
      variantId: stockTransferItems.variantId,
      qtySent: stockTransferItems.qtySent,
      qtyReceived: stockTransferItems.qtyReceived,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      variantTitle: productVariants.title,
      productName: products.name,
      availableAtOrigin: sql<number>`coalesce(${inventoryLevels.onHand} - ${inventoryLevels.reserved}, 0)::int`,
    })
    .from(stockTransferItems)
    .innerJoin(productVariants, eq(productVariants.id, stockTransferItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryLevels, and(eq(inventoryLevels.variantId, stockTransferItems.variantId), eq(inventoryLevels.branchId, head.transfer.fromBranchId)))
    .where(eq(stockTransferItems.transferId, id))
    .orderBy(products.name, productVariants.sku);

  return {
    ...head.transfer,
    fromBranchName: head.fromBranchName,
    fromBranchCode: head.fromBranchCode,
    toBranchName: head.toBranchName,
    toBranchCode: head.toBranchCode,
    createdByName: head.createdByName,
    items,
  };
}

export async function createTransfer(actor: Actor, input: { fromBranchId: string; toBranchId: string; note?: string | null; items: TransferItemInput[] }) {
  if (input.fromBranchId === input.toBranchId) throw badRequest("SAME_BRANCH", "Cabang asal dan tujuan harus berbeda.");
  if (!can(actor.access, "stock_transfer:create", input.fromBranchId)) throw forbidden("stock_transfer:create");
  const items = mergeItems(input.items);
  if (!items.length) throw badRequest("EMPTY_TRANSFER", "Tambahkan minimal satu barang.");
  const [from] = await db.select().from(branches).where(eq(branches.id, input.fromBranchId));
  const [to] = await db.select({ id: branches.id, isActive: branches.isActive }).from(branches).where(eq(branches.id, input.toBranchId));
  if (!from || !to) throw notFound("Cabang");
  if (!to.isActive) throw conflict("BRANCH_INACTIVE", "Cabang tujuan sedang nonaktif.");

  const id = await db.transaction(async (tx) => {
    const number = await nextDocNumber(tx, "TRF", from);
    const [row] = await tx
      .insert(stockTransfers)
      .values({ number, fromBranchId: from.id, toBranchId: to.id, note: input.note ?? null, createdBy: actor.userId })
      .returning({ id: stockTransfers.id });
    await tx.insert(stockTransferItems).values(items.map((i) => ({ transferId: row.id, variantId: i.variantId, qtySent: i.qty })));
    await writeAudit(actor, { action: "create", entity: "stock_transfer", entityId: row.id, after: { number, ...input } }, tx);
    return row.id;
  });
  return getTransfer(actor, id);
}

export async function updateTransferDraft(actor: Actor, id: string, input: { note?: string | null; items: TransferItemInput[] }) {
  const t = await loadTransfer(id);
  if (t.status !== "DRAFT") throw conflict("TRANSFER_LOCKED", "Transfer yang sudah dikirim tidak bisa diubah.");
  if (!can(actor.access, "stock_transfer:create", t.fromBranchId)) throw forbidden("stock_transfer:create");
  const items = mergeItems(input.items);
  if (!items.length) throw badRequest("EMPTY_TRANSFER", "Tambahkan minimal satu barang.");
  await db.transaction(async (tx) => {
    await tx.update(stockTransfers).set({ note: input.note ?? null }).where(eq(stockTransfers.id, id));
    await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, id));
    await tx.insert(stockTransferItems).values(items.map((i) => ({ transferId: id, variantId: i.variantId, qtySent: i.qty })));
    await writeAudit(actor, { action: "update", entity: "stock_transfer", entityId: id, after: input }, tx);
  });
  return getTransfer(actor, id);
}

/** Kirim: stok asal berkurang (TRANSFER_OUT). Gagal seluruhnya bila ada stok yang kurang. */
export async function sendTransfer(actor: Actor, id: string) {
  const t = await loadTransfer(id);
  if (!can(actor.access, "stock_transfer:create", t.fromBranchId)) throw forbidden("stock_transfer:create");
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(stockTransfers)
      .set({ status: "IN_TRANSIT", sentBy: actor.userId, sentAt: new Date() })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, "DRAFT")))
      .returning({ id: stockTransfers.id });
    if (!locked) throw conflict("TRANSFER_NOT_DRAFT", "Transfer ini sudah dikirim atau dibatalkan.");
    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
    try {
      await applyStockChanges(
        tx,
        actor,
        items.map((i) => ({ branchId: t.fromBranchId, variantId: i.variantId, qtyChange: -i.qtySent, type: "TRANSFER_OUT" as const, reason: t.number, referenceType: "stock_transfer", referenceId: id })),
      );
    } catch (error) {
      // Sebutkan barang yang stoknya kurang agar MD bisa langsung mengoreksi jumlah.
      if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
        const ids = ((error.details as { items?: { variantId: string }[] })?.items ?? []).map((i) => i.variantId);
        const names = ids.length
          ? await tx
              .select({ name: sql<string>`${products.name} || case when ${productVariants.title} = 'Default' then '' else ' ' || ${productVariants.title} end` })
              .from(productVariants)
              .innerJoin(products, eq(products.id, productVariants.productId))
              .where(inArray(productVariants.id, ids))
          : [];
        throw new ApiError(409, "INSUFFICIENT_STOCK", `Stok di cabang asal tidak cukup: ${names.map((n) => n.name).join(", ") || "beberapa barang"}.`, error.details);
      }
      throw error;
    }
    await writeAudit(actor, { action: "send", entity: "stock_transfer", entityId: id }, tx);
  });
  return getTransfer(actor, id);
}

/**
 * Terima di cabang tujuan: stok bertambah sesuai jumlah diterima (TRANSFER_IN).
 * Item yang tidak disebut dianggap diterima penuh. Selisih (hilang/rusak di jalan) tetap tercatat di item.
 */
export async function receiveTransfer(actor: Actor, id: string, input: { items?: { variantId: string; qtyReceived: number }[]; note?: string | null }) {
  const t = await loadTransfer(id);
  if (!can(actor.access, "stock_transfer:approve", t.toBranchId)) {
    throw forbidden("stock_transfer:approve");
  }
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(stockTransfers)
      .set({ status: "RECEIVED", receivedBy: actor.userId, receivedAt: new Date(), receiveNote: input.note ?? null })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, "IN_TRANSIT")))
      .returning({ id: stockTransfers.id });
    if (!locked) throw conflict("TRANSFER_NOT_IN_TRANSIT", "Transfer ini belum dikirim, sudah diterima, atau dibatalkan.");
    const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
    const given = new Map((input.items ?? []).map((i) => [i.variantId, i.qtyReceived]));
    for (const vid of given.keys()) if (!items.some((i) => i.variantId === vid)) throw badRequest("ITEM_NOT_IN_TRANSFER", "Ada barang yang tidak termasuk transfer ini.");
    const received = items.map((i) => {
      const qty = given.get(i.variantId) ?? i.qtySent;
      if (qty < 0 || qty > i.qtySent) throw badRequest("QTY_INVALID", "Jumlah diterima tidak boleh melebihi jumlah dikirim.");
      return { ...i, qtyReceived: qty };
    });
    // Satu UPDATE untuk semua item.
    const values = sql.join(
      received.map((r) => sql`(${r.variantId}::uuid, ${r.qtyReceived}::int)`),
      sql`, `,
    );
    await tx.execute(sql`
      update stock_transfer_items as i set qty_received = v.qty
      from (values ${values}) as v(variant_id, qty)
      where i.transfer_id = ${id} and i.variant_id = v.variant_id
    `);
    await applyStockChanges(
      tx,
      actor,
      received
        .filter((r) => r.qtyReceived > 0)
        .map((r) => ({ branchId: t.toBranchId, variantId: r.variantId, qtyChange: r.qtyReceived, type: "TRANSFER_IN" as const, reason: t.number, referenceType: "stock_transfer", referenceId: id })),
    );
    const missing = received.reduce((s, r) => s + (r.qtySent - r.qtyReceived), 0);
    await writeAudit(actor, { action: "receive", entity: "stock_transfer", entityId: id, after: { missing, note: input.note ?? null } }, tx);
  });
  return getTransfer(actor, id);
}

/** Batal: draf langsung batal; dalam perjalanan → stok dikembalikan ke asal. */
export async function cancelTransfer(actor: Actor, id: string, reason: string) {
  const t = await loadTransfer(id);
  const allowed = can(actor.access, "stock_transfer:create", t.fromBranchId) || can(actor.access, "stock_transfer:approve", t.fromBranchId);
  if (!allowed) throw forbidden("stock_transfer:create");
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(stockTransfers)
      .set({ status: "CANCELLED", cancelledBy: actor.userId, cancelledAt: new Date(), receiveNote: reason })
      .where(and(eq(stockTransfers.id, id), inArray(stockTransfers.status, ["DRAFT", "IN_TRANSIT"])))
      .returning({ id: stockTransfers.id });
    if (!locked) throw conflict("TRANSFER_CLOSED", "Transfer yang sudah diterima atau dibatalkan tidak bisa dibatalkan.");
    if (t.status === "IN_TRANSIT") {
      const items = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, id));
      await applyStockChanges(
        tx,
        actor,
        items.map((i) => ({ branchId: t.fromBranchId, variantId: i.variantId, qtyChange: i.qtySent, type: "TRANSFER_IN" as const, reason: `Batal ${t.number}: ${reason}`, referenceType: "stock_transfer", referenceId: id })),
      );
    }
    await writeAudit(actor, { action: "cancel", entity: "stock_transfer", entityId: id, after: { reason, wasInTransit: t.status === "IN_TRANSIT" } }, tx);
  });
  return getTransfer(actor, id);
}
