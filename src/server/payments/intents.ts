import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "@/server/db";
import { paymentIntents } from "@/server/db/schema";
import { conflict } from "@/server/api/errors";
import { getPaymentProvider, providerByName } from "./provider";

export type IntentReference = "online_order" | "pos_sale";

/** Baris PENDING tanpa QR setua ini = proses pembuatnya mati di tengah jalan, bukan sedang berjalan. */
const STUCK_MS = 30_000;

export async function latestIntent(referenceType: IntentReference, referenceId: string) {
  const [row] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.referenceType, referenceType), eq(paymentIntents.referenceId, referenceId)))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Buat QRIS dinamis untuk satu dokumen. Maksimal satu QR aktif per dokumen, dijamin indeks unik + kunci per dokumen:
 * dua permintaan bersamaan menghasilkan satu tagihan gateway, yang kalah memakai QR pemenang. Baris intent dibuat lebih
 * dulu agar notifikasi yang datang cepat selalu menemukan pasangannya.
 */
export async function createPaymentIntent(p: { referenceType: IntentReference; referenceId: string; documentNumber: string; amount: number; expiryMinutes: number; createdBy: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw conflict("QRIS_UNAVAILABLE", "QRIS dinamis belum diaktifkan. Atur payment gateway di konfigurasi server, atau pakai metode lain.");
  const lockKey = `payment:${p.referenceType}:${p.referenceId}`;
  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const [active] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.referenceType, p.referenceType), eq(paymentIntents.referenceId, p.referenceId), eq(paymentIntents.status, "PENDING")));
    if (active?.amount === p.amount && active.expiresAt > new Date()) {
      if (active.qrString) return { reuse: active };
      if (Date.now() - active.createdAt.getTime() < STUCK_MS) return { waitFor: active.id };
    }
    if (active) await tx.update(paymentIntents).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(paymentIntents.id, active.id));
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(paymentIntents)
      .where(and(eq(paymentIntents.referenceType, p.referenceType), eq(paymentIntents.referenceId, p.referenceId)));
    // order_id gateway hanya boleh huruf, angka, dan - _ . ~ (tanpa "/").
    const gatewayOrderId = `${p.documentNumber.replaceAll("/", "-")}-${n + 1}`;
    const [intent] = await tx
      .insert(paymentIntents)
      .values({
        provider: provider.name,
        gatewayOrderId,
        referenceType: p.referenceType,
        referenceId: p.referenceId,
        amount: p.amount,
        expiresAt: new Date(Date.now() + p.expiryMinutes * 60_000),
        createdBy: p.createdBy,
      })
      .returning();
    return { intent, superseded: active ?? null };
  });
  if (claim.reuse) return claim.reuse;
  if (claim.waitFor) return waitForQr(claim.waitFor);
  const { intent, superseded } = claim;
  if (!intent) throw conflict("QRIS_IN_PROGRESS", "QRIS masih dibuat. Coba lagi sebentar.");

  // QR lama sudah digantikan: tutup juga di gateway agar tidak bisa dibayar. Gagal bukan masalah: pembayaran ganda tetap tertangkap saat notifikasi.
  if (superseded?.qrString) await providerByName(superseded.provider)?.cancel?.(superseded.gatewayOrderId, superseded.providerRef).catch(() => null);
  try {
    const charge = await provider.createQris({ gatewayOrderId: intent.gatewayOrderId, amount: p.amount, expiryMinutes: p.expiryMinutes });
    const [updated] = await db
      .update(paymentIntents)
      .set({ qrString: charge.qrString, providerRef: charge.providerRef, expiresAt: charge.expiresAt, updatedAt: new Date() })
      .where(eq(paymentIntents.id, intent.id))
      .returning();
    return updated;
  } catch (error) {
    await db.update(paymentIntents).set({ status: "FAILED", updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
    throw error;
  }
}

/** Permintaan lain sedang membuat QR untuk dokumen yang sama: tunggu hasilnya, jangan menagih dua kali. */
async function waitForQr(intentId: string) {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const [row] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId));
    if (row?.qrString) return row;
    if (row?.status !== "PENDING") break;
  }
  throw conflict("QRIS_IN_PROGRESS", "QRIS masih dibuat. Coba lagi sebentar.");
}
