import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, categories, inventoryLevels, products, productVariants, saleItems, salePayments, sales, shifts, type TaxSnapshot } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { env } from "@/server/env";
import { can } from "@/server/rbac/access";
import { computeTotals } from "@/lib/pricing";
import { writeAudit } from "./audit.service";
import { applyStockChanges } from "./inventory.service";
import { nextDocNumber } from "./numbering";
import { getSale } from "./sale.service";

/** Harga di paket offline berlaku untuk transaksi yang terjadi maks 48 jam setelah paket diterbitkan. */
const PACK_VALID_MS = 48 * 3_600_000;
/** Transaksi offline lebih tua dari ini ditolak (perangkat lama tidak tersinkron). */
const MAX_OFFLINE_AGE_MS = 7 * 86_400_000;

const packKey = () => Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "konten", "offline-price-pack", 32));

/** Tanda tangan harga: perangkat tidak bisa mengubah harga transaksi offline tanpa ketahuan. */
function priceSig(variantId: string, price: number, issuedAt: string) {
  return createHmac("sha256", packKey()).update(`${variantId}|${price}|${issuedAt}`).digest("base64url").slice(0, 22);
}

function taxOf(branch: typeof branches.$inferSelect): TaxSnapshot {
  const s = branch.settings ?? {};
  return { enabled: !!s.taxEnabled, rateBps: s.taxRateBps ?? 0, inclusive: s.taxInclusive ?? true };
}

/**
 * Paket offline untuk layar kasir: seluruh varian yang bisa dijual + harga bertanda tangan + stok tersedia
 * saat ini + kategori + pajak cabang. Disimpan di IndexedDB perangkat dan diperbarui berkala saat online.
 */
export async function offlinePack(actor: Actor, branchId: string) {
  if (!can(actor.access, "pos:access", branchId)) throw forbidden("pos:access");
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId));
  if (!branch) throw notFound("Cabang");
  const issuedAt = new Date().toISOString();
  const [rows, cats] = await Promise.all([
    db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        title: productVariants.title,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        price: productVariants.price,
        imageUrl: products.imageUrl,
        categoryId: products.categoryId,
        categoryName: categories.name,
        available: sql<number>`coalesce(${inventoryLevels.onHand} - ${inventoryLevels.reserved}, 0)::int`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(inventoryLevels, and(eq(inventoryLevels.variantId, productVariants.id), eq(inventoryLevels.branchId, branchId)))
      .where(and(eq(products.status, "ACTIVE"), eq(productVariants.isActive, true)))
      .orderBy(asc(products.name), asc(productVariants.createdAt), asc(productVariants.id)),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).orderBy(asc(categories.name)),
  ]);
  return {
    branchId,
    issuedAt,
    validUntil: new Date(Date.now() + PACK_VALID_MS).toISOString(),
    tax: taxOf(branch),
    categories: cats,
    items: rows.map((r) => ({ ...r, sig: priceSig(r.variantId, r.price, issuedAt) })),
  };
}

type PaymentMethod = "CASH" | "QRIS" | "DEBIT" | "CREDIT" | "TRANSFER" | "EWALLET";

export type OfflineSaleInput = {
  idempotencyKey: string;
  branchId: string;
  shiftId: string;
  localRef: string;
  createdAt: string;
  packIssuedAt: string;
  items: { variantId: string; qty: number; unitPrice: number; sig: string }[];
  payments: { method: PaymentMethod; amount: number; tendered?: number | null; reference?: string | null }[];
  note?: string | null;
};

/**
 * Sinkron satu transaksi yang dibuat saat offline. Idempoten (Idempotency-Key). Harga dipercaya hanya
 * bila tanda tangan paket cocok; waktu transaksi = waktu di perangkat; shift harus milik kasir & masih buka.
 * Barang sudah keluar dari toko, jadi bila stok sistem kurang, stok dipotong sebanyak yang ada dan
 * kekurangannya dicatat (`offline_shortfall`) untuk dicek/opname — transaksi tetap tercatat.
 */
export async function syncOfflineSale(actor: Actor, input: OfflineSaleInput) {
  const [replay] = await db.select({ id: sales.id, cashierId: sales.cashierId }).from(sales).where(eq(sales.idempotencyKey, input.idempotencyKey));
  if (replay) {
    if (replay.cashierId !== actor.userId) throw conflict("IDEMPOTENCY_KEY_REUSED", "Kunci transaksi sudah dipakai.");
    return { sale: await getSale(actor, replay.id), shortfall: [], replayed: true };
  }
  if (!can(actor.access, "pos:access", input.branchId)) throw forbidden("pos:access");

  const createdAt = new Date(input.createdAt);
  const issuedAt = new Date(input.packIssuedAt);
  const now = Date.now();
  if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() > now + 5 * 60_000) throw badRequest("OFFLINE_TIME_INVALID", "Waktu transaksi di perangkat tidak valid. Periksa jam perangkat.");
  if (now - createdAt.getTime() > MAX_OFFLINE_AGE_MS) throw conflict("OFFLINE_TOO_OLD", "Transaksi offline lebih dari 7 hari tidak bisa disinkronkan. Catat manual oleh admin.");
  if (createdAt.getTime() < issuedAt.getTime() - 60_000 || createdAt.getTime() - issuedAt.getTime() > PACK_VALID_MS) {
    throw conflict("OFFLINE_PACK_EXPIRED", "Paket harga offline sudah kedaluwarsa saat transaksi terjadi.");
  }
  for (const i of input.items) {
    const expected = priceSig(i.variantId, i.unitPrice, input.packIssuedAt);
    if (expected.length !== i.sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(i.sig))) {
      throw new ApiError(422, "OFFLINE_PRICE_INVALID", "Harga transaksi offline tidak cocok dengan paket harga resmi.");
    }
  }

  const [shift] = await db.select().from(shifts).where(eq(shifts.id, input.shiftId));
  if (!shift || shift.userId !== actor.userId || shift.branchId !== input.branchId) throw forbidden("Shift bukan milik kasir ini.");
  if (shift.status !== "OPEN") throw conflict("SHIFT_CLOSED", "Shift transaksi ini sudah ditutup. Minta admin mencatat transaksi secara manual.");
  const [branch] = await db.select().from(branches).where(eq(branches.id, input.branchId));

  // Gabungkan baris varian yang sama.
  const lines = new Map<string, { variantId: string; qty: number; unitPrice: number }>();
  for (const i of input.items) {
    const cur = lines.get(i.variantId);
    if (cur && cur.unitPrice !== i.unitPrice) throw badRequest("OFFLINE_PRICE_INVALID", "Harga varian yang sama berbeda dalam satu transaksi.");
    lines.set(i.variantId, { variantId: i.variantId, qty: (cur?.qty ?? 0) + i.qty, unitPrice: i.unitPrice });
  }
  const tax = taxOf(branch);
  const totals = computeTotals([...lines.values()].map((l) => ({ unitPrice: l.unitPrice, qty: l.qty })), tax);
  const paid = input.payments.reduce((s, p) => s + p.amount, 0);
  if (paid !== totals.total) throw badRequest("PAYMENT_MISMATCH", `Pembayaran ${paid.toLocaleString("id-ID")} tidak sama dengan total ${totals.total.toLocaleString("id-ID")}.`);

  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, title: productVariants.title, costPrice: productVariants.costPrice, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, [...lines.keys()]));
  if (variants.length !== lines.size) throw badRequest("ITEM_UNKNOWN", "Ada barang yang sudah dihapus dari sistem.");
  const byId = new Map(variants.map((v) => [v.id, v]));

  try {
    const result = await db.transaction(async (tx) => {
      // Kunci stok varian terkait lalu hitung yang bisa dipotong.
      const ids = [...lines.keys()];
      await tx.insert(inventoryLevels).values(ids.map((variantId) => ({ branchId: input.branchId, variantId }))).onConflictDoNothing();
      const levels = await tx
        .select({ variantId: inventoryLevels.variantId, onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved })
        .from(inventoryLevels)
        .where(and(eq(inventoryLevels.branchId, input.branchId), inArray(inventoryLevels.variantId, ids)))
        .orderBy(asc(inventoryLevels.variantId))
        .for("update");
      const availableOf = new Map(levels.map((l) => [l.variantId, Math.max(0, l.onHand - l.reserved)]));
      const shortfall: { variantId: string; sku: string; qty: number }[] = [];

      const number = await nextDocNumber(tx, "INV", branch);
      const [sale] = await tx
        .insert(sales)
        .values({
          number,
          branchId: input.branchId,
          shiftId: shift.id,
          cashierId: actor.userId,
          subtotal: totals.subtotal,
          discountTotal: 0,
          taxTotal: totals.taxTotal,
          total: totals.total,
          taxSnapshot: tax,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey,
          offlineRef: input.localRef,
          syncedAt: new Date(),
          createdAt,
        })
        .returning({ id: sales.id });
      await tx.insert(saleItems).values(
        [...lines.values()].map((l) => {
          const v = byId.get(l.variantId)!;
          return { saleId: sale.id, variantId: l.variantId, productName: v.productName, variantTitle: v.title, sku: v.sku, qty: l.qty, unitPrice: l.unitPrice, costPrice: v.costPrice, discount: 0, lineTotal: l.unitPrice * l.qty };
        }),
      );
      await tx.insert(salePayments).values(
        input.payments.map((p) => {
          const tendered = p.method === "CASH" ? (p.tendered ?? p.amount) : null;
          return { saleId: sale.id, method: p.method, amount: p.amount, tendered, change: tendered ? Math.max(0, tendered - p.amount) : 0, reference: p.reference ?? null };
        }),
      );
      const changes = [...lines.values()]
        .map((l) => {
          const take = Math.min(l.qty, availableOf.get(l.variantId) ?? 0);
          if (take < l.qty) shortfall.push({ variantId: l.variantId, sku: byId.get(l.variantId)!.sku, qty: l.qty - take });
          return { branchId: input.branchId, variantId: l.variantId, qtyChange: -take, type: "SALE" as const, reason: `${number} (offline ${input.localRef})`, referenceType: "sale", referenceId: sale.id };
        })
        .filter((c) => c.qtyChange < 0);
      await applyStockChanges(tx, actor, changes);
      if (shortfall.length) await tx.update(sales).set({ offlineShortfall: shortfall }).where(eq(sales.id, sale.id));
      await writeAudit(actor, { action: "sync_offline", entity: "sale", entityId: sale.id, after: { number, localRef: input.localRef, createdAt: input.createdAt, total: totals.total, shortfall } }, tx);
      return { saleId: sale.id, shortfall };
    });
    return { sale: await getSale(actor, result.saleId), shortfall: result.shortfall, replayed: false };
  } catch (error) {
    const pg = (error as { cause?: { constraint_name?: string } }).cause;
    if (pg?.constraint_name === "sales_idempotency_uq") {
      const [again] = await db.select({ id: sales.id }).from(sales).where(eq(sales.idempotencyKey, input.idempotencyKey));
      if (again) return { sale: await getSale(actor, again.id), shortfall: [], replayed: true };
    }
    throw error;
  }
}
