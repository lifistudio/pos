import "server-only";
import { env } from "@/server/env";
import { gatewayError, invalidSignature, safeEqual, type GatewayNotification, type GatewayStatus, type NotificationContext, type PaymentProvider } from "./types";

/**
 * Xendit Payments API v3 (QRIS). Mode test/live mengikuti jenis secret key, host-nya sama.
 * - Buat: POST /v3/payment_requests (channel_code QRIS), QR ada di actions[descriptor=QR_STRING].
 * - Status: GET /v3/payment_requests/{id}.
 * - Webhook: header x-callback-token + event payment.capture / payment.failure.
 * Xendit tidak mendokumentasikan pembatalan QR yang belum dibayar: QR berlaku sampai kedaluwarsa, jadi tidak ada `cancel`.
 * Pembayaran setelah kasir membatalkan tertangkap sebagai SALE_CANCELLED/ORDER_CANCELLED dan masuk audit untuk refund.
 * Dokumentasi: https://docs.xendit.co/apidocs/create-payment-request
 */
const BASE = "https://api.xendit.co/v3";
const API_VERSION = "2024-11-11";

type PaymentRequest = {
  payment_request_id?: string;
  reference_id?: string;
  status?: string;
  request_amount?: number;
  actions?: { type?: string; descriptor?: string; value?: string }[];
  message?: string;
  error_code?: string;
};

const REQUEST_STATUS: Record<string, GatewayStatus> = { SUCCEEDED: "PAID", EXPIRED: "EXPIRED", CANCELED: "CANCELLED", FAILED: "FAILED" };

export class XenditProvider implements PaymentProvider {
  readonly name = "xendit";
  constructor(
    private readonly secretKey: string,
    private readonly webhookToken: string,
    private readonly base = BASE,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      "Content-Type": "application/json",
      "api-version": API_VERSION,
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
      ...extra,
    };
  }

  async createQris({ gatewayOrderId, amount, expiryMinutes }: { gatewayOrderId: string; amount: number; expiryMinutes: number }) {
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
    const res = await fetch(`${this.base}/payment_requests`, {
      method: "POST",
      headers: this.headers({ "idempotency-key": gatewayOrderId }),
      body: JSON.stringify({
        reference_id: gatewayOrderId,
        type: "PAY",
        country: "ID",
        currency: "IDR",
        request_amount: amount,
        capture_method: "AUTOMATIC",
        channel_code: "QRIS",
        channel_properties: { expires_at: expiresAt.toISOString() },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as PaymentRequest;
    const qrString = data.actions?.find((a) => a.descriptor === "QR_STRING")?.value;
    if (!res.ok || !qrString) throw gatewayError(data.message);
    return { providerRef: data.payment_request_id ?? null, qrString, expiresAt };
  }

  async getStatus(_gatewayOrderId: string, providerRef?: string | null) {
    if (!providerRef) return null;
    const res = await fetch(`${this.base}/payment_requests/${encodeURIComponent(providerRef)}`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as PaymentRequest;
    return { status: REQUEST_STATUS[data.status ?? ""] ?? ("PENDING" as const), providerRef, amount: Math.round(Number(data.request_amount ?? 0)) };
  }

  parseNotification(body: unknown, ctx: NotificationContext): GatewayNotification {
    if (!safeEqual(this.webhookToken, ctx.headers.get("x-callback-token") ?? "")) throw invalidSignature();
    const { event, data } = (body ?? {}) as { event?: string; data?: { payment_id?: string; payment_request_id?: string; reference_id?: string; status?: string; request_amount?: number; captures?: { capture_id?: string; capture_amount?: number }[] } };
    if (!data?.reference_id) throw invalidSignature();
    // Satu percobaan gagal tidak berarti QR-nya mati, pelanggan bisa mencoba lagi. Status akhir diambil dari cek status.
    const status: GatewayStatus = event === "payment.capture" && data.status === "SUCCEEDED" ? "PAID" : "PENDING";
    const capture = data.captures?.[0];
    return {
      gatewayOrderId: data.reference_id,
      status,
      amount: Math.round(Number(capture?.capture_amount ?? data.request_amount ?? 0)),
      providerRef: data.payment_request_id ?? null,
      eventKey: `${data.payment_id ?? data.reference_id}:${capture?.capture_id ?? ""}:${event ?? "unknown"}`,
    };
  }
}

export function createXenditProvider() {
  return env.XENDIT_SECRET_KEY && env.XENDIT_WEBHOOK_TOKEN ? new XenditProvider(env.XENDIT_SECRET_KEY, env.XENDIT_WEBHOOK_TOKEN) : null;
}
