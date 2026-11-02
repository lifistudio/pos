import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/server/api/errors";

export type GatewayStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "CANCELLED";

export type GatewayNotification = {
  gatewayOrderId: string;
  status: GatewayStatus;
  amount: number;
  providerRef: string | null;
  /** Kunci idempotensi: notifikasi dengan kunci sama diproses sekali. */
  eventKey: string;
};

/** Yang dibutuhkan gateway untuk memverifikasi notifikasi selain body. */
export type NotificationContext = { headers: Headers; path: string };

export type GatewayStatusResult = { status: GatewayStatus; providerRef: string | null; amount: number } | null;

/**
 * Abstraksi gateway (PRD §3.7): logika order/transaksi tidak tahu gateway mana yang dipakai.
 * Menambah gateway = menambah implementasi interface ini + satu baris di `buildProvider`.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Dikirim balik ke gateway di respons webhook, untuk gateway yang menuntut format tertentu. */
  readonly webhookAck?: Record<string, string>;
  createQris(input: { gatewayOrderId: string; amount: number; expiryMinutes: number }): Promise<{ providerRef: string | null; qrString: string; expiresAt: Date }>;
  /** Cek status langsung ke gateway (dipakai saat webhook belum datang). null = tidak didukung. */
  getStatus(gatewayOrderId: string, providerRef?: string | null): Promise<GatewayStatusResult>;
  /**
   * Validasi notifikasi lalu ubah ke bentuk standar. Signature salah → throw.
   * `verifyOrderId` = notifikasi hanya pemicu, status sebenarnya harus ditanyakan ke gateway.
   */
  parseNotification(body: unknown, ctx: NotificationContext): GatewayNotification | { verifyOrderId: string };
  /** Batalkan transaksi yang belum dibayar di sisi gateway (agar QR tidak bisa dibayar lagi). */
  cancel?(gatewayOrderId: string, providerRef?: string | null): Promise<void>;
}

export const invalidSignature = () => new ApiError(401, "INVALID_SIGNATURE", "Signature notifikasi tidak valid.");
export const gatewayError = (detail?: string) => new ApiError(502, "GATEWAY_ERROR", `Gateway menolak permintaan QRIS${detail ? `: ${detail}` : "."}`);

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
