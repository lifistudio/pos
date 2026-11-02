import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import {
  branches,
  categories,
  customers,
  inventoryLevels,
  membershipTiers,
  numberSequences,
  pointLedger,
  products,
  productVariants,
  saleItems,
  salePayments,
  saleReturns,
  sales,
  shifts,
  user,
  voucherUsages,
  vouchers,
  type TaxSnapshot,
} from "@/server/db/schema";
import { inCategoryTree, matchAllTerms } from "@/server/db/search";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { branchScope, can } from "@/server/rbac/access";
import { pointsFor, priceCart } from "@/lib/pricing";
import { writeAudit } from "./audit.service";
import { tierForSpend } from "./customer.service";
import { applyStockChanges } from "./inventory.service";
import { getPaymentProvider, mockProvider } from "@/server/payments/provider";
import type { TerminalReceipt } from "@/lib/payment-terminal";
import { authorizeOrApprove } from "./approval.service";
import { getStorePolicy } from "./settings.service";
import { claimVoucherQuota, resolveVoucher } from "./voucher.service";

type PaymentMethod = (typeof salePayments.$inferInsert)["method"];
export type ManualDiscountInput = { type: "NOMINAL" | "PERCENT"; value: number; reason: string };

export type CheckoutInput = {
  branchId: string;
  idempotencyKey: string;
  customerId?: string | null;
  voucherCode?: string | null;
  /** Poin member yang ditukar (sesuai pratinjau /pos/quote). */
  pointsRedeem?: number | null;
  /** Diskon manual kasir; tanpa hak `pos:discount_manual` wajib `approvalId` dari PIN atasan. */
  manualDiscount?: ManualDiscountInput | null;
  approvalId?: string | null;
  items: { variantId: string; qty: number }[];
  payments: { method: PaymentMethod; amount: number; tendered?: number | null; reference?: string | null; terminal?: TerminalReceipt | null }[];
  note?: string | null;
};

// ── Cabang & shift ──────────────────────────────────────────────────────

async function getPosBranch(actor: Actor, branchId: string) {
  if (!can(actor.access, "pos:access", branchId)) throw forbidden("pos:access");
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId));
  if (!branch) throw notFound("Cabang");
  if (!branch.isActive) throw conflict("BRANCH_INACTIVE", "Cabang ini sedang nonaktif.");
  if (branch.type === "WAREHOUSE") throw conflict("BRANCH_NOT_STORE", "Gudang tidak bisa dipakai untuk berjualan. Pilih cabang toko.");
  return branch;
}

function taxOf(branch: typeof branches.$inferSelect): TaxSnapshot {
  const s = branch.settings ?? {};
  return { enabled: !!s.taxEnabled, rateBps: s.taxRateBps ?? 0, inclusive: s.taxInclusive ?? true };
}

export async function getCurrentShift(actor: Actor, branchId: string) {
  const branch = await getPosBranch(actor, branchId);
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, actor.userId), eq(shifts.branchId, branchId), eq(shifts.status, "OPEN")));
  return {
    shift: shift ?? null,
    branch: { id: branch.id, code: branch.code, name: branch.name, tax: taxOf(branch) },
    qris: { dynamic: !!getPaymentProvider(), simulator: !!mockProvider() },
  };
}

export async function openShift(actor: Actor, input: { branchId: string; openingCash: number }) {
  await getPosBranch(actor, input.branchId);
  try {
    const [shift] = await db.insert(shifts).values({ branchId: input.branchId, userId: actor.userId, openingCash: input.openingCash }).returning();
    await writeAudit(actor, { action: "open", entity: "shift", entityId: shift.id, after: shift });
    return shift;
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505" || (error as { code?: string }).code === "23505") {
      throw conflict("SHIFT_ALREADY_OPEN", "Anda masih punya shift terbuka di cabang ini.");
    }
    throw error;
  }
}

/** Ringkasan shift dalam 2 query agregat (bukan per transaksi). */
export async function getShiftSummary(actor: Actor, shiftId: string) {
  const [shift] = await db
    .select({ shift: shifts, userName: user.name, branchName: branches.name })
    .from(shifts)
    .innerJoin(user, eq(user.id, shifts.userId))
    .innerJoin(branches, eq(branches.id, shifts.branchId))
    .where(eq(shifts.id, shiftId));
  if (!shift) throw notFound("Shift");
  const own = shift.shift.userId === actor.userId;
  if (!own && !can(actor.access, "sale:read", shift.shift.branchId)) throw forbidden("sale:read");

  const [[saleAgg], byMethod, [refundAgg]] = await Promise.all([
    db
      .select({
        paidCount: sql<number>`count(*) filter (where ${sales.status} = 'PAID')::int`,
        voidCount: sql<number>`count(*) filter (where ${sales.status} = 'VOIDED')::int`,
        revenue: sql<number>`coalesce(sum(${sales.total}) filter (where ${sales.status} = 'PAID'), 0)::bigint`.mapWith(Number),
        taxTotal: sql<number>`coalesce(sum(${sales.taxTotal}) filter (where ${sales.status} = 'PAID'), 0)::bigint`.mapWith(Number),
      })
      .from(sales)
      .where(eq(sales.shiftId, shiftId)),
    db
      .select({
        method: salePayments.method,
        amount: sql<number>`coalesce(sum(${salePayments.amount}), 0)::bigint`.mapWith(Number),
        count: sql<number>`count(*)::int`,
      })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(eq(sales.shiftId, shiftId), eq(sales.status, "PAID")))
      .groupBy(salePayments.method),
    db
      .select({
        refundCount: sql<number>`count(*)::int`,
        refundTotal: sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)::bigint`.mapWith(Number),
        cashRefund: sql<number>`coalesce(sum(${saleReturns.refundAmount}) filter (where ${saleReturns.refundMethod} = 'CASH'), 0)::bigint`.mapWith(Number),
      })
      .from(saleReturns)
      .where(eq(saleReturns.shiftId, shiftId)),
  ]);

  // Tunai keluar untuk retur diambil dari laci shift ini.
  const cashIn = (byMethod.find((m) => m.method === "CASH")?.amount ?? 0) - refundAgg.cashRefund;
  return {
    shift: shift.shift,
    cashierName: shift.userName,
    branchName: shift.branchName,
    ...saleAgg,
    ...refundAgg,
    payments: byMethod,
    expectedCash: shift.shift.openingCash + cashIn,
  };
}

/**
 * Transaksi kas memegang kunci bersama pada baris shift (lihat `lockOpenShift`), tutup shift memegang kunci eksklusif.
 * Jadi tutup shift menunggu transaksi yang sedang berjalan, dan tidak ada transaksi masuk setelah angka kas dihitung.
 */
async function lockOpenShift(tx: Tx, shiftId: string) {
  const [row] = await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shiftId)).for("share");
  return row?.status === "OPEN";
}

export async function closeShift(actor: Actor, shiftId: string, input: { countedCash: number; note?: string | null }) {
  const { shift } = await getShiftSummary(actor, shiftId);
  if (shift.userId !== actor.userId && !can(actor.access, "pos:void", shift.branchId)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya kasir pemilik shift atau kepala toko yang bisa menutup shift.");
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shiftId)).for("update");
    if (locked?.status !== "OPEN") throw conflict("SHIFT_CLOSED", "Shift ini sudah ditutup.");
    const [{ pending }] = await tx.select({ pending: count() }).from(sales).where(and(eq(sales.shiftId, shiftId), eq(sales.status, "PENDING")));
    if (pending > 0) throw conflict("SHIFT_HAS_PENDING_QRIS", "Masih ada QRIS yang menunggu pembayaran. Selesaikan atau batalkan dulu.");
    // Dihitung setelah kunci didapat, agar transaksi yang tadi berjalan ikut terhitung.
    const summary = await getShiftSummary(actor, shiftId);
    const [closed] = await tx
      .update(shifts)
      .set({ status: "CLOSED", closedAt: new Date(), countedCash: input.countedCash, expectedCash: summary.expectedCash, note: input.note ?? null })
      .where(eq(shifts.id, shiftId))
      .returning();
    await writeAudit(
      actor,
      {
        action: "close",
        entity: "shift",
        entityId: shiftId,
        after: { expectedCash: summary.expectedCash, countedCash: input.countedCash, difference: input.countedCash - summary.expectedCash },
      },
      tx,
    );
    return { ...summary, shift: closed, difference: input.countedCash - summary.expectedCash };
  });
}

// ── Katalog kasir ───────────────────────────────────────────────────────

/** Varian aktif yang bisa dijual + stok tersedia di cabang. Satu query (join), dipaginasi. */
export async function posCatalog(actor: Actor, params: { branchId: string; q?: string; categoryId?: string; page: number; pageSize: number }) {
  if (!can(actor.access, "pos:access", params.branchId)) throw forbidden("pos:access");
  const filters: (SQL | undefined)[] = [eq(products.status, "ACTIVE"), eq(productVariants.isActive, true)];
  if (params.categoryId) filters.push(inCategoryTree(products.categoryId, params.categoryId));
  if (params.q) {
    filters.push(
      sql`(${productVariants.barcode} = ${params.q} or ${matchAllTerms(params.q, [products.name, productVariants.title, productVariants.sku])})`,
    );
  }
  const where = and(...filters);
  const base = db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      title: productVariants.title,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      price: productVariants.price,
      imageUrl: products.imageUrl,
      categoryName: categories.name,
      available: sql<number>`coalesce(${inventoryLevels.onHand} - ${inventoryLevels.reserved}, 0)::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(inventoryLevels, and(eq(inventoryLevels.variantId, productVariants.id), eq(inventoryLevels.branchId, params.branchId)));

  const [rows, [{ total }]] = await Promise.all([
    base
      .where(where)
      .orderBy(
        params.q ? sql`case when ${productVariants.barcode} = ${params.q} or upper(${productVariants.sku}) = upper(${params.q}) then 0 else 1 end` : sql`1`,
        asc(products.name),
        asc(productVariants.createdAt),
      )
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db
      .select({ total: count() })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

// ── Checkout ────────────────────────────────────────────────────────────

/** INV/BDG/261017/0001 — nomor naik atomik per cabang per hari (zona waktu cabang). */
async function nextInvoiceNumber(tx: Tx, branch: { code: string; timezone: string }) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: branch.timezone, year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const ymd = ["year", "month", "day"].map((t) => parts.find((p) => p.type === t)!.value).join("");
  const key = `INV/${branch.code}/${ymd}`;
  const [row] = await tx
    .insert(numberSequences)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: numberSequences.key, set: { value: sql`${numberSequences.value} + 1` } })
    .returning({ value: numberSequences.value });
  return `${key}/${String(row.value).padStart(4, "0")}`;
}

async function findByIdempotency(actor: Actor, input: Pick<CheckoutInput, "idempotencyKey" | "items">, mode: "PAID" | "PENDING") {
  const [existing] = await db.select({ id: sales.id, cashierId: sales.cashierId }).from(sales).where(eq(sales.idempotencyKey, input.idempotencyKey));
  if (!existing) return null;
  if (existing.cashierId !== actor.userId) throw conflict("IDEMPOTENCY_KEY_REUSED", "Kunci transaksi sudah dipakai.");
  const sale = await getSale(actor, existing.id);
  // Kunci sama untuk keranjang berbeda bukan percobaan ulang: mengembalikan transaksi lama berarti barang baru tidak tercatat.
  const qtyOf = (rows: { variantId: string; qty: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.variantId, (m.get(r.variantId) ?? 0) + r.qty);
    return [...m].sort(([a], [b]) => a.localeCompare(b)).join("|");
  };
  if (qtyOf(sale.items) !== qtyOf(input.items)) throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Kunci transaksi sudah dipakai untuk keranjang lain. Ulangi pembayaran.");
  // Bayar tunai dengan kunci QRIS yang belum lunas: jangan laporkan seolah transaksi sudah dibayar.
  if (mode === "PAID" && sale.status !== "PAID") throw conflict("SALE_NOT_PAID", "Transaksi ini masih menunggu QRIS atau sudah dibatalkan. Selesaikan dulu, atau ulangi pembayaran.");
  return sale;
}

/**
 * Susun keranjang dari database: harga resmi, rantai kategori (untuk target voucher), customer & tier,
 * lalu hitung diskon member + voucher + PPN dengan mesin harga bersama. Dipakai /pos/quote dan checkout.
 */
async function buildCart(
  q: Tx | typeof db,
  params: {
    branch: typeof branches.$inferSelect;
    items: { variantId: string; qty: number }[];
    customerId?: string | null;
    voucherCode?: string | null;
    pointsRedeem?: number | null;
    manualDiscount?: ManualDiscountInput | null;
  },
) {
  const qtyByVariant = new Map<string, number>();
  for (const i of params.items) qtyByVariant.set(i.variantId, (qtyByVariant.get(i.variantId) ?? 0) + i.qty);
  const ids = [...qtyByVariant.keys()];

  const [variantRows, allCategories, customerRow, policy] = await Promise.all([
    q
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        title: productVariants.title,
        price: productVariants.price,
        costPrice: productVariants.costPrice,
        isActive: productVariants.isActive,
        productId: products.id,
        productName: products.name,
        productStatus: products.status,
        categoryId: products.categoryId,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, ids)),
    // Kategori jumlahnya kecil; rantai induk dihitung di memori (1 query, bukan per baris).
    q.select({ id: categories.id, parentId: categories.parentId }).from(categories),
    params.customerId
      ? q
          .select({
            id: customers.id,
            name: customers.name,
            isMember: customers.isMember,
            tierId: customers.tierId,
            points: customers.points,
            discountBps: membershipTiers.discountBps,
            pointsPer10k: membershipTiers.pointsPer10k,
          })
          .from(customers)
          .leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId))
          .where(eq(customers.id, params.customerId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    getStorePolicy(q),
  ]);
  if (params.customerId && !customerRow) throw notFound("Customer");
  if ((params.pointsRedeem ?? 0) > 0 && !customerRow?.isMember) throw new ApiError(422, "POINTS_MEMBER_ONLY", "Tukar poin hanya untuk member.");

  const unavailable = ids.filter((id) => {
    const v = variantRows.find((r) => r.id === id);
    return !v || !v.isActive || v.productStatus !== "ACTIVE";
  });
  if (unavailable.length) throw badRequest("ITEM_UNAVAILABLE", "Ada barang yang sudah tidak dijual. Hapus dari keranjang.", { variantIds: unavailable });

  const parentOf = new Map(allCategories.map((c) => [c.id, c.parentId]));
  const chain = (id: string | null) => {
    const out: string[] = [];
    for (let cur = id, guard = 0; cur && guard < 5; cur = parentOf.get(cur) ?? null, guard++) out.push(cur);
    return out;
  };

  const voucher = params.voucherCode
    ? await resolveVoucher(q, {
        code: params.voucherCode,
        branchId: params.branch.id,
        customer: customerRow ? { id: customerRow.id, isMember: customerRow.isMember, tierId: customerRow.tierId } : null,
      })
    : null;

  const memberDiscountBps = customerRow?.isMember ? (customerRow.discountBps ?? 0) : 0;
  const tax = taxOf(params.branch);
  const pricing = priceCart(
    variantRows.map((v) => ({ variantId: v.id, productId: v.productId, categoryIds: chain(v.categoryId), unitPrice: v.price, qty: qtyByVariant.get(v.id)! })),
    {
      memberDiscountBps,
      voucher: voucher?.rule ?? null,
      tax,
      points: customerRow?.isMember
        ? { requested: params.pointsRedeem ?? 0, balance: customerRow.points, pointValue: policy.pointValue, minRedeem: policy.minRedeemPoints, maxBps: policy.maxRedeemBps }
        : null,
      manual: params.manualDiscount ? { type: params.manualDiscount.type, value: params.manualDiscount.value, maxBps: policy.maxManualDiscountBps } : null,
    },
  );
  const pointsPer10k = customerRow?.isMember ? (customerRow.pointsPer10k ?? 0) : 0;
  return { variantRows, customer: customerRow, voucher, pricing, tax, memberDiscountBps, pointsEarned: pointsFor(pricing.total, pointsPer10k) };
}

/** Pratinjau total untuk layar kasir (tanpa menyimpan apa pun). */
export async function quoteCart(
  actor: Actor,
  input: {
    branchId: string;
    items: { variantId: string; qty: number }[];
    customerId?: string | null;
    voucherCode?: string | null;
    pointsRedeem?: number | null;
    manualDiscount?: ManualDiscountInput | null;
  },
) {
  const branch = await getPosBranch(actor, input.branchId);
  let voucherError: { code: string; message: string } | null = null;
  let cart;
  try {
    cart = await buildCart(db, { branch, ...input });
  } catch (error) {
    // Voucher ditolak karena syarat database: tetap kembalikan total tanpa voucher + alasannya.
    if (error instanceof ApiError && error.status === 422 && input.voucherCode) {
      voucherError = { code: error.code, message: error.message };
      cart = await buildCart(db, { branch, ...input, voucherCode: null });
    } else throw error;
  }
  const { pricing } = cart;
  return {
    /** Harga sebelum diskon. `subtotal` = setelah diskon member & voucher (dasar PPN). */
    gross: pricing.subtotal + pricing.discountTotal,
    subtotal: pricing.subtotal,
    memberDiscount: pricing.memberDiscount,
    memberDiscountBps: cart.memberDiscountBps,
    voucherDiscount: pricing.voucherDiscount,
    pointsDiscount: pricing.pointsDiscount,
    points: pricing.points,
    manualDiscount: pricing.manualDiscount,
    manual: pricing.manual,
    /** Kasir tanpa hak diskon manual perlu PIN atasan saat bayar. */
    manualNeedsApproval: pricing.manualDiscount > 0 && !can(actor.access, "pos:discount_manual", branch.id),
    taxTotal: pricing.taxTotal,
    total: pricing.total,
    pointsEarned: cart.pointsEarned,
    voucher: voucherError
      ? { code: input.voucherCode!.trim().toUpperCase(), applied: false, reason: voucherError.message }
      : pricing.voucher && { code: pricing.voucher.code, applied: pricing.voucher.applied, reason: pricing.voucher.reason },
    lines: pricing.lines.map((l) => ({ variantId: l.variantId, memberDiscount: l.memberDiscount, voucherDiscount: l.voucherDiscount, manualDiscount: l.manualDiscount, pointsDiscount: l.pointsDiscount, lineTotal: l.lineTotal })),
  };
}

export { lockOpenShift };

export async function checkout(actor: Actor, input: CheckoutInput) {
  return createSale(actor, input, "PAID");
}

/**
 * QRIS dinamis di kasir: transaksi dibuat berstatus PENDING (harga, voucher, stok, poin tukar dikunci),
 * pembayaran dicatat saat gateway mengonfirmasi lunas. Tidak dibayar → dibalik seperti void.
 */
export async function createPendingQrisSale(actor: Actor, input: Omit<CheckoutInput, "payments">) {
  return createSale(actor, { ...input, payments: [] }, "PENDING");
}

async function createSale(actor: Actor, input: CheckoutInput, mode: "PAID" | "PENDING") {
  const replay = await findByIdempotency(actor, input, mode);
  if (replay) return replay;

  const branch = await getPosBranch(actor, input.branchId);
  const [shift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, actor.userId), eq(shifts.branchId, branch.id), eq(shifts.status, "OPEN")));
  if (!shift) throw conflict("NO_OPEN_SHIFT", "Buka shift terlebih dahulu sebelum berjualan.");

  // Pratinjau di luar transaksi agar pesan voucher/pembayaran cepat; dihitung ulang di dalam transaksi.
  const cartParams = { branch, items: input.items, customerId: input.customerId, voucherCode: input.voucherCode, pointsRedeem: input.pointsRedeem, manualDiscount: input.manualDiscount };
  if (input.manualDiscount && input.manualDiscount.reason.trim().length < 3) throw badRequest("DISCOUNT_REASON_REQUIRED", "Tuliskan alasan diskon manual.");
  const preview = await buildCart(db, cartParams);
  if (preview.pricing.voucher && !preview.pricing.voucher.applied) throw new ApiError(422, "VOUCHER_NOT_APPLICABLE", preview.pricing.voucher.reason!);
  if (preview.pricing.points?.reason) throw new ApiError(422, "POINTS_NOT_APPLICABLE", preview.pricing.points.reason);

  const cash = input.payments.filter((p) => p.method === "CASH");
  if (cash.length > 1) throw badRequest("PAYMENT_INVALID", "Pembayaran tunai cukup satu baris.");
  const paid = input.payments.reduce((s, p) => s + p.amount, 0);
  if (mode === "PAID" && paid !== preview.pricing.total) {
    throw badRequest("PAYMENT_MISMATCH", `Pembayaran ${paid.toLocaleString("id-ID")} tidak sama dengan total ${preview.pricing.total.toLocaleString("id-ID")}.`, {
      total: preview.pricing.total,
    });
  }
  const payments = input.payments.map((p) => {
    if (p.terminal && p.method !== "DEBIT" && p.method !== "CREDIT" && p.method !== "QRIS") {
      throw badRequest("PAYMENT_INVALID", "Data mesin EDC hanya untuk pembayaran kartu atau QRIS di EDC.");
    }
    if (p.terminal?.provider === "simulator" && !mockProvider()) {
      throw badRequest("PAYMENT_INVALID", "EDC simulasi hanya untuk latihan (aktif bersama simulator pembayaran, tidak di produksi).");
    }
    if (p.method === "CASH") {
      const tendered = p.tendered ?? p.amount;
      if (tendered < p.amount) throw badRequest("CASH_INSUFFICIENT", "Uang tunai yang diterima kurang dari tagihan.");
      return { ...p, tendered, change: tendered - p.amount };
    }
    return { ...p, tendered: null, change: 0 };
  });

  try {
    const saleId = await db.transaction(async (tx) => {
      if (!(await lockOpenShift(tx, shift.id))) throw conflict("NO_OPEN_SHIFT", "Shift baru saja ditutup. Buka shift lagi sebelum berjualan.");
      // Kunci baris customer: kuota per-customer & saldo poin aman dari dua kasir bersamaan.
      if (input.customerId) await tx.execute(sql`select 1 from customers where id = ${input.customerId} for update`);
      const cart = await buildCart(tx, cartParams);
      const { pricing } = cart;
      if (pricing.total !== preview.pricing.total) throw conflict("PRICE_CHANGED", "Harga atau voucher berubah saat pembayaran. Periksa total lalu bayar ulang.");
      if (cart.voucher) await claimVoucherQuota(tx, cart.voucher.id);
      // Diskon manual: hak sendiri, atau izin PIN atasan sekali pakai.
      const discountApprover =
        pricing.manualDiscount > 0 ? ((await authorizeOrApprove(tx, actor, "pos:discount_manual", branch.id, input.approvalId, `sale:${input.idempotencyKey}`)) ?? actor.userId) : null;

      const number = await nextInvoiceNumber(tx, branch);
      const [sale] = await tx
        .insert(sales)
        .values({
          number,
          branchId: branch.id,
          shiftId: shift.id,
          cashierId: actor.userId,
          customerId: cart.customer?.id ?? null,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          memberDiscount: pricing.memberDiscount,
          voucherId: cart.voucher?.id ?? null,
          voucherCode: cart.voucher?.rule.code ?? null,
          voucherDiscount: pricing.voucherDiscount,
          pointsRedeemed: pricing.points?.redeemed ?? 0,
          pointsDiscount: pricing.pointsDiscount,
          manualDiscount: pricing.manualDiscount,
          manualDiscountReason: pricing.manualDiscount > 0 ? input.manualDiscount!.reason.trim() : null,
          manualDiscountApprovedBy: discountApprover,
          taxTotal: pricing.taxTotal,
          total: pricing.total,
          pointsEarned: cart.pointsEarned,
          taxSnapshot: cart.tax,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey,
          status: mode,
        })
        .returning({ id: sales.id });

      const byId = new Map(cart.variantRows.map((v) => [v.id, v]));
      await tx.insert(saleItems).values(
        pricing.lines.map((l) => {
          const v = byId.get(l.variantId)!;
          return {
            saleId: sale.id,
            variantId: v.id,
            productName: v.productName,
            variantTitle: v.title,
            sku: v.sku,
            qty: l.qty,
            unitPrice: l.unitPrice,
            costPrice: v.costPrice,
            discount: l.memberDiscount + l.voucherDiscount + l.manualDiscount + l.pointsDiscount,
            lineTotal: l.lineTotal,
          };
        }),
      );
      if (payments.length) {
        await tx.insert(salePayments).values(
          payments.map((p) => ({ saleId: sale.id, method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, reference: p.reference ?? null, terminal: p.terminal ?? null })),
        );
      }

      if (cart.voucher) {
        await tx.insert(voucherUsages).values({ voucherId: cart.voucher.id, saleId: sale.id, customerId: cart.customer?.id ?? null, discount: pricing.voucherDiscount, saleTotal: pricing.total });
      }
      if (cart.customer) {
        const redeemed = pricing.points?.redeemed ?? 0;
        // Poin tukar dikunci sekarang (juga untuk QRIS yang belum dibayar); poin & statistik belanja menyusul saat lunas.
        await debitRedeemedPoints(tx, { customerId: cart.customer.id, saleId: sale.id, number, redeemed });
        if (mode === "PAID") await creditCustomer(tx, { customerId: cart.customer.id, saleId: sale.id, number, total: pricing.total, earned: cart.pointsEarned });
      }

      await applyStockChanges(
        tx,
        actor,
        pricing.lines.map((l) => ({
          branchId: branch.id,
          variantId: l.variantId,
          qtyChange: -l.qty,
          type: "SALE" as const,
          reason: number,
          referenceType: "sale",
          referenceId: sale.id,
        })),
      );
      await writeAudit(
        actor,
        {
          action: "create",
          entity: "sale",
          entityId: sale.id,
          after: {
            number,
            total: pricing.total,
            items: pricing.lines.length,
            voucher: cart.voucher?.rule.code ?? null,
            customerId: cart.customer?.id ?? null,
            pointsRedeemed: pricing.points?.redeemed ?? 0,
            manualDiscount: pricing.manualDiscount,
            manualDiscountApprovedBy: discountApprover,
            status: mode,
          },
        },
        tx,
      );
      return sale.id;
    });
    return getSale(actor, saleId);
  } catch (error) {
    // Dua request dengan kunci sama bersamaan: yang kalah mengembalikan transaksi pemenang.
    const pg = (error as { cause?: { constraint_name?: string } }).cause;
    if (pg?.constraint_name === "sales_idempotency_uq") {
      const again = await findByIdempotency(actor, input, mode);
      if (again) return again;
    }
    if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
      const ids = ((error.details as { items?: { variantId: string }[] })?.items ?? []).map((i) => i.variantId);
      const names = preview.variantRows.filter((v) => ids.includes(v.id)).map((v) => (v.title === "Default" ? v.productName : `${v.productName} ${v.title}`));
      throw new ApiError(409, "INSUFFICIENT_STOCK", `Stok tidak cukup: ${names.join(", ") || "beberapa barang"}.`, error.details);
    }
    throw error;
  }
}

// ── Detail, daftar, void ────────────────────────────────────────────────

function canViewSale(actor: Actor, sale: { branchId: string; cashierId: string }) {
  return (
    can(actor.access, "sale:read", sale.branchId) ||
    // Yang berwenang meretur di cabang ini perlu membuka struknya.
    can(actor.access, "pos:refund", sale.branchId) ||
    // Kasir cabang perlu membuka struk cabangnya untuk retur dengan persetujuan PIN.
    can(actor.access, "pos:access", sale.branchId) ||
    (sale.cashierId === actor.userId && can(actor.access, "pos:access", sale.branchId))
  );
}

/** Cari struk persis berdasarkan nomor (untuk retur di kasir: scan/ketik nomor di struk). */
export async function findSaleByNumber(actor: Actor, number: string) {
  const [row] = await db.select({ id: sales.id }).from(sales).where(eq(sales.number, number.trim().toUpperCase()));
  if (!row) throw notFound("Transaksi");
  return getSale(actor, row.id);
}

/** Detail lengkap untuk struk: 1 relational query. */
export async function getSale(actor: Actor, id: string) {
  const sale = await db.query.sales.findFirst({
    where: eq(sales.id, id),
    with: {
      items: { orderBy: asc(saleItems.productName) },
      payments: true,
      branch: { columns: { id: true, code: true, name: true, address: true, phone: true, settings: true, timezone: true } },
      cashier: { columns: { id: true, name: true } },
      customer: { columns: { id: true, name: true, memberNo: true, points: true } },
      returns: {
        orderBy: asc(saleReturns.createdAt),
        columns: { id: true, number: true, refundMethod: true, refundAmount: true, pointsReversed: true, pointsRestored: true, reason: true, createdAt: true },
        with: { createdByUser: { columns: { name: true } }, items: { columns: { saleItemId: true, qty: true, restock: true } } },
      },
    },
  });
  if (!sale) throw notFound("Transaksi");
  if (!canViewSale(actor, sale)) throw forbidden("sale:read");
  const showCost = can(actor.access, "product:view_cost");
  return { ...sale, items: sale.items.map(({ costPrice, ...i }) => ({ ...i, costPrice: showCost ? costPrice : undefined })) };
}

export async function listSales(
  actor: Actor,
  params: { branchId?: string; shiftId?: string; q?: string; status?: "PENDING" | "PAID" | "VOIDED"; from?: string; to?: string; page: number; pageSize: number },
) {
  const filters: (SQL | undefined)[] = [];
  let ownShift = false;
  if (params.shiftId) {
    const [shift] = await db.select({ userId: shifts.userId, branchId: shifts.branchId }).from(shifts).where(eq(shifts.id, params.shiftId));
    if (!shift) throw notFound("Shift");
    ownShift = shift.userId === actor.userId;
    filters.push(eq(sales.shiftId, params.shiftId));
  }
  if (!ownShift) {
    const scope = branchScope(actor.access, "sale:read");
    if (scope !== "ALL") filters.push(scope.length ? inArray(sales.branchId, scope) : sql`false`);
  }
  if (params.branchId) filters.push(eq(sales.branchId, params.branchId));
  if (params.status) filters.push(eq(sales.status, params.status));
  if (params.q) filters.push(ilike(sales.number, `%${params.q}%`));
  if (params.from) filters.push(gte(sales.createdAt, new Date(params.from)));
  if (params.to) filters.push(lt(sales.createdAt, new Date(params.to)));
  const where = and(...filters);

  const itemCount = db
    .select({ saleId: saleItems.saleId, qty: sql<number>`sum(${saleItems.qty})::int`.as("qty") })
    .from(saleItems)
    .groupBy(saleItems.saleId)
    .as("item_count");
  const methods = db
    .select({ saleId: salePayments.saleId, methods: sql<string[]>`array_agg(distinct ${salePayments.method})`.as("methods") })
    .from(salePayments)
    .groupBy(salePayments.saleId)
    .as("methods");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: sales.id,
        number: sales.number,
        status: sales.status,
        total: sales.total,
        refundTotal: sales.refundTotal,
        createdAt: sales.createdAt,
        branchName: branches.name,
        cashierName: user.name,
        itemQty: sql<number>`coalesce(${itemCount.qty}, 0)`,
        methods: methods.methods,
      })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .innerJoin(user, eq(user.id, sales.cashierId))
      .leftJoin(itemCount, eq(itemCount.saleId, sales.id))
      .leftJoin(methods, eq(methods.saleId, sales.id))
      .where(where)
      .orderBy(desc(sales.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(sales).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

// ── Poin & statistik customer ───────────────────────────────────────────

async function debitRedeemedPoints(tx: Tx, p: { customerId: string; saleId: string; number: string; redeemed: number }) {
  if (p.redeemed <= 0) return;
  const [u] = await tx
    .update(customers)
    .set({ points: sql`${customers.points} - ${p.redeemed}` })
    .where(eq(customers.id, p.customerId))
    .returning({ points: customers.points });
  await tx.insert(pointLedger).values({ customerId: p.customerId, type: "REDEEM", change: -p.redeemed, balanceAfter: u.points, saleId: p.saleId, reason: p.number });
}

/** Saat transaksi lunas: poin didapat, total belanja, kunjungan, dan naik tier otomatis. */
async function creditCustomer(tx: Tx, p: { customerId: string; saleId: string; number: string; total: number; earned: number }) {
  const [updated] = await tx
    .update(customers)
    .set({
      points: sql`${customers.points} + ${p.earned}`,
      totalSpent: sql`${customers.totalSpent} + ${p.total}`,
      visitCount: sql`${customers.visitCount} + 1`,
      lastVisitAt: new Date(),
    })
    .where(eq(customers.id, p.customerId))
    .returning({ points: customers.points, totalSpent: customers.totalSpent, isMember: customers.isMember, tierId: customers.tierId });
  if (p.earned > 0) await tx.insert(pointLedger).values({ customerId: p.customerId, type: "EARN", change: p.earned, balanceAfter: updated.points, saleId: p.saleId, reason: p.number });
  if (updated.isMember) {
    const tierId = await tierForSpend(tx, updated.totalSpent);
    if (tierId && tierId !== updated.tierId) await tx.update(customers).set({ tierId }).where(eq(customers.id, p.customerId));
  }
}

/**
 * Balik efek transaksi: stok kembali (RETURN), kuota voucher, poin tukar dikembalikan; bila transaksi
 * sudah lunas (`wasPaid`) poin didapat ditarik dan statistik belanja dikurangi.
 */
async function reverseSaleEffects(tx: Tx, actor: Actor | null, sale: typeof sales.$inferSelect, label: string, wasPaid: boolean) {
  const items = await tx.select({ variantId: saleItems.variantId, qty: saleItems.qty }).from(saleItems).where(eq(saleItems.saleId, sale.id));
  await applyStockChanges(
    tx,
    actor,
    items.map((i) => ({ branchId: sale.branchId, variantId: i.variantId, qtyChange: i.qty, type: "RETURN" as const, reason: label, referenceType: "sale", referenceId: sale.id })),
  );
  if (sale.voucherId) {
    const reversed = await tx
      .update(voucherUsages)
      .set({ status: "REVERSED" })
      .where(and(eq(voucherUsages.saleId, sale.id), eq(voucherUsages.status, "APPLIED")))
      .returning({ id: voucherUsages.id });
    if (reversed.length) await tx.update(vouchers).set({ quotaUsed: sql`greatest(${vouchers.quotaUsed} - 1, 0)` }).where(eq(vouchers.id, sale.voucherId));
  }
  if (sale.customerId) {
    const [cust] = await tx.execute<{ points: number }>(sql`select points from customers where id = ${sale.customerId} for update`);
    const restored = sale.pointsRedeemed;
    // Poin tidak boleh minus bila sudah terpakai di tempat lain.
    const take = wasPaid ? Math.min(sale.pointsEarned, Number(cust?.points ?? 0) + restored) : 0;
    const [updated] = await tx
      .update(customers)
      .set({
        points: sql`${customers.points} + ${restored} - ${take}`,
        ...(wasPaid ? { totalSpent: sql`greatest(${customers.totalSpent} - ${sale.total}, 0)`, visitCount: sql`greatest(${customers.visitCount} - 1, 0)` } : {}),
      })
      .where(eq(customers.id, sale.customerId))
      .returning({ points: customers.points });
    const ledger: (typeof pointLedger.$inferInsert)[] = [];
    if (restored > 0) ledger.push({ customerId: sale.customerId, type: "REFUND", change: restored, balanceAfter: updated.points + take, saleId: sale.id, reason: label });
    if (take > 0) ledger.push({ customerId: sale.customerId, type: "REVERSE", change: -take, balanceAfter: updated.points, saleId: sale.id, reason: label });
    if (ledger.length) await tx.insert(pointLedger).values(ledger);
  }
}

/** Gateway mengonfirmasi QRIS kasir lunas. Idempoten; dibayar setelah dibatalkan → perlu refund manual. */
export async function confirmPendingSale(tx: Tx, saleId: string, payment: { amount: number; reference: string | null }): Promise<"PAID" | "ALREADY_PAID" | "SALE_CANCELLED" | "AMOUNT_MISMATCH"> {
  const [locked] = await tx.execute<{ status: string }>(sql`select status from sales where id = ${saleId} for update`);
  if (!locked) throw notFound("Transaksi");
  if (locked.status === "PAID") return "ALREADY_PAID";
  if (locked.status === "VOIDED") return "SALE_CANCELLED";
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
  if (payment.amount !== sale.total) return "AMOUNT_MISMATCH";
  await tx.update(sales).set({ status: "PAID", updatedAt: new Date() }).where(eq(sales.id, saleId));
  await tx.insert(salePayments).values({ saleId, method: "QRIS", amount: sale.total, reference: payment.reference });
  if (sale.customerId) await creditCustomer(tx, { customerId: sale.customerId, saleId, number: sale.number, total: sale.total, earned: sale.pointsEarned });
  await writeAudit(null, { action: "paid", entity: "sale", entityId: saleId, after: { method: "QRIS", reference: payment.reference, total: sale.total } }, tx);
  return "PAID";
}

/** QRIS kasir tidak jadi dibayar (dibatalkan kasir, kedaluwarsa, gagal): transaksi PENDING dibalik. */
export async function cancelPendingSale(tx: Tx, actor: Actor | null, saleId: string, reason: string) {
  const [locked] = await tx.execute<{ status: string }>(sql`select status from sales where id = ${saleId} for update`);
  if (locked?.status !== "PENDING") return false;
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
  await tx.update(sales).set({ status: "VOIDED", voidedAt: new Date(), voidedBy: actor?.userId ?? null, voidReason: reason, updatedAt: new Date() }).where(eq(sales.id, saleId));
  await reverseSaleEffects(tx, actor, sale, `${sale.number}: ${reason}`, false);
  await writeAudit(actor, { action: "cancel_pending", entity: "sale", entityId: saleId, after: { reason } }, tx);
  return true;
}

export async function voidSale(actor: Actor, id: string, reason: string, approvalId?: string | null) {
  const [sale] = await db
    .select({ sale: sales, shiftStatus: shifts.status })
    .from(sales)
    .leftJoin(shifts, eq(shifts.id, sales.shiftId))
    .where(eq(sales.id, id));
  if (!sale) throw notFound("Transaksi");
  if (!can(actor.access, "pos:void", sale.sale.branchId) && !can(actor.access, "pos:access", sale.sale.branchId)) throw forbidden("pos:void");
  if (sale.sale.status !== "PAID") throw conflict("ALREADY_VOIDED", "Transaksi ini sudah dibatalkan.");
  if (sale.shiftStatus !== "OPEN") throw conflict("SHIFT_CLOSED", "Void hanya bisa sebelum shift ditutup. Gunakan retur untuk transaksi lama.");
  if (sale.sale.refundTotal > 0) throw conflict("SALE_HAS_RETURN", "Transaksi ini sudah punya retur. Gunakan retur untuk sisa barangnya.");

  await db.transaction(async (tx) => {
    if (sale.sale.shiftId && !(await lockOpenShift(tx, sale.sale.shiftId))) throw conflict("SHIFT_CLOSED", "Shift baru saja ditutup. Gunakan retur untuk transaksi ini.");
    const approver = await authorizeOrApprove(tx, actor, "pos:void", sale.sale.branchId, approvalId, `sale:${id}`);
    const updated = await tx
      .update(sales)
      .set({ status: "VOIDED", voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason, voidApprovedBy: approver })
      .where(and(eq(sales.id, id), eq(sales.status, "PAID"), eq(sales.refundTotal, 0)))
      .returning({ id: sales.id });
    if (!updated.length) throw conflict("ALREADY_VOIDED", "Transaksi ini sudah dibatalkan atau sudah diretur.");
    await reverseSaleEffects(tx, actor, sale.sale, `Void ${sale.sale.number}: ${reason}`, true);
    await writeAudit(actor, { action: "void", entity: "sale", entityId: id, before: { status: "PAID" }, after: { status: "VOIDED", reason, approvedBy: approver } }, tx);
  });
  return getSale(actor, id);
}
