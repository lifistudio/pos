import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { writeAudit } from "./audit.service";

/** Kebijakan toko yang berlaku di semua cabang: tukar poin & retur. */
export const storePolicySchema = z.object({
  /** Nilai rupiah per poin saat ditukar. */
  pointValue: z.number().int().min(1).max(1_000_000),
  minRedeemPoints: z.number().int().min(1).max(1_000_000),
  /** Porsi maksimal tagihan yang boleh dibayar poin (basis poin). Maks 90% agar selalu ada pembayaran tercatat. */
  maxRedeemBps: z.number().int().min(100).max(9000),
  /** Batas hari retur sejak transaksi (0 = retur tidak diizinkan). */
  returnWindowDays: z.number().int().min(0).max(365),
  /** Diskon manual kasir maksimal (basis poin dari tagihan setelah voucher). */
  maxManualDiscountBps: z.number().int().min(0).max(9000),
});
export type StorePolicy = z.infer<typeof storePolicySchema>;

// Asumsi Q-24 sampai owner memutuskan: 1 poin = Rp100, minimal 10 poin, maks 50% tagihan; retur 7 hari.
export const DEFAULT_POLICY: StorePolicy = { pointValue: 100, minRedeemPoints: 10, maxRedeemBps: 5000, returnWindowDays: 7, maxManualDiscountBps: 3000 };
const KEY = "store_policy";

export async function getStorePolicy(q: Tx | typeof db = db): Promise<StorePolicy> {
  const [row] = await q.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  const parsed = storePolicySchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_POLICY, ...(parsed.success ? parsed.data : {}) };
}

export async function updateStorePolicy(actor: Actor, input: StorePolicy) {
  const before = await getStorePolicy();
  await db
    .insert(appSettings)
    .values({ key: KEY, value: input, updatedBy: actor.userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: input, updatedBy: actor.userId, updatedAt: new Date() } });
  await writeAudit(actor, { action: "update", entity: "setting", entityId: KEY, before, after: input });
  return input;
}
