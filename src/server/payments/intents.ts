import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { paymentIntents } from "@/server/db/schema";
import { conflict } from "@/server/api/errors";
import { getPaymentProvider } from "./provider";

export type IntentReference = "online_order" | "pos_sale";

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
 * Buat QRIS dinamis untuk satu dokumen (order online / transaksi kasir). Percobaan lama yang masih
 * PENDING ditutup → hanya satu QR aktif per dokumen. Baris intent dibuat lebih dulu agar notifikasi
 * yang datang cepat selalu menemukan pasangannya.
 */
export async function createPaymentIntent(p: { referenceType: IntentReference; referenceId: string; documentNumber: string; amount: number; expiryMinutes: number; createdBy: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw conflict("QRIS_UNAVAILABLE", "QRIS dinamis belum diaktifkan. Atur payment gateway di konfigurasi server, atau pakai metode lain.");
  await db
    .update(paymentIntents)
    .set({ status: "EXPIRED", updatedAt: new Date() })
    .where(and(eq(paymentIntents.referenceType, p.referenceType), eq(paymentIntents.referenceId, p.referenceId), eq(paymentIntents.status, "PENDING")));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.referenceType, p.referenceType), eq(paymentIntents.referenceId, p.referenceId)));
  // order_id gateway hanya boleh huruf, angka, dan - _ . ~ (tanpa "/").
  const gatewayOrderId = `${p.documentNumber.replaceAll("/", "-")}-${n + 1}`;
  const [intent] = await db
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
  try {
    const charge = await provider.createQris({ gatewayOrderId, amount: p.amount, expiryMinutes: p.expiryMinutes });
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
