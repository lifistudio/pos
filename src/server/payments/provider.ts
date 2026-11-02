import "server-only";
import { createHash, createHmac } from "node:crypto";
import { env } from "@/server/env";
import { createDokuProvider } from "./doku";
import { gatewayError, invalidSignature, safeEqual, type GatewayNotification, type GatewayStatus, type PaymentProvider } from "./types";
import { createXenditProvider } from "./xendit";

export type { GatewayNotification, GatewayStatus, NotificationContext, PaymentProvider } from "./types";

// ── Midtrans (Core API, QRIS) ───────────────────────────────────────────

type MidtransPayload = {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
  transaction_status?: string;
  transaction_id?: string;
  fraud_status?: string;
  status_message?: string;
  qr_string?: string;
};

function midtransStatus(p: MidtransPayload): GatewayStatus {
  switch (p.transaction_status) {
    case "settlement":
      return "PAID";
    case "capture":
      return p.fraud_status === "accept" || !p.fraud_status ? "PAID" : "PENDING";
    case "expire":
      return "EXPIRED";
    case "cancel":
      return "CANCELLED";
    case "deny":
    case "failure":
      return "FAILED";
    default:
      return "PENDING";
  }
}

class MidtransProvider implements PaymentProvider {
  readonly name = "midtrans";
  private readonly base: string;
  constructor(private readonly serverKey: string, production: boolean) {
    this.base = production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString("base64")}`,
      ...extra,
    };
  }

  async createQris({ gatewayOrderId, amount, expiryMinutes }: { gatewayOrderId: string; amount: number; expiryMinutes: number }) {
    const res = await fetch(`${this.base}/v2/charge`, {
      method: "POST",
      headers: this.headers(env.PAYMENT_NOTIFICATION_URL ? { "X-Override-Notification": env.PAYMENT_NOTIFICATION_URL } : {}),
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: { order_id: gatewayOrderId, gross_amount: amount },
        custom_expiry: { expiry_duration: expiryMinutes, unit: "minute" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as MidtransPayload;
    if (!res.ok || !data.qr_string || !["200", "201"].includes(data.status_code ?? "")) {
      throw gatewayError(data.status_message);
    }
    return { providerRef: data.transaction_id ?? null, qrString: data.qr_string, expiresAt: new Date(Date.now() + expiryMinutes * 60_000) };
  }

  async getStatus(gatewayOrderId: string) {
    const res = await fetch(`${this.base}/v2/${encodeURIComponent(gatewayOrderId)}/status`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as MidtransPayload;
    if (data.status_code === "404") return null;
    return { status: midtransStatus(data), providerRef: data.transaction_id ?? null, amount: Math.round(Number(data.gross_amount ?? 0)) };
  }

  async cancel(gatewayOrderId: string) {
    await fetch(`${this.base}/v2/${encodeURIComponent(gatewayOrderId)}/cancel`, { method: "POST", headers: this.headers(), signal: AbortSignal.timeout(10_000) });
  }

  parseNotification(body: unknown): GatewayNotification {
    const p = (body ?? {}) as MidtransPayload;
    if (!p.order_id || !p.status_code || !p.gross_amount || !p.signature_key) throw invalidSignature();
    // SHA512(order_id + status_code + gross_amount + ServerKey) — dokumentasi HTTP notification Midtrans.
    const expected = createHash("sha512").update(p.order_id + p.status_code + p.gross_amount + this.serverKey).digest("hex");
    if (!safeEqual(expected, p.signature_key)) throw invalidSignature();
    return {
      gatewayOrderId: p.order_id,
      status: midtransStatus(p),
      amount: Math.round(Number(p.gross_amount)),
      providerRef: p.transaction_id ?? null,
      eventKey: `${p.transaction_id ?? p.order_id}:${p.transaction_status ?? "unknown"}`,
    };
  }
}

// ── Simulator lokal (development) ───────────────────────────────────────

type MockPayload = { order_id: string; transaction_id: string; transaction_status: "settlement" | "expire"; gross_amount: number; signature: string };

/**
 * Gateway palsu untuk development & demo tanpa akun gateway. QR berisi teks penanda (tidak bisa dibayar
 * aplikasi bank); pembayaran disimulasikan lewat endpoint dev yang mengirim notifikasi bertanda tangan
 * HMAC ke jalur webhook yang sama dengan gateway sungguhan. Tidak pernah aktif di production.
 */
class MockProvider implements PaymentProvider {
  readonly name = "mock";
  private sign(p: Omit<MockPayload, "signature">) {
    return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${p.order_id}|${p.transaction_id}|${p.transaction_status}|${p.gross_amount}`).digest("hex");
  }

  async createQris({ gatewayOrderId, amount, expiryMinutes }: { gatewayOrderId: string; amount: number; expiryMinutes: number }) {
    return { providerRef: `mock-${gatewayOrderId}`, qrString: `POS-MOCK-QRIS|${gatewayOrderId}|${amount}`, expiresAt: new Date(Date.now() + expiryMinutes * 60_000) };
  }

  async getStatus() {
    return null;
  }

  /** Buat notifikasi bertanda tangan seperti yang akan dikirim gateway. */
  buildNotification(gatewayOrderId: string, amount: number, status: MockPayload["transaction_status"] = "settlement"): MockPayload {
    const base = { order_id: gatewayOrderId, transaction_id: `mock-${gatewayOrderId}`, transaction_status: status, gross_amount: amount };
    return { ...base, signature: this.sign(base) };
  }

  parseNotification(body: unknown): GatewayNotification {
    const p = (body ?? {}) as Partial<MockPayload>;
    if (!p.order_id || !p.transaction_id || !p.transaction_status || typeof p.gross_amount !== "number" || !p.signature) throw invalidSignature();
    if (!safeEqual(this.sign({ order_id: p.order_id, transaction_id: p.transaction_id, transaction_status: p.transaction_status, gross_amount: p.gross_amount }), p.signature)) {
      throw invalidSignature();
    }
    return {
      gatewayOrderId: p.order_id,
      status: p.transaction_status === "settlement" ? "PAID" : "EXPIRED",
      amount: p.gross_amount,
      providerRef: p.transaction_id,
      eventKey: `${p.transaction_id}:${p.transaction_status}`,
    };
  }
}

const cache = new Map<string, PaymentProvider | null>();

function buildProvider(name: string): PaymentProvider | null {
  if (name === "midtrans") return env.MIDTRANS_SERVER_KEY ? new MidtransProvider(env.MIDTRANS_SERVER_KEY, env.MIDTRANS_IS_PRODUCTION === "true") : null;
  if (name === "xendit") return createXenditProvider();
  if (name === "doku") return createDokuProvider();
  if (name === "mock") return env.PAYMENT_PROVIDER === "mock" && env.NODE_ENV !== "production" ? new MockProvider() : null;
  return null;
}

/**
 * Gateway berdasarkan nama, selama kredensialnya ada. Tidak harus yang aktif: setelah pindah gateway, QR lama
 * masih bisa dibayar, jadi webhook & cek statusnya tetap harus jalan.
 */
export function providerByName(name: string): PaymentProvider | null {
  if (!cache.has(name)) cache.set(name, buildProvider(name));
  return cache.get(name) ?? null;
}

/** Gateway untuk QR baru sesuai env; null = QRIS dinamis tidak tersedia (pembayaran manual tetap bisa). */
export const getPaymentProvider = () => providerByName(env.PAYMENT_PROVIDER);

export function mockProvider(): MockProvider | null {
  const p = getPaymentProvider();
  return p instanceof MockProvider ? p : null;
}
