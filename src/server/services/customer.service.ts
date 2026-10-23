import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { branches, customers, membershipTiers, numberSequences, pointLedger, sales } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { badRequest, conflict, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { writeAudit } from "./audit.service";

/** 0812-3456-789 / +62 812… / 812… → 62812…; null bila tidak valid. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^62\d{8,13}$/.test(d) ? d : null;
}

/** Untuk MCP & log: 6281234567890 → 62812****7890. */
export function maskPhone(phone: string) {
  return phone.length > 8 ? `${phone.slice(0, 5)}****${phone.slice(-4)}` : "****";
}

async function nextMemberNo(tx: Tx) {
  const yy = String(new Date().getFullYear()).slice(2);
  const [row] = await tx
    .insert(numberSequences)
    .values({ key: `MEMBER/${yy}`, value: 1 })
    .onConflictDoUpdate({ target: numberSequences.key, set: { value: sql`${numberSequences.value} + 1` } })
    .returning({ value: numberSequences.value });
  return `M${yy}${String(row.value).padStart(5, "0")}`;
}

/** Tier tertinggi yang syarat total belanjanya terpenuhi. */
export async function tierForSpend(tx: Tx | typeof db, totalSpent: number) {
  const [tier] = await tx
    .select({ id: membershipTiers.id })
    .from(membershipTiers)
    .where(lte(membershipTiers.minSpend, totalSpent))
    .orderBy(desc(membershipTiers.minSpend))
    .limit(1);
  return tier?.id ?? null;
}

const listColumns = {
  id: customers.id,
  name: customers.name,
  phone: customers.phone,
  email: customers.email,
  isMember: customers.isMember,
  memberNo: customers.memberNo,
  tierId: customers.tierId,
  tierName: membershipTiers.name,
  tierDiscountBps: membershipTiers.discountBps,
  points: customers.points,
  totalSpent: customers.totalSpent,
  visitCount: customers.visitCount,
  lastVisitAt: customers.lastVisitAt,
  createdAt: customers.createdAt,
};

export async function listCustomers(params: { q?: string; member?: boolean; tierId?: string; page: number; pageSize: number }) {
  const filters: (SQL | undefined)[] = [];
  if (params.q) {
    const digits = params.q.replace(/\D/g, "");
    const phone = digits.length >= 4 ? (digits.startsWith("0") ? "62" + digits.slice(1) : digits) : null;
    filters.push(
      or(
        ilike(customers.name, `%${params.q}%`),
        eq(customers.memberNo, params.q.toUpperCase()),
        phone ? ilike(customers.phone, `%${phone}%`) : undefined,
      ),
    );
  }
  if (params.member !== undefined) filters.push(eq(customers.isMember, params.member));
  if (params.tierId) filters.push(eq(customers.tierId, params.tierId));
  const where = and(...filters);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(listColumns)
      .from(customers)
      .leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId))
      .where(where)
      .orderBy(params.q ? asc(customers.name) : desc(customers.lastVisitAt), desc(customers.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(customers).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

/** Profil + 10 transaksi & 10 mutasi poin terakhir (3 query paralel). */
export async function getCustomer(id: string) {
  const [[customer], recentSales, points] = await Promise.all([
    db.select({ ...listColumns, birthDate: customers.birthDate, notes: customers.notes, consentAt: customers.consentAt }).from(customers).leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId)).where(eq(customers.id, id)),
    db
      .select({ id: sales.id, number: sales.number, total: sales.total, status: sales.status, createdAt: sales.createdAt, branchName: branches.name, voucherCode: sales.voucherCode, pointsEarned: sales.pointsEarned })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .where(eq(sales.customerId, id))
      .orderBy(desc(sales.createdAt))
      .limit(10),
    db.select().from(pointLedger).where(eq(pointLedger.customerId, id)).orderBy(desc(pointLedger.createdAt)).limit(10),
  ]);
  if (!customer) throw notFound("Customer");
  return { ...customer, recentSales, pointHistory: points };
}

export type CustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
  birthDate?: string | null;
  notes?: string | null;
  isMember?: boolean;
  consent?: boolean;
};

export async function createCustomer(actor: Actor, input: CustomerInput) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw badRequest("PHONE_INVALID", "Nomor HP tidak valid. Contoh: 0812 3456 7890.");
  const [exists] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.phone, phone));
  if (exists) throw conflict("PHONE_TAKEN", `Nomor ini sudah terdaftar atas nama ${exists.name}.`);
  if (input.isMember && !input.consent) throw badRequest("CONSENT_REQUIRED", "Member wajib menyetujui penyimpanan data pribadi.");

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({
        name: input.name,
        phone,
        email: input.email || null,
        birthDate: input.birthDate || null,
        notes: input.notes || null,
        isMember: !!input.isMember,
        memberNo: input.isMember ? await nextMemberNo(tx) : null,
        tierId: input.isMember ? await tierForSpend(tx, 0) : null,
        consentAt: input.consent ? new Date() : null,
        createdBy: actor.userId,
      })
      .returning({ id: customers.id });
    await writeAudit(actor, { action: "create", entity: "customer", entityId: row.id, after: { name: input.name, isMember: !!input.isMember } }, tx);
    return row.id;
  });
  return getCustomer(id);
}

export async function updateCustomer(actor: Actor, id: string, input: Partial<CustomerInput>) {
  const [before] = await db.select().from(customers).where(eq(customers.id, id));
  if (!before) throw notFound("Customer");
  const phone = input.phone !== undefined ? normalizePhone(input.phone) : before.phone;
  if (!phone) throw badRequest("PHONE_INVALID", "Nomor HP tidak valid. Contoh: 0812 3456 7890.");
  const becomesMember = input.isMember === true && !before.isMember;
  if (becomesMember && !input.consent && !before.consentAt) throw badRequest("CONSENT_REQUIRED", "Member wajib menyetujui penyimpanan data pribadi.");

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        name: input.name,
        phone,
        email: input.email === undefined ? undefined : input.email || null,
        birthDate: input.birthDate === undefined ? undefined : input.birthDate || null,
        notes: input.notes === undefined ? undefined : input.notes || null,
        isMember: input.isMember,
        memberNo: becomesMember ? await nextMemberNo(tx) : undefined,
        tierId: becomesMember ? await tierForSpend(tx, before.totalSpent) : undefined,
        consentAt: input.consent && !before.consentAt ? new Date() : undefined,
      })
      .where(eq(customers.id, id));
    await writeAudit(actor, { action: "update", entity: "customer", entityId: id, before: { name: before.name, isMember: before.isMember }, after: input }, tx);
  });
  return getCustomer(id);
}

// ── Tier member ─────────────────────────────────────────────────────────

export async function listTiers() {
  const [tiers, counts] = await Promise.all([
    db.select().from(membershipTiers).orderBy(asc(membershipTiers.minSpend)),
    db.select({ tierId: customers.tierId, members: count() }).from(customers).where(eq(customers.isMember, true)).groupBy(customers.tierId),
  ]);
  const byTier = new Map(counts.map((c) => [c.tierId, c.members]));
  return tiers.map((t) => ({ ...t, memberCount: byTier.get(t.id) ?? 0 }));
}

export type TierInput = { name: string; minSpend: number; discountBps: number; pointsPer10k: number };

/** Setelah syarat tier berubah, tetapkan ulang tier semua member dalam satu UPDATE. */
async function reassignTiers(tx: Tx) {
  await tx.execute(sql`
    update customers c set tier_id = (
      select t.id from membership_tiers t where t.min_spend <= c.total_spent order by t.min_spend desc limit 1
    ) where c.is_member = true
  `);
}

export async function createTier(actor: Actor, input: TierInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(membershipTiers).values(input).returning();
    await reassignTiers(tx);
    await writeAudit(actor, { action: "create", entity: "membership_tier", entityId: row.id, after: row }, tx);
    return row;
  });
}

export async function updateTier(actor: Actor, id: string, input: Partial<TierInput>) {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(membershipTiers).set(input).where(eq(membershipTiers.id, id)).returning();
    if (!row) throw notFound("Tier");
    await reassignTiers(tx);
    await writeAudit(actor, { action: "update", entity: "membership_tier", entityId: id, after: input }, tx);
    return row;
  });
}

export async function deleteTier(actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(membershipTiers).where(eq(membershipTiers.id, id)).returning();
    if (!row) throw notFound("Tier");
    await reassignTiers(tx);
    await writeAudit(actor, { action: "delete", entity: "membership_tier", entityId: id, before: row }, tx);
  });
}

/** Ambil banyak customer sekaligus (untuk nama target voucher). */
export async function customersByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(inArray(customers.id, ids));
}
