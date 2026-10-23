import "server-only";
import { and, count, desc, eq, gte, ilike, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, customers, onlineOrders, pointLedger, saleItems, salePayments, saleReturnItems, saleReturns, sales, shifts, user, voucherUsages, vouchers } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { branchScope, can } from "@/server/rbac/access";
import { computeReturn } from "@/lib/returns";
import { writeAudit } from "./audit.service";
import { authorizeOrApprove } from "./approval.service";
import { applyStockChanges } from "./inventory.service";
import { nextDocNumber } from "./numbering";
import { getStorePolicy } from "./settings.service";

type PaymentMethod = (typeof saleReturns.$inferInsert)["refundMethod"];

export type ReturnReasonCode = (typeof saleReturns.$inferInsert)["reasonCode"] & string;

export type CreateReturnInput = {
  items: { saleItemId: string; qty: number; restock: boolean }[];
  refundMethod: PaymentMethod;
  reasonCode: ReturnReasonCode;
  reason: string;
  /** Izin PIN atasan bila pelaku tidak punya `pos:refund`. */
  approvalId?: string | null;
  reference?: string | null;
};

/**
 * Retur atas satu struk. Nilai uang/poin dihitung kumulatif (lib/returns) sehingga retur bertahap
 * berjumlah tepat sama dengan transaksi. Semua dalam satu transaksi DB: kunci struk, naikkan
 * returned_qty bersyarat, stok kembali (hanya barang layak jual), poin & statistik customer,
 * kuota voucher bila diretur penuh.
 */
export async function createReturn(actor: Actor, saleId: string, input: CreateReturnInput) {
  const [head] = await db
    .select({ sale: sales, branch: branches })
    .from(sales)
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .where(eq(sales.id, saleId));
  if (!head) throw notFound("Transaksi");
  const { sale, branch } = head;
  if (!can(actor.access, "pos:refund", sale.branchId) && !can(actor.access, "pos:access", sale.branchId)) throw forbidden("pos:refund");
  if (sale.status !== "PAID") throw conflict("SALE_VOIDED", "Transaksi yang sudah dibatalkan tidak bisa diretur.");
  if (sale.channel !== "POS") {
    // Order online yang belum dikirim dibatalkan lewat order (reservasi dilepas), bukan diretur.
    const [order] = await db.select({ status: onlineOrders.status }).from(onlineOrders).where(eq(onlineOrders.saleId, saleId));
    if (order && !["SHIPPED", "COMPLETED"].includes(order.status)) throw conflict("ORDER_NOT_SHIPPED", "Order online belum dikirim. Batalkan dari halaman order.");
  }

  const policy = await getStorePolicy();
  const ageDays = (Date.now() - sale.createdAt.getTime()) / 86_400_000;
  if (ageDays > policy.returnWindowDays) {
    throw conflict("RETURN_WINDOW_PASSED", policy.returnWindowDays === 0 ? "Retur tidak diizinkan oleh kebijakan toko." : `Batas retur ${policy.returnWindowDays} hari sejak transaksi sudah lewat.`);
  }

  // Refund hanya ke tunai atau metode yang dipakai saat bayar.
  const paidMethods = await db.selectDistinct({ method: salePayments.method }).from(salePayments).where(eq(salePayments.saleId, saleId));
  if (input.refundMethod !== "CASH" && !paidMethods.some((m) => m.method === input.refundMethod)) {
    throw badRequest("REFUND_METHOD_INVALID", "Refund hanya bisa tunai atau ke metode pembayaran asal.");
  }
  // Uang tunai keluar dari laci: wajib shift terbuka milik pemroses di cabang struk.
  const [shift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, actor.userId), eq(shifts.branchId, sale.branchId), eq(shifts.status, "OPEN")));
  if (input.refundMethod === "CASH" && !shift) throw conflict("NO_OPEN_SHIFT", "Refund tunai butuh shift kasir yang terbuka di cabang ini.");

  const returnId = await db.transaction(async (tx) => {
    // Kunci struk: dua retur bersamaan atas struk yang sama diproses berurutan.
    await tx.execute(sql`select 1 from sales where id = ${saleId} for update`);
    const approver = await authorizeOrApprove(tx, actor, "pos:refund", sale.branchId, input.approvalId, `sale:${saleId}`);
    const [fresh] = await tx.select({ refundTotal: sales.refundTotal, status: sales.status }).from(sales).where(eq(sales.id, saleId));
    if (fresh.status !== "PAID") throw conflict("SALE_VOIDED", "Transaksi yang sudah dibatalkan tidak bisa diretur.");
    const lines = await tx
      .select({ id: saleItems.id, variantId: saleItems.variantId, qty: saleItems.qty, returnedQty: saleItems.returnedQty, lineTotal: saleItems.lineTotal })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId));

    // Ongkir tidak ikut dikembalikan: dasar retur = total barang (termasuk PPN).
    const calc = computeReturn({ ...sale, total: sale.total - sale.shippingFee, refundTotal: fresh.refundTotal }, lines, input.items);
    if (calc.error) throw badRequest("RETURN_INVALID", calc.error);

    // returned_qty naik dalam satu UPDATE; CHECK + kondisi WHERE mencegah retur melebihi qty.
    const values = sql.join(
      calc.items.map((i) => sql`(${i.saleItemId}::uuid, ${i.qty}::int)`),
      sql`, `,
    );
    const updated = await tx.execute<{ id: string }>(sql`
      update sale_items si set returned_qty = si.returned_qty + v.qty
      from (values ${values}) as v(id, qty)
      where si.id = v.id and si.sale_id = ${saleId} and si.returned_qty + v.qty <= si.qty
      returning si.id`);
    if (updated.length !== calc.items.length) throw conflict("RETURN_EXCEEDS", "Jumlah retur melebihi sisa barang di struk.");

    const number = await nextDocNumber(tx, "RET", branch);
    const restockById = new Map(input.items.map((i) => [i.saleItemId, i.restock]));
    const variantOf = new Map(lines.map((l) => [l.id, l.variantId]));

    // Poin: kembalikan yang dulu ditukar, tarik yang didapat (dibatasi saldo agar tidak minus).
    let pointsReversed = 0;
    const pointsRestored = calc.pointsRestored;
    if (sale.customerId) {
      const [cust] = await tx.execute<{ points: number }>(sql`select points from customers where id = ${sale.customerId} for update`);
      pointsReversed = Math.min(calc.pointsReversed, Number(cust?.points ?? 0) + pointsRestored);
    }

    const [ret] = await tx
      .insert(saleReturns)
      .values({
        number,
        saleId,
        branchId: sale.branchId,
        shiftId: shift?.id ?? null,
        createdBy: actor.userId,
        refundMethod: input.refundMethod,
        refundAmount: calc.refund,
        pointsReversed,
        pointsRestored,
        reasonCode: input.reasonCode,
        reason: input.reason,
        reference: input.reference ?? null,
        approvedBy: approver,
      })
      .returning({ id: saleReturns.id });
    await tx.insert(saleReturnItems).values(
      calc.items.map((i) => ({ returnId: ret.id, saleItemId: i.saleItemId, variantId: variantOf.get(i.saleItemId)!, qty: i.qty, amount: i.amount, restock: restockById.get(i.saleItemId) ?? true })),
    );
    await tx.update(sales).set({ refundTotal: sql`${sales.refundTotal} + ${calc.refund}`, updatedAt: new Date() }).where(eq(sales.id, saleId));

    const restock = calc.items.filter((i) => restockById.get(i.saleItemId) ?? true);
    if (restock.length) {
      await applyStockChanges(
        tx,
        actor,
        restock.map((i) => ({
          branchId: sale.branchId,
          variantId: variantOf.get(i.saleItemId)!,
          qtyChange: i.qty,
          type: "RETURN" as const,
          reason: `${number} (${sale.number}): ${input.reason}`,
          referenceType: "sale_return",
          referenceId: ret.id,
        })),
      );
    }

    if (sale.customerId) {
      const [after] = await tx
        .update(customers)
        .set({
          points: sql`${customers.points} + ${pointsRestored} - ${pointsReversed}`,
          totalSpent: sql`greatest(${customers.totalSpent} - ${calc.refund}, 0)`,
        })
        .where(eq(customers.id, sale.customerId))
        .returning({ points: customers.points });
      const ledger: (typeof pointLedger.$inferInsert)[] = [];
      if (pointsRestored > 0) ledger.push({ customerId: sale.customerId, type: "REFUND", change: pointsRestored, balanceAfter: after.points + pointsReversed, saleId, reason: number });
      if (pointsReversed > 0) ledger.push({ customerId: sale.customerId, type: "REVERSE", change: -pointsReversed, balanceAfter: after.points, saleId, reason: number });
      if (ledger.length) await tx.insert(pointLedger).values(ledger);
    }

    // Retur penuh = transaksi batal secara ekonomi: kuota voucher kembali (PRD §3.8 aturan 5).
    if (calc.isFull && sale.voucherId) {
      const reversed = await tx
        .update(voucherUsages)
        .set({ status: "REVERSED" })
        .where(and(eq(voucherUsages.saleId, saleId), eq(voucherUsages.status, "APPLIED")))
        .returning({ id: voucherUsages.id });
      if (reversed.length) await tx.update(vouchers).set({ quotaUsed: sql`greatest(${vouchers.quotaUsed} - 1, 0)` }).where(eq(vouchers.id, sale.voucherId));
    }

    await writeAudit(
      actor,
      {
        action: "refund",
        entity: "sale",
        entityId: saleId,
        after: { number, sale: sale.number, reasonCode: input.reasonCode, approvedBy: approver, refund: calc.refund, method: input.refundMethod, items: calc.items, restocked: restock.length, pointsReversed, pointsRestored, full: calc.isFull },
      },
      tx,
    );
    return ret.id;
  });
  return getReturn(actor, returnId);
}

export async function getReturn(actor: Actor, id: string) {
  const ret = await db.query.saleReturns.findFirst({
    where: eq(saleReturns.id, id),
    with: {
      sale: { columns: { id: true, number: true, total: true, refundTotal: true, cashierId: true } },
      branch: { columns: { id: true, name: true, code: true } },
      createdByUser: { columns: { name: true } },
      items: { with: { saleItem: { columns: { productName: true, variantTitle: true, sku: true, unitPrice: true } } } },
    },
  });
  if (!ret) throw notFound("Retur");
  const allowed = ["sale:read", "pos:refund", "pos:access"] as const;
  if (!allowed.some((p) => can(actor.access, p, ret.branchId))) throw forbidden("sale:read");
  return ret;
}

export async function listReturns(actor: Actor, params: { branchId?: string; q?: string; from?: string; to?: string; page: number; pageSize: number }) {
  const filters: (SQL | undefined)[] = [];
  const scope = branchScope(actor.access, "sale:read");
  if (scope !== "ALL") filters.push(scope.length ? inArray(saleReturns.branchId, scope) : sql`false`);
  if (params.branchId) filters.push(eq(saleReturns.branchId, params.branchId));
  if (params.q) filters.push(sql`(${ilike(saleReturns.number, `%${params.q}%`)} or ${ilike(sales.number, `%${params.q}%`)})`);
  if (params.from) filters.push(gte(saleReturns.createdAt, new Date(params.from)));
  if (params.to) filters.push(lt(saleReturns.createdAt, new Date(params.to)));
  const where = and(...filters);

  const qty = db
    .select({
      returnId: saleReturnItems.returnId,
      qty: sql<number>`sum(${saleReturnItems.qty})::int`.as("qty"),
      damaged: sql<number>`coalesce(sum(${saleReturnItems.qty}) filter (where not ${saleReturnItems.restock}), 0)::int`.as("damaged"),
    })
    .from(saleReturnItems)
    .groupBy(saleReturnItems.returnId)
    .as("ret_qty");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: saleReturns.id,
        number: saleReturns.number,
        saleId: saleReturns.saleId,
        saleNumber: sales.number,
        branchName: branches.name,
        createdByName: user.name,
        refundMethod: saleReturns.refundMethod,
        refundAmount: saleReturns.refundAmount,
        reasonCode: saleReturns.reasonCode,
        reason: saleReturns.reason,
        createdAt: saleReturns.createdAt,
        qty: sql<number>`coalesce(${qty.qty}, 0)`,
        damagedQty: sql<number>`coalesce(${qty.damaged}, 0)`,
      })
      .from(saleReturns)
      .innerJoin(sales, eq(sales.id, saleReturns.saleId))
      .innerJoin(branches, eq(branches.id, saleReturns.branchId))
      .innerJoin(user, eq(user.id, saleReturns.createdBy))
      .leftJoin(qty, eq(qty.returnId, saleReturns.id))
      .where(where)
      .orderBy(desc(saleReturns.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(saleReturns).innerJoin(sales, eq(sales.id, saleReturns.saleId)).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}
