import "server-only";
import { canonicalCourier } from "@/lib/couriers";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import {
  branches,
  customers,
  marketplaceConnections,
  onlineOrderItems,
  onlineOrders,
  paymentIntents,
  products,
  productVariants,
  saleItems,
  salePayments,
  sales,
  type TaxSnapshot,
} from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { env } from "@/server/env";
import { createPaymentIntent, latestIntent } from "@/server/payments/intents";
import { getPaymentProvider, mockProvider } from "@/server/payments/provider";
import { branchScope, can } from "@/server/rbac/access";
import { computeTotals } from "@/lib/pricing";
import { writeAudit } from "./audit.service";
import { applyStockChanges, releaseStock, reserveStock } from "./inventory.service";
import { nextDocNumber } from "./numbering";

type Channel = (typeof onlineOrders.$inferInsert)["channel"];
type OrderStatus = (typeof onlineOrders.$inferSelect)["status"];
type PaymentMethod = (typeof salePayments.$inferInsert)["method"];

export type CreateOrderInput = {
  branchId: string;
  channel: Channel;
  externalOrderNo?: string | null;
  customerId?: string | null;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  courier?: string | null;
  shippingFee: number;
  note?: string | null;
  /** Batas bayar sebelum reservasi dilepas otomatis. */
  paymentDeadlineHours: number;
  items: { variantId: string; qty: number }[];
};

const REF_TYPE = "online_order";

function taxOf(branch: typeof branches.$inferSelect): TaxSnapshot {
  const s = branch.settings ?? {};
  return { enabled: !!s.taxEnabled, rateBps: s.taxRateBps ?? 0, inclusive: s.taxInclusive ?? true };
}

function assertBranch(actor: Actor, perm: "online_order:read" | "online_order:create" | "online_order:update", branchId: string) {
  if (!can(actor.access, perm, branchId)) throw forbidden(perm);
}

// ── Kedaluwarsa otomatis ────────────────────────────────────────────────

/**
 * Batalkan order belum bayar yang melewati batas bayar dan lepas reservasinya. Dipanggil oportunistik
 * (saat daftar/buat order) dan oleh endpoint `/online-orders/expire` untuk cron. Maks 50 per panggilan.
 */
export async function expireStaleOrders() {
  const stale = await db
    .select({ id: onlineOrders.id })
    .from(onlineOrders)
    .where(and(eq(onlineOrders.status, "PENDING_PAYMENT"), lt(onlineOrders.reservedUntil, new Date()), isNull(onlineOrders.connectionId)))
    .limit(50);
  let expired = 0;
  for (const { id } of stale) {
    const done = await db.transaction(async (tx) => {
      const [o] = await tx.execute<{ status: OrderStatus }>(sql`select status from online_orders where id = ${id} for update`);
      if (o?.status !== "PENDING_PAYMENT") return false;
      await releaseOrderReservation(tx, id);
      await tx
        .update(onlineOrders)
        .set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Batas bayar terlewati (otomatis)", updatedAt: new Date() })
        .where(eq(onlineOrders.id, id));
      await tx.update(paymentIntents).set({ status: "EXPIRED", updatedAt: new Date() }).where(and(eq(paymentIntents.referenceId, id), eq(paymentIntents.status, "PENDING")));
      await writeAudit(null, { action: "expire", entity: "online_order", entityId: id }, tx);
      return true;
    });
    if (done) expired++;
  }
  return { expired };
}

async function orderReservations(tx: Tx, orderId: string) {
  return tx
    .select({ branchId: onlineOrders.branchId, variantId: onlineOrderItems.variantId, qty: onlineOrderItems.qty })
    .from(onlineOrderItems)
    .innerJoin(onlineOrders, eq(onlineOrders.id, onlineOrderItems.orderId))
    .where(eq(onlineOrderItems.orderId, orderId));
}

async function releaseOrderReservation(tx: Tx, orderId: string) {
  await releaseStock(tx, await orderReservations(tx, orderId));
}

// ── Baca ────────────────────────────────────────────────────────────────

export async function listOrders(
  actor: Actor,
  params: { branchId?: string; status?: OrderStatus; channel?: Channel; q?: string; page: number; pageSize: number },
) {
  await expireStaleOrders();
  const filters: (SQL | undefined)[] = [];
  const scope = branchScope(actor.access, "online_order:read");
  if (scope !== "ALL") filters.push(scope.length ? inArray(onlineOrders.branchId, scope) : sql`false`);
  if (params.branchId) filters.push(eq(onlineOrders.branchId, params.branchId));
  if (params.status) filters.push(eq(onlineOrders.status, params.status));
  if (params.channel) filters.push(eq(onlineOrders.channel, params.channel));
  if (params.q) {
    const like = `%${params.q}%`;
    filters.push(or(ilike(onlineOrders.number, like), ilike(onlineOrders.externalOrderNo, like), ilike(onlineOrders.recipientName, like), ilike(onlineOrders.trackingNo, like)));
  }
  const where = and(...filters);
  const qty = db
    .select({ orderId: onlineOrderItems.orderId, qty: sql<number>`sum(${onlineOrderItems.qty})::int`.as("qty") })
    .from(onlineOrderItems)
    .groupBy(onlineOrderItems.orderId)
    .as("order_qty");

  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        id: onlineOrders.id,
        number: onlineOrders.number,
        channel: onlineOrders.channel,
        externalOrderNo: onlineOrders.externalOrderNo,
        status: onlineOrders.status,
        recipientName: onlineOrders.recipientName,
        branchName: branches.name,
        total: onlineOrders.total,
        itemQty: sql<number>`coalesce(${qty.qty}, 0)`,
        courier: onlineOrders.courier,
        trackingNo: onlineOrders.trackingNo,
        reservedUntil: onlineOrders.reservedUntil,
        createdAt: onlineOrders.createdAt,
      })
      .from(onlineOrders)
      .innerJoin(branches, eq(branches.id, onlineOrders.branchId))
      .leftJoin(qty, eq(qty.orderId, onlineOrders.id))
      .where(where)
      .orderBy(desc(onlineOrders.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(onlineOrders).where(where),
    // Jumlah per status (untuk tab) mengikuti filter cabang & kanal, bukan filter status.
    db
      .select({ status: onlineOrders.status, n: sql<number>`count(*)::int` })
      .from(onlineOrders)
      .where(
        and(
          scope === "ALL" ? undefined : scope.length ? inArray(onlineOrders.branchId, scope) : sql`false`,
          params.branchId ? eq(onlineOrders.branchId, params.branchId) : undefined,
          params.channel ? eq(onlineOrders.channel, params.channel) : undefined,
        ),
      )
      .groupBy(onlineOrders.status),
  ]);
  return { data: rows, meta: { ...toPageMeta(params.page, params.pageSize, total), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])) } };
}

export async function getOrder(actor: Actor, id: string) {
  const order = await loadOrder(id);
  if (!order) throw notFound("Order");
  assertBranch(actor, "online_order:read", order.branchId);
  const provider = getPaymentProvider();
  return { ...order, qris: { available: !!provider, provider: provider?.name ?? null, simulator: !!mockProvider() } };
}

async function loadOrder(id: string) {
  const order = await db.query.onlineOrders.findFirst({
    where: eq(onlineOrders.id, id),
    with: {
      items: { orderBy: asc(onlineOrderItems.productName) },
      branch: { columns: { id: true, name: true, code: true } },
      customer: { columns: { id: true, name: true, memberNo: true } },
      createdByUser: { columns: { name: true } },
      sale: { columns: { id: true, number: true, status: true, refundTotal: true } },
    },
  });
  if (!order) return null;
  return { ...order, payment: await latestIntent(REF_TYPE, id) };
}

// ── Buat order ──────────────────────────────────────────────────────────

export async function createOrder(actor: Actor, input: CreateOrderInput) {
  assertBranch(actor, "online_order:create", input.branchId);
  const [branch] = await db.select().from(branches).where(eq(branches.id, input.branchId));
  if (!branch) throw notFound("Cabang");
  if (!branch.isActive) throw conflict("BRANCH_INACTIVE", "Cabang sumber stok sedang nonaktif.");

  const qtyByVariant = new Map<string, number>();
  for (const i of input.items) qtyByVariant.set(i.variantId, (qtyByVariant.get(i.variantId) ?? 0) + i.qty);
  const ids = [...qtyByVariant.keys()];
  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, title: productVariants.title, price: productVariants.price, isActive: productVariants.isActive, productName: products.name, productStatus: products.status })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, ids));
  const unavailable = ids.filter((id) => {
    const v = variants.find((r) => r.id === id);
    return !v || !v.isActive || v.productStatus !== "ACTIVE";
  });
  if (unavailable.length) throw badRequest("ITEM_UNAVAILABLE", "Ada barang yang tidak aktif dijual.", { variantIds: unavailable });
  if (input.customerId) {
    const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
    if (!c) throw notFound("Customer");
  }

  const tax = taxOf(branch);
  const lines = variants.map((v) => ({ v, qty: qtyByVariant.get(v.id)! }));
  const totals = computeTotals(lines.map((l) => ({ unitPrice: l.v.price, qty: l.qty })), tax);
  const total = totals.total + input.shippingFee;

  try {
    const orderId = await db.transaction(async (tx) => {
      await reserveStock(tx, lines.map((l) => ({ branchId: branch.id, variantId: l.v.id, qty: l.qty })));
      const number = await nextDocNumber(tx, "ORD", branch);
      const [order] = await tx
        .insert(onlineOrders)
        .values({
          number,
          branchId: branch.id,
          channel: input.channel,
          externalOrderNo: input.externalOrderNo?.trim() || null,
          customerId: input.customerId ?? null,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          shippingAddress: input.shippingAddress,
          courier: canonicalCourier(input.courier),
          shippingFee: input.shippingFee,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total,
          taxSnapshot: tax,
          note: input.note ?? null,
          reservedUntil: new Date(Date.now() + input.paymentDeadlineHours * 3_600_000),
          createdBy: actor.userId,
        })
        .returning({ id: onlineOrders.id });
      await tx.insert(onlineOrderItems).values(
        lines.map((l) => ({ orderId: order.id, variantId: l.v.id, productName: l.v.productName, variantTitle: l.v.title, sku: l.v.sku, qty: l.qty, unitPrice: l.v.price, lineTotal: l.v.price * l.qty })),
      );
      await writeAudit(actor, { action: "create", entity: "online_order", entityId: order.id, after: { number, total, channel: input.channel, items: lines.length } }, tx);
      return order.id;
    });
    return getOrder(actor, orderId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
      const failed = ((error.details as { items?: { variantId: string }[] })?.items ?? []).map((i) => i.variantId);
      const names = variants.filter((v) => failed.includes(v.id)).map((v) => (v.title === "Default" ? v.productName : `${v.productName} ${v.title}`));
      throw new ApiError(409, "INSUFFICIENT_STOCK", `Stok tersedia di ${branch.name} tidak cukup: ${names.join(", ")}.`, error.details);
    }
    throw error;
  }
}

// ── Pembayaran ──────────────────────────────────────────────────────────

/** Buat (atau pakai ulang) QRIS dinamis untuk order yang belum dibayar. */
export async function createQrisPayment(actor: Actor, orderId: string) {
  const order = await loadOrder(orderId);
  if (!order) throw notFound("Order");
  assertBranch(actor, "online_order:update", order.branchId);
  if (order.status !== "PENDING_PAYMENT") throw conflict("ORDER_NOT_PENDING", "Order ini tidak menunggu pembayaran.");
  if (order.reservedUntil < new Date()) throw conflict("ORDER_EXPIRED", "Batas bayar order sudah lewat.");
  const current = order.payment;
  if (current?.status === "PENDING" && current.qrString && current.expiresAt > new Date() && current.amount === order.total) return getOrder(actor, orderId);

  const minutes = Math.max(1, Math.min(env.QRIS_EXPIRY_MINUTES, Math.floor((order.reservedUntil.getTime() - Date.now()) / 60_000)));
  const intent = await createPaymentIntent({ referenceType: REF_TYPE, referenceId: orderId, documentNumber: order.number, amount: order.total, expiryMinutes: minutes, createdBy: actor.userId });
  const gatewayOrderId = intent.gatewayOrderId;
  await writeAudit(actor, { action: "create_qris", entity: "online_order", entityId: orderId, after: { gatewayOrderId, amount: order.total, provider: intent.provider } });
  return getOrder(actor, orderId);
}

/**
 * Tandai order lunas (dipanggil dari webhook gateway, sinkron status, atau input manual).
 * Idempoten: order yang sudah lunas tidak dibuat transaksinya lagi. Membuat baris `sales` dengan
 * channel kanal online; stok tetap reserved sampai dikirim.
 */
export async function confirmOrderPayment(tx: Tx, orderId: string, payment: { method: PaymentMethod; reference: string | null; amount: number }) {
  return markOrderPaid(tx, null, orderId, payment);
}

async function markOrderPaid(
  tx: Tx,
  actor: Actor | null,
  orderId: string,
  payment: { method: PaymentMethod; reference: string | null; amount: number },
): Promise<"PAID" | "ALREADY_PAID" | "ORDER_CANCELLED" | "AMOUNT_MISMATCH"> {
  const [locked] = await tx.execute<{ status: OrderStatus }>(sql`select status from online_orders where id = ${orderId} for update`);
  if (!locked) throw notFound("Order");
  if (locked.status === "CANCELLED") return "ORDER_CANCELLED";
  if (locked.status !== "PENDING_PAYMENT") return "ALREADY_PAID";
  const [order] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (payment.amount !== order.total) return "AMOUNT_MISMATCH";
  if (!order.createdBy) throw conflict("ORDER_NO_OWNER", "Pembuat order sudah tidak ada; catat pembayaran manual oleh admin.");

  const items = await tx
    .select({ item: onlineOrderItems, costPrice: productVariants.costPrice })
    .from(onlineOrderItems)
    .innerJoin(productVariants, eq(productVariants.id, onlineOrderItems.variantId))
    .where(eq(onlineOrderItems.orderId, orderId));

  const [sale] = await tx
    .insert(sales)
    .values({
      number: order.number,
      branchId: order.branchId,
      cashierId: order.createdBy,
      channel: order.channel,
      customerId: order.customerId,
      subtotal: order.subtotal,
      discountTotal: 0,
      taxTotal: order.taxTotal,
      shippingFee: order.shippingFee,
      total: order.total,
      taxSnapshot: order.taxSnapshot,
      note: order.externalOrderNo ? `${order.channel} ${order.externalOrderNo}` : null,
      idempotencyKey: `online-order:${order.id}`,
    })
    .returning({ id: sales.id });
  await tx.insert(saleItems).values(
    items.map(({ item, costPrice }) => ({
      saleId: sale.id,
      variantId: item.variantId,
      productName: item.productName,
      variantTitle: item.variantTitle,
      sku: item.sku,
      qty: item.qty,
      unitPrice: item.unitPrice,
      costPrice,
      discount: 0,
      lineTotal: item.lineTotal,
    })),
  );
  await tx.insert(salePayments).values({ saleId: sale.id, method: payment.method, amount: order.total, reference: payment.reference });
  await tx.update(onlineOrders).set({ status: "PAID", paidAt: new Date(), saleId: sale.id, updatedAt: new Date() }).where(eq(onlineOrders.id, orderId));
  if (order.customerId) {
    await tx
      .update(customers)
      .set({ totalSpent: sql`${customers.totalSpent} + ${order.total}`, visitCount: sql`${customers.visitCount} + 1`, lastVisitAt: new Date() })
      .where(eq(customers.id, order.customerId));
  }
  await writeAudit(actor, { action: "paid", entity: "online_order", entityId: orderId, after: { method: payment.method, reference: payment.reference, amount: order.total, saleId: sale.id } }, tx);
  return "PAID";
}

/**
 * Selama tokonya terhubung, pembayaran & pembatalan order marketplace mengikuti marketplace: mengubahnya di sini
 * membuat stok dan status berbeda dari yang dilihat pembeli. Toko yang sudah diputus boleh diselesaikan manual.
 */
async function assertNotMarketplaceManaged(connectionId: string | null) {
  if (!connectionId) return;
  const [conn] = await db.select({ status: marketplaceConnections.status }).from(marketplaceConnections).where(eq(marketplaceConnections.id, connectionId));
  if (conn && conn.status !== "DISCONNECTED") throw conflict("ORDER_FROM_MARKETPLACE", "Order ini mengikuti status di marketplace. Proses dari aplikasi penjual marketplace.");
}

/** Pembayaran manual: transfer bank, COD, atau marketplace yang sudah menagih pembeli. */
export async function markPaidManual(actor: Actor, orderId: string, input: { method: PaymentMethod; reference?: string | null }) {
  const order = await loadOrder(orderId);
  if (!order) throw notFound("Order");
  assertBranch(actor, "online_order:update", order.branchId);
  await assertNotMarketplaceManaged(order.connectionId);
  const result = await db.transaction(async (tx) => {
    const r = await markOrderPaid(tx, actor, orderId, { method: input.method, reference: input.reference ?? null, amount: order.total });
    if (r === "PAID") {
      await tx.update(paymentIntents).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(paymentIntents.referenceId, orderId), eq(paymentIntents.status, "PENDING")));
    }
    return r;
  });
  if (result === "ORDER_CANCELLED") throw conflict("ORDER_CANCELLED", "Order sudah dibatalkan.");
  if (result === "ALREADY_PAID") throw conflict("ORDER_ALREADY_PAID", "Order sudah lunas.");
  return getOrder(actor, orderId);
}

// ── Pemenuhan & pembatalan ──────────────────────────────────────────────

export type FulfilmentAction = "pack" | "ship" | "complete";

/**
 * Lanjutkan status order di dalam transaksi pemanggil (dipakai UI admin dan sinkron marketplace).
 * `actor` null = sistem (sinkron marketplace).
 */
export async function advanceOrderTx(tx: Tx, actor: Actor | null, orderId: string, action: FulfilmentAction, input: { courier?: string | null; trackingNo?: string | null } = {}) {
  const allowed: Record<FulfilmentAction, OrderStatus[]> = { pack: ["PAID"], ship: ["PAID", "PACKED"], complete: ["SHIPPED"] };
  const labels = { pack: "dikemas", ship: "dikirim", complete: "diselesaikan" };
  const [locked] = await tx.execute<{ status: OrderStatus }>(sql`select status from online_orders where id = ${orderId} for update`);
  if (!locked || !allowed[action].includes(locked.status)) throw conflict("ORDER_STATUS_INVALID", `Order dengan status ini tidak bisa ${labels[action]}.`);
  const [order] = await tx.select({ number: onlineOrders.number, courier: onlineOrders.courier, trackingNo: onlineOrders.trackingNo }).from(onlineOrders).where(eq(onlineOrders.id, orderId));
  const now = new Date();
  if (action === "pack") {
    await tx.update(onlineOrders).set({ status: "PACKED", packedAt: now, updatedAt: now }).where(eq(onlineOrders.id, orderId));
  } else if (action === "ship") {
    // Lepas reservasi lalu potong stok fisik (urutan penting: cek on_hand − delta ≥ reserved).
    const rows = await orderReservations(tx, orderId);
    await releaseStock(tx, rows);
    await applyStockChanges(
      tx,
      actor,
      rows.map((r) => ({ branchId: r.branchId, variantId: r.variantId, qtyChange: -r.qty, type: "SALE" as const, reason: order.number, referenceType: REF_TYPE, referenceId: orderId })),
    );
    await tx
      .update(onlineOrders)
      .set({
        status: "SHIPPED",
        shippedAt: now,
        packedAt: sql`coalesce(${onlineOrders.packedAt}, ${now.toISOString()}::timestamptz)`,
        courier: canonicalCourier(input.courier) ?? order.courier,
        trackingNo: input.trackingNo ?? order.trackingNo,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId));
  } else {
    await tx.update(onlineOrders).set({ status: "COMPLETED", completedAt: now, updatedAt: now }).where(eq(onlineOrders.id, orderId));
  }
  await writeAudit(actor, { action, entity: "online_order", entityId: orderId, before: { status: locked.status }, after: { ...input } }, tx);
}

export async function advanceOrder(actor: Actor, orderId: string, action: FulfilmentAction, input: { courier?: string | null; trackingNo?: string | null } = {}) {
  const order = await loadOrder(orderId);
  if (!order) throw notFound("Order");
  assertBranch(actor, "online_order:update", order.branchId);
  await db.transaction((tx) => advanceOrderTx(tx, actor, orderId, action, input));
  return getOrder(actor, orderId);
}

/**
 * Batalkan order yang belum dikirim di dalam transaksi pemanggil: reservasi dilepas; bila sudah lunas,
 * transaksi penjualannya VOIDED (dana dikembalikan di luar sistem). Mengembalikan true bila sudah lunas.
 */
export async function cancelOrderTx(tx: Tx, actor: Actor | null, orderId: string, reason: string) {
  const [locked] = await tx.execute<{ status: OrderStatus; sale_id: string | null; customer_id: string | null; total: string }>(
    sql`select status, sale_id, customer_id, total from online_orders where id = ${orderId} for update`,
  );
  if (!locked || !["PENDING_PAYMENT", "PAID", "PACKED"].includes(locked.status)) {
    throw conflict("ORDER_STATUS_INVALID", "Order yang sudah dikirim tidak bisa dibatalkan. Gunakan retur.");
  }
  await releaseOrderReservation(tx, orderId);
  const now = new Date();
  await tx.update(onlineOrders).set({ status: "CANCELLED", cancelledAt: now, cancelledBy: actor?.userId ?? null, cancelReason: reason, updatedAt: now }).where(eq(onlineOrders.id, orderId));
  await tx.update(paymentIntents).set({ status: "CANCELLED", updatedAt: now }).where(and(eq(paymentIntents.referenceId, orderId), eq(paymentIntents.status, "PENDING")));
  if (locked.sale_id) {
    await tx.update(sales).set({ status: "VOIDED", voidedAt: now, voidedBy: actor?.userId ?? null, voidReason: `Order dibatalkan: ${reason}` }).where(eq(sales.id, locked.sale_id));
    if (locked.customer_id) {
      await tx
        .update(customers)
        .set({ totalSpent: sql`greatest(${customers.totalSpent} - ${Number(locked.total)}, 0)`, visitCount: sql`greatest(${customers.visitCount} - 1, 0)` })
        .where(eq(customers.id, locked.customer_id));
    }
  }
  await writeAudit(actor, { action: "cancel", entity: "online_order", entityId: orderId, before: { status: locked.status }, after: { reason, refundManual: !!locked.sale_id } }, tx);
  return !!locked.sale_id;
}

export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  const order = await loadOrder(orderId);
  if (!order) throw notFound("Order");
  assertBranch(actor, "online_order:update", order.branchId);
  await assertNotMarketplaceManaged(order.connectionId);
  const wasPaid = await db.transaction((tx) => cancelOrderTx(tx, actor, orderId, reason));
  return { ...(await getOrder(actor, orderId)), refundRequired: wasPaid };
}
