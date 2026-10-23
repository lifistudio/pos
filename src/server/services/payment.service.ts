import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { paymentEvents, paymentIntents } from "@/server/db/schema";
import { ApiError } from "@/server/api/errors";
import { latestIntent, type IntentReference } from "@/server/payments/intents";
import { mockProvider, providerByName, type GatewayStatus } from "@/server/payments/provider";
import { writeAudit } from "./audit.service";
import { confirmOrderPayment } from "./online-order.service";
import { cancelPendingSale, confirmPendingSale } from "./sale.service";

type Intent = typeof paymentIntents.$inferSelect;

const FAILURE_REASON: Record<Exclude<GatewayStatus, "PAID" | "PENDING">, string> = {
  EXPIRED: "QRIS kedaluwarsa",
  FAILED: "QRIS gagal",
  CANCELLED: "QRIS dibatalkan",
};

/**
 * Terapkan status gateway ke intent + dokumennya dalam satu transaksi, dibedakan per jenis rujukan:
 * order online (lunas → transaksi dibuat) atau transaksi kasir PENDING (lunas → PAID; gagal → dibalik).
 */
async function applyGatewayStatus(tx: Tx, intent: Intent, status: GatewayStatus, amount: number, providerRef: string | null) {
  if (status === "PENDING") return "PENDING";
  if (status === "PAID") {
    if (amount !== intent.amount) return "AMOUNT_MISMATCH";
    const updated = await tx
      .update(paymentIntents)
      .set({ status: "PAID", paidAt: new Date(), providerRef: providerRef ?? intent.providerRef, updatedAt: new Date() })
      .where(and(eq(paymentIntents.id, intent.id), sql`${paymentIntents.status} <> 'PAID'`))
      .returning({ id: paymentIntents.id });
    if (!updated.length) return "ALREADY_PAID";
    // QR yang sempat ditutup (kedaluwarsa) tetapi tetap dibayar: dokumen masih dilunasi bila belum dibatalkan;
    // bila sudah dibatalkan, fungsi konfirmasi mengembalikan *_CANCELLED → perlu refund manual.
    const reference = providerRef ?? intent.gatewayOrderId;
    return intent.referenceType === "pos_sale"
      ? confirmPendingSale(tx, intent.referenceId, { amount, reference })
      : confirmOrderPayment(tx, intent.referenceId, { method: "QRIS", reference, amount });
  }
  const closed = await tx
    .update(paymentIntents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.status, "PENDING")))
    .returning({ id: paymentIntents.id });
  // Order online tetap menunggu (bisa buat QR baru); transaksi kasir dibatalkan agar stok kembali.
  if (closed.length && intent.referenceType === "pos_sale") await cancelPendingSale(tx, null, intent.referenceId, FAILURE_REASON[status]);
  return status;
}

/**
 * Webhook gateway: verifikasi signature → simpan event (unik per event_key) → terapkan status.
 * Semua dalam satu transaksi: bila gagal, event tidak tersimpan sehingga retry gateway diproses ulang.
 */
export async function handleGatewayNotification(providerName: string, body: unknown) {
  const provider = providerByName(providerName);
  if (!provider) throw new ApiError(404, "PROVIDER_INACTIVE", "Gateway ini tidak aktif.");
  const n = provider.parseNotification(body);
  return db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.provider, provider.name), eq(paymentIntents.gatewayOrderId, n.gatewayOrderId)));
    const inserted = await tx
      .insert(paymentEvents)
      .values({ provider: provider.name, eventKey: n.eventKey, intentId: intent?.id ?? null, payload: body as object, outcome: "RECEIVED" })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!inserted.length) return { outcome: "DUPLICATE" };
    const outcome = intent ? await applyGatewayStatus(tx, intent, n.status, n.amount, n.providerRef) : "UNKNOWN_ORDER";
    await tx.update(paymentEvents).set({ outcome }).where(eq(paymentEvents.id, inserted[0].id));
    if (["AMOUNT_MISMATCH", "ORDER_CANCELLED", "SALE_CANCELLED"].includes(outcome)) {
      // Dana masuk tetapi dokumen tidak bisa dilunasi: perlu refund/cek manual — tercatat di audit log.
      await writeAudit(
        null,
        { action: "payment_attention", entity: intent?.referenceType ?? "payment", entityId: intent?.referenceId ?? null, after: { outcome, gatewayOrderId: n.gatewayOrderId, amount: n.amount } },
        tx,
      );
    }
    return { outcome };
  });
}

/**
 * Cek status intent PENDING ke gateway (fallback bila webhook tidak sampai) dan tutup yang kedaluwarsa.
 * Dibatasi: hanya bila belum dicek dalam `minIntervalMs` terakhir.
 */
export async function syncIntent(intent: Intent, minIntervalMs = 5_000) {
  if (intent.status !== "PENDING" || Date.now() - intent.updatedAt.getTime() < minIntervalMs) return;
  const provider = providerByName(intent.provider);
  const remote = provider ? await provider.getStatus(intent.gatewayOrderId).catch(() => null) : null;
  if (remote && remote.status !== "PENDING") {
    await db.transaction((tx) => applyGatewayStatus(tx, intent, remote.status, remote.amount, remote.providerRef));
    return;
  }
  if (intent.expiresAt.getTime() < Date.now()) {
    // Beri jeda 1 menit untuk notifikasi lunas yang terlambat sebelum dianggap kedaluwarsa.
    if (Date.now() - intent.expiresAt.getTime() > 60_000 || !provider?.getStatus) {
      await provider?.cancel?.(intent.gatewayOrderId).catch(() => null);
      await db.transaction((tx) => applyGatewayStatus(tx, intent, "EXPIRED", intent.amount, null));
      return;
    }
  }
  await db.update(paymentIntents).set({ updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
}

export async function syncLatest(referenceType: IntentReference, referenceId: string) {
  const intent = await latestIntent(referenceType, referenceId);
  if (intent) await syncIntent(intent);
}

/** Development: simulasikan pembeli membayar QR lewat jalur webhook yang sama. */
export async function simulateIntentPaid(intent: Intent) {
  const mock = mockProvider();
  if (!mock) throw new ApiError(404, "SIMULATOR_DISABLED", "Simulator pembayaran hanya ada di development dengan PAYMENT_PROVIDER=mock.");
  if (intent.status !== "PENDING") throw new ApiError(409, "NO_PENDING_QRIS", "Tidak ada QRIS yang menunggu pembayaran.");
  return handleGatewayNotification("mock", mock.buildNotification(intent.gatewayOrderId, intent.amount));
}

/** Kasir membatalkan QR: batalkan di gateway (bila didukung) lalu balik transaksi PENDING. */
export async function cancelIntent(intent: Intent) {
  if (intent.status !== "PENDING") return;
  await providerByName(intent.provider)?.cancel?.(intent.gatewayOrderId).catch(() => null);
  await db.transaction((tx) => applyGatewayStatus(tx, intent, "CANCELLED", intent.amount, null));
}
