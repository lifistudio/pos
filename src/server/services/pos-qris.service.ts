import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { paymentIntents, sales } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { conflict, forbidden } from "@/server/api/errors";
import { env } from "@/server/env";
import { createPaymentIntent, latestIntent } from "@/server/payments/intents";
import { mockProvider } from "@/server/payments/provider";
import { can } from "@/server/rbac/access";
import { cancelIntent, simulateIntentPaid, syncIntent } from "./payment.service";
import { cancelPendingSale, createPendingQrisSale, getSale, type CheckoutInput } from "./sale.service";

const REF = "pos_sale";

async function view(actor: Actor, saleId: string) {
  const [sale, payment] = await Promise.all([getSale(actor, saleId), latestIntent(REF, saleId)]);
  return {
    sale,
    payment: payment && { id: payment.id, status: payment.status, amount: payment.amount, qrString: payment.qrString, expiresAt: payment.expiresAt, paidAt: payment.paidAt, provider: payment.provider },
    simulator: !!mockProvider(),
  };
}

/**
 * Mulai bayar QRIS di kasir: transaksi PENDING (harga, stok, voucher, poin tukar dikunci) + QR dinamis.
 * Idempoten lewat header Idempotency-Key yang sama dengan checkout biasa.
 */
export async function startQrisCheckout(actor: Actor, input: Omit<CheckoutInput, "payments">) {
  const sale = await createPendingQrisSale(actor, input);
  if (sale.status === "VOIDED") throw conflict("QRIS_CANCELLED", "QRIS untuk transaksi ini sudah dibatalkan. Ulangi pembayaran.");
  if (sale.status === "PENDING") {
    const current = await latestIntent(REF, sale.id);
    if (!current || current.status !== "PENDING" || !current.qrString) {
      try {
        await createPaymentIntent({ referenceType: REF, referenceId: sale.id, documentNumber: sale.number, amount: sale.total, expiryMinutes: env.QRIS_EXPIRY_MINUTES, createdBy: actor.userId });
      } catch (error) {
        // QR gagal dibuat: jangan biarkan stok & voucher terkunci.
        await db.transaction((tx) => cancelPendingSale(tx, actor, sale.id, "Gagal membuat QRIS"));
        throw error;
      }
    }
  }
  return view(actor, sale.id);
}

/** Dipanggil berkala oleh layar kasir: sinkron ke gateway bila webhook belum masuk, tutup QR kedaluwarsa. */
export async function getQrisStatus(actor: Actor, saleId: string) {
  await getSale(actor, saleId); // cek akses
  const intent = await latestIntent(REF, saleId);
  if (intent) await syncIntent(intent, 3_000);
  return view(actor, saleId);
}

export async function cancelQris(actor: Actor, saleId: string) {
  const sale = await getSale(actor, saleId);
  if (sale.cashierId !== actor.userId && !can(actor.access, "pos:void", sale.branchId)) throw forbidden("pos:void");
  if (sale.status !== "PENDING") throw conflict("SALE_NOT_PENDING", sale.status === "PAID" ? "Pembayaran sudah diterima — transaksi lunas." : "QRIS ini sudah dibatalkan.");
  const intent = await latestIntent(REF, saleId);
  if (intent?.status === "PENDING") await cancelIntent(intent);
  else await db.transaction((tx) => cancelPendingSale(tx, actor, saleId, "QRIS dibatalkan kasir"));
  return view(actor, saleId);
}

export async function simulateQris(actor: Actor, saleId: string) {
  await getSale(actor, saleId);
  const intent = await latestIntent(REF, saleId);
  if (!intent) throw conflict("NO_PENDING_QRIS", "Tidak ada QRIS untuk transaksi ini.");
  await simulateIntentPaid(intent);
  return view(actor, saleId);
}

/**
 * Sapu QR yang lewat masa berlaku (kasir menutup layar sebelum selesai, webhook kedaluwarsa tidak dikirim).
 * Dipanggil sebelum tutup shift dan oleh endpoint cron.
 */
export async function sweepExpiredIntents(filter: { shiftId?: string } = {}) {
  const rows = await db
    .select({ intent: paymentIntents })
    .from(paymentIntents)
    .leftJoin(sales, and(eq(paymentIntents.referenceType, REF), eq(sales.id, paymentIntents.referenceId)))
    .where(
      and(
        eq(paymentIntents.status, "PENDING"),
        filter.shiftId ? eq(sales.shiftId, filter.shiftId) : lt(paymentIntents.expiresAt, sql`now() - interval '1 minute'`),
      ),
    )
    .limit(50);
  for (const { intent } of rows) await syncIntent(intent, 0).catch(() => null);
  return { checked: rows.length };
}
