import "server-only";
import { and, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import {
  branches,
  categories,
  customers,
  membershipTiers,
  products,
  productVariants,
  sales,
  voucherTargets,
  voucherUsages,
  vouchers,
} from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import type { VoucherRule } from "@/lib/pricing";
import { writeAudit } from "./audit.service";

type TargetType = (typeof voucherTargets.$inferInsert)["type"];

export type VoucherInput = {
  code: string;
  name: string;
  description?: string | null;
  valueType: "NOMINAL" | "PERCENT";
  value: number;
  maxDiscount?: number | null;
  minSpend?: number;
  maxSpend?: number | null;
  startsAt: string;
  endsAt?: string | null;
  quotaTotal?: number | null;
  quotaPerCustomer?: number | null;
  productScope: "ALL" | "CATEGORY" | "PRODUCT" | "VARIANT";
  customerScope: "ALL" | "MEMBER" | "TIER" | "CUSTOMER";
  status?: "ACTIVE" | "PAUSED";
  /** id sesuai productScope. */
  productIds?: string[];
  /** Kategori/produk/varian yang dikecualikan. */
  excludeIds?: { type: "CATEGORY" | "PRODUCT" | "VARIANT"; id: string }[];
  /** id tier (customerScope TIER) atau customer (customerScope CUSTOMER). */
  customerIds?: string[];
  /** Kosong = semua cabang. */
  branchIds?: string[];
};

/** Status yang dilihat pengguna, dihitung dari status + periode + kuota. */
export const voucherState = sql<"PAUSED" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "ACTIVE">`case
  when ${vouchers.status} = 'PAUSED' then 'PAUSED'
  when ${vouchers.startsAt} > now() then 'SCHEDULED'
  when ${vouchers.endsAt} is not null and ${vouchers.endsAt} <= now() then 'EXPIRED'
  when ${vouchers.quotaTotal} is not null and ${vouchers.quotaUsed} >= ${vouchers.quotaTotal} then 'EXHAUSTED'
  else 'ACTIVE' end`;

function validate(input: VoucherInput) {
  if (input.valueType === "PERCENT" && (input.value <= 0 || input.value > 10_000)) throw badRequest("VOUCHER_INVALID", "Persentase harus antara 0,01% dan 100%.");
  if (input.valueType === "PERCENT" && !input.maxDiscount) throw badRequest("VOUCHER_INVALID", "Voucher persen wajib punya maksimal potongan.");
  if (input.maxSpend != null && input.maxSpend < (input.minSpend ?? 0)) throw badRequest("VOUCHER_INVALID", "Maksimal belanja harus lebih besar dari minimal belanja.");
  if (input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) throw badRequest("VOUCHER_INVALID", "Tanggal berakhir harus setelah tanggal mulai.");
  if (input.productScope !== "ALL" && !input.productIds?.length) throw badRequest("VOUCHER_INVALID", "Pilih minimal satu kategori/produk/varian yang disasar.");
  if ((input.customerScope === "TIER" || input.customerScope === "CUSTOMER") && !input.customerIds?.length) {
    throw badRequest("VOUCHER_INVALID", input.customerScope === "TIER" ? "Pilih minimal satu tier member." : "Pilih minimal satu customer.");
  }
}

function targetRows(voucherId: string, input: VoucherInput) {
  const rows: { voucherId: string; type: TargetType; targetId: string; isExclusion: boolean }[] = [];
  if (input.productScope !== "ALL") for (const id of input.productIds ?? []) rows.push({ voucherId, type: input.productScope, targetId: id, isExclusion: false });
  for (const e of input.excludeIds ?? []) rows.push({ voucherId, type: e.type, targetId: e.id, isExclusion: true });
  if (input.customerScope === "TIER" || input.customerScope === "CUSTOMER") {
    for (const id of input.customerIds ?? []) rows.push({ voucherId, type: input.customerScope, targetId: id, isExclusion: false });
  }
  for (const id of input.branchIds ?? []) rows.push({ voucherId, type: "BRANCH", targetId: id, isExclusion: false });
  return rows;
}

function columnsFrom(input: VoucherInput) {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name,
    description: input.description ?? null,
    valueType: input.valueType,
    value: input.value,
    maxDiscount: input.valueType === "PERCENT" ? (input.maxDiscount ?? null) : null,
    minSpend: input.minSpend ?? 0,
    maxSpend: input.maxSpend ?? null,
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    quotaTotal: input.quotaTotal ?? null,
    quotaPerCustomer: input.quotaPerCustomer ?? null,
    productScope: input.productScope,
    customerScope: input.customerScope,
    status: input.status ?? "ACTIVE",
  };
}

export async function createVoucher(actor: Actor, input: VoucherInput) {
  validate(input);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(vouchers).values({ ...columnsFrom(input), createdBy: actor.userId }).returning({ id: vouchers.id });
    const targets = targetRows(row.id, input);
    if (targets.length) await tx.insert(voucherTargets).values(targets);
    await writeAudit(actor, { action: "create", entity: "voucher", entityId: row.id, after: input }, tx);
    return row.id;
  });
  return getVoucher(id);
}

export async function updateVoucher(actor: Actor, id: string, input: VoucherInput) {
  validate(input);
  const [before] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!before) throw notFound("Voucher");
  if (input.quotaTotal != null && input.quotaTotal < before.quotaUsed) {
    throw badRequest("VOUCHER_INVALID", `Kuota tidak bisa lebih kecil dari yang sudah terpakai (${before.quotaUsed}).`);
  }
  await db.transaction(async (tx) => {
    await tx.update(vouchers).set(columnsFrom(input)).where(eq(vouchers.id, id));
    await tx.delete(voucherTargets).where(eq(voucherTargets.voucherId, id));
    const targets = targetRows(id, input);
    if (targets.length) await tx.insert(voucherTargets).values(targets);
    await writeAudit(actor, { action: "update", entity: "voucher", entityId: id, before, after: input }, tx);
  });
  return getVoucher(id);
}

export async function setVoucherStatus(actor: Actor, id: string, status: "ACTIVE" | "PAUSED") {
  const [row] = await db.update(vouchers).set({ status }).where(eq(vouchers.id, id)).returning({ id: vouchers.id });
  if (!row) throw notFound("Voucher");
  await writeAudit(actor, { action: status === "PAUSED" ? "pause" : "resume", entity: "voucher", entityId: id });
  return getVoucher(id);
}

export async function listVouchers(params: { q?: string; state?: string; page: number; pageSize: number }) {
  const filters: (SQL | undefined)[] = [];
  if (params.q) filters.push(or(ilike(vouchers.code, `%${params.q}%`), ilike(vouchers.name, `%${params.q}%`)));
  if (params.state) filters.push(sql`${voucherState} = ${params.state}`);
  const where = and(...filters);
  const usage = db
    .select({
      voucherId: voucherUsages.voucherId,
      discount: sql<number>`sum(${voucherUsages.discount})::bigint`.mapWith(Number).as("discount"),
      revenue: sql<number>`sum(${voucherUsages.saleTotal})::bigint`.mapWith(Number).as("revenue"),
    })
    .from(voucherUsages)
    .where(eq(voucherUsages.status, "APPLIED"))
    .groupBy(voucherUsages.voucherId)
    .as("usage");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: vouchers.id,
        code: vouchers.code,
        name: vouchers.name,
        valueType: vouchers.valueType,
        value: vouchers.value,
        maxDiscount: vouchers.maxDiscount,
        minSpend: vouchers.minSpend,
        startsAt: vouchers.startsAt,
        endsAt: vouchers.endsAt,
        quotaTotal: vouchers.quotaTotal,
        quotaUsed: vouchers.quotaUsed,
        productScope: vouchers.productScope,
        customerScope: vouchers.customerScope,
        state: voucherState,
        totalDiscount: sql<number>`coalesce(${usage.discount}, 0)`.mapWith(Number),
        revenue: sql<number>`coalesce(${usage.revenue}, 0)`.mapWith(Number),
      })
      .from(vouchers)
      .leftJoin(usage, eq(usage.voucherId, vouchers.id))
      .where(where)
      .orderBy(desc(vouchers.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(vouchers).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

/** Detail + nama setiap target (maks 6 query IN, bukan per target). */
export async function getVoucher(id: string) {
  const [[voucher], targets] = await Promise.all([
    db.select({ voucher: vouchers, state: voucherState }).from(vouchers).where(eq(vouchers.id, id)),
    db.select().from(voucherTargets).where(eq(voucherTargets.voucherId, id)),
  ]);
  if (!voucher) throw notFound("Voucher");
  const idsOf = (type: TargetType) => targets.filter((t) => t.type === type).map((t) => t.targetId);
  const pick = async <T,>(ids: string[], q: () => Promise<T[]>) => (ids.length ? q() : []);
  const [cats, prods, vars, tiers, custs, brs] = await Promise.all([
    pick(idsOf("CATEGORY"), () => db.select({ id: categories.id, label: categories.name }).from(categories).where(inArray(categories.id, idsOf("CATEGORY")))),
    pick(idsOf("PRODUCT"), () => db.select({ id: products.id, label: products.name }).from(products).where(inArray(products.id, idsOf("PRODUCT")))),
    pick(idsOf("VARIANT"), () =>
      db
        .select({ id: productVariants.id, label: sql<string>`${products.name} || case when ${productVariants.title} = 'Default' then '' else ' · ' || ${productVariants.title} end`, sku: productVariants.sku })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, idsOf("VARIANT"))),
    ),
    pick(idsOf("TIER"), () => db.select({ id: membershipTiers.id, label: membershipTiers.name }).from(membershipTiers).where(inArray(membershipTiers.id, idsOf("TIER")))),
    pick(idsOf("CUSTOMER"), () => db.select({ id: customers.id, label: customers.name, phone: customers.phone }).from(customers).where(inArray(customers.id, idsOf("CUSTOMER")))),
    pick(idsOf("BRANCH"), () => db.select({ id: branches.id, label: branches.name }).from(branches).where(inArray(branches.id, idsOf("BRANCH")))),
  ]);
  const labels = new Map<string, string>([...cats, ...prods, ...vars, ...tiers, ...custs, ...brs].map((x) => [x.id, x.label]));
  return {
    ...voucher.voucher,
    state: voucher.state,
    targets: targets.map((t) => ({ type: t.type, id: t.targetId, isExclusion: t.isExclusion, label: labels.get(t.targetId) ?? "(dihapus)" })),
  };
}

// ── Validasi saat dipakai ───────────────────────────────────────────────

const reject = (code: string, message: string) => new ApiError(422, code, message);

/**
 * Cek semua syarat yang butuh database lalu kembalikan aturan untuk mesin harga.
 * Syarat keranjang (min/maks belanja, barang eligible) dicek oleh `priceCart`.
 */
export async function resolveVoucher(
  q: Tx | typeof db,
  params: { code: string; branchId: string; customer: { id: string; isMember: boolean; tierId: string | null } | null },
): Promise<{ id: string; rule: VoucherRule; quotaPerCustomer: number | null }> {
  const code = params.code.trim().toUpperCase();
  const [row] = await q.select({ voucher: vouchers, state: voucherState }).from(vouchers).where(eq(vouchers.code, code));
  if (!row) throw reject("VOUCHER_NOT_FOUND", `Kode voucher "${code}" tidak ditemukan.`);
  const v = row.voucher;
  const messages: Record<string, string> = {
    PAUSED: "Voucher ini sedang dijeda.",
    SCHEDULED: `Voucher baru berlaku mulai ${v.startsAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}.`,
    EXPIRED: "Masa berlaku voucher sudah habis.",
    EXHAUSTED: "Kuota voucher sudah habis.",
  };
  if (row.state !== "ACTIVE") throw reject(`VOUCHER_${row.state}`, messages[row.state]);

  const targets = await q.select().from(voucherTargets).where(eq(voucherTargets.voucherId, v.id));
  const branchIds = targets.filter((t) => t.type === "BRANCH").map((t) => t.targetId);
  if (branchIds.length && !branchIds.includes(params.branchId)) throw reject("VOUCHER_BRANCH", "Voucher ini tidak berlaku di cabang ini.");

  const c = params.customer;
  if (v.customerScope !== "ALL" && !c) throw reject("VOUCHER_NEEDS_CUSTOMER", "Pilih customer terlebih dahulu untuk memakai voucher ini.");
  if (v.customerScope === "MEMBER" && !c?.isMember) throw reject("VOUCHER_MEMBER_ONLY", "Voucher ini khusus member.");
  if (v.customerScope === "TIER") {
    const tiers = targets.filter((t) => t.type === "TIER").map((t) => t.targetId);
    if (!c?.isMember || !c.tierId || !tiers.includes(c.tierId)) throw reject("VOUCHER_TIER", "Voucher ini khusus tier member tertentu.");
  }
  if (v.customerScope === "CUSTOMER") {
    const allowed = targets.filter((t) => t.type === "CUSTOMER").map((t) => t.targetId);
    if (!c || !allowed.includes(c.id)) throw reject("VOUCHER_CUSTOMER", "Voucher ini khusus customer tertentu.");
  }
  if (v.quotaPerCustomer) {
    if (!c) throw reject("VOUCHER_NEEDS_CUSTOMER", "Voucher ini dibatasi per customer. Pilih customer terlebih dahulu.");
    const [{ used }] = await q
      .select({ used: count() })
      .from(voucherUsages)
      .where(and(eq(voucherUsages.voucherId, v.id), eq(voucherUsages.customerId, c.id), eq(voucherUsages.status, "APPLIED")));
    if (used >= v.quotaPerCustomer) throw reject("VOUCHER_CUSTOMER_LIMIT", `Customer ini sudah memakai voucher ini ${used}×, batasnya ${v.quotaPerCustomer}×.`);
  }

  const productTargets = targets.filter((t) => ["CATEGORY", "PRODUCT", "VARIANT"].includes(t.type));
  return {
    id: v.id,
    quotaPerCustomer: v.quotaPerCustomer,
    rule: {
      code: v.code,
      valueType: v.valueType,
      value: v.value,
      maxDiscount: v.maxDiscount,
      minSpend: v.minSpend,
      maxSpend: v.maxSpend,
      productScope: v.productScope,
      includeIds: productTargets.filter((t) => !t.isExclusion).map((t) => t.targetId),
      excludeIds: productTargets.filter((t) => t.isExclusion).map((t) => t.targetId),
    },
  };
}

/** Klaim kuota secara atomik (dipanggil di transaksi checkout). Gagal bila kuota habis di detik terakhir. */
export async function claimVoucherQuota(tx: Tx, voucherId: string) {
  const [row] = await tx
    .update(vouchers)
    .set({ quotaUsed: sql`${vouchers.quotaUsed} + 1` })
    .where(and(eq(vouchers.id, voucherId), eq(vouchers.status, "ACTIVE"), sql`(${vouchers.quotaTotal} is null or ${vouchers.quotaUsed} < ${vouchers.quotaTotal})`))
    .returning({ id: vouchers.id });
  if (!row) throw new ApiError(409, "VOUCHER_EXHAUSTED", "Kuota voucher baru saja habis. Hapus voucher lalu bayar ulang.");
}

// ── Performa ────────────────────────────────────────────────────────────

/** Performa voucher dalam N hari: per voucher (atau satu voucher) + tren harian. 2 query agregat. */
export async function voucherPerformance(params: { voucherId?: string; days: number }) {
  const since = sql`now() - ${`${params.days} days`}::interval`;
  const filter = and(eq(voucherUsages.status, "APPLIED"), gte(voucherUsages.createdAt, since), params.voucherId ? eq(voucherUsages.voucherId, params.voucherId) : undefined);
  const day = sql<string>`to_char((${voucherUsages.createdAt} at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD')`;
  const [perVoucher, trend] = await Promise.all([
    db
      .select({
        voucherId: vouchers.id,
        code: vouchers.code,
        name: vouchers.name,
        state: voucherState,
        quotaTotal: vouchers.quotaTotal,
        quotaUsed: vouchers.quotaUsed,
        uses: sql<number>`count(*)::int`,
        uniqueCustomers: sql<number>`count(distinct ${voucherUsages.customerId})::int`,
        totalDiscount: sql<number>`sum(${voucherUsages.discount})::bigint`.mapWith(Number),
        revenue: sql<number>`sum(${voucherUsages.saleTotal})::bigint`.mapWith(Number),
        avgOrder: sql<number>`round(avg(${voucherUsages.saleTotal}))::bigint`.mapWith(Number),
      })
      .from(voucherUsages)
      .innerJoin(vouchers, eq(vouchers.id, voucherUsages.voucherId))
      .where(filter)
      .groupBy(vouchers.id)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ day, uses: sql<number>`count(*)::int`, discount: sql<number>`sum(${voucherUsages.discount})::bigint`.mapWith(Number), revenue: sql<number>`sum(${voucherUsages.saleTotal})::bigint`.mapWith(Number) })
      .from(voucherUsages)
      .where(filter)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);
  return { days: params.days, vouchers: perVoucher, trend };
}

/** Riwayat pemakaian satu voucher (20 terakhir). */
export async function voucherUsageList(voucherId: string) {
  return db
    .select({
      saleId: voucherUsages.saleId,
      number: sales.number,
      discount: voucherUsages.discount,
      saleTotal: voucherUsages.saleTotal,
      status: voucherUsages.status,
      createdAt: voucherUsages.createdAt,
      customerName: customers.name,
      branchName: branches.name,
    })
    .from(voucherUsages)
    .innerJoin(sales, eq(sales.id, voucherUsages.saleId))
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(customers, eq(customers.id, voucherUsages.customerId))
    .where(eq(voucherUsages.voucherId, voucherId))
    .orderBy(desc(voucherUsages.createdAt))
    .limit(20);
}

