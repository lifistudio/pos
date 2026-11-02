import "server-only";
import { createHash, createHmac, createSign, randomInt } from "node:crypto";
import { env } from "@/server/env";
import { gatewayError, invalidSignature, type GatewayStatus, type PaymentProvider } from "./types";

/**
 * DOKU QRIS lewat API SNAP.
 * - Token B2B: POST /authorization/v1/access-token/b2b, tanda tangan SHA256withRSA atas `clientId|timestamp`, berlaku 15 menit.
 * - Transaksi: X-SIGNATURE = HMAC-SHA512(secret, `METHOD:path:token:sha256hex(body):timestamp`).
 * - Generate/query/expire: /snap-adapter/b2b/v1.0/qr/qr-mpm-{generate,query}, /qr-expire.
 * Notifikasi tidak dipercaya isinya: hanya memicu query ke DOKU, jadi webhook palsu tidak bisa melunasi apa pun.
 * Encoding hasil HMAC berbeda antarhalaman dokumentasi DOKU (base64 di panduan signature): uji di sandbox sebelum live.
 * Dokumentasi: https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/qris
 */
const HOSTS = { production: "https://api.doku.com", sandbox: "https://api-sandbox.doku.com" };
const QR_PATH = "/snap-adapter/b2b/v1.0/qr";
const TOKEN_PATH = "/authorization/v1/access-token/b2b";
const TOKEN_MARGIN_MS = 60_000;
/** Kode layanan QRIS MPM di standar SNAP. */
const SERVICE_CODE = "47";

export type DokuConfig = { clientId: string; secretKey: string; privateKey: string; merchantId: string; terminalId: string; postalCode: string; base: string };

type SnapResponse = {
  responseCode?: string;
  responseMessage?: string;
  accessToken?: string;
  expiresIn?: string | number;
  referenceNo?: string;
  qrContent?: string;
  originalReferenceNo?: string;
  latestTransactionStatus?: string;
  amount?: { value?: string };
};

/** Standar SNAP: 00 berhasil, 05 dibatalkan, 06 gagal; selain itu masih berjalan. */
const SNAP_STATUS: Record<string, GatewayStatus> = { "00": "PAID", "05": "CANCELLED", "06": "FAILED" };

/** X-TIMESTAMP transaksi: waktu lokal WIB dengan offset. */
export function snapTimestamp(date = new Date()) {
  return `${new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

export function dokuSignature(secret: string, method: string, path: string, token: string, body: string, timestamp: string) {
  const hash = createHash("sha256").update(body).digest("hex").toLowerCase();
  return createHmac("sha512", secret).update(`${method}:${path}:${token}:${hash}:${timestamp}`).digest("base64");
}

export class DokuProvider implements PaymentProvider {
  readonly name = "doku";
  /** Respons sukses standar SNAP untuk notifikasi QRIS. */
  readonly webhookAck = { responseCode: "2005200", responseMessage: "Successful" };
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: DokuConfig) {}

  private async accessToken() {
    if (this.token && this.token.expiresAt - Date.now() > TOKEN_MARGIN_MS) return this.token.value;
    const timestamp = new Date().toISOString().slice(0, 19) + "Z";
    const signature = createSign("RSA-SHA256").update(`${this.config.clientId}|${timestamp}`).sign(this.config.privateKey, "base64");
    const res = await fetch(`${this.config.base}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CLIENT-KEY": this.config.clientId, "X-TIMESTAMP": timestamp, "X-SIGNATURE": signature },
      body: JSON.stringify({ grantType: "client_credentials" }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as SnapResponse;
    if (!res.ok || !data.accessToken) throw gatewayError(data.responseMessage);
    this.token = { value: data.accessToken, expiresAt: Date.now() + Number(data.expiresIn ?? 900) * 1000 };
    return data.accessToken;
  }

  private async call(path: string, payload: unknown) {
    const token = await this.accessToken();
    const body = JSON.stringify(payload);
    const timestamp = snapTimestamp();
    const res = await fetch(`${this.config.base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-PARTNER-ID": this.config.clientId,
        // Unik per hari, angka saja.
        "X-EXTERNAL-ID": `${Date.now()}${randomInt(1000, 9999)}`,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": dokuSignature(this.config.secretKey, "POST", path, token, body, timestamp),
        "CHANNEL-ID": "H2H",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as SnapResponse;
    return { ok: res.ok && (data.responseCode ?? "").startsWith("200"), data };
  }

  async createQris({ gatewayOrderId, amount, expiryMinutes }: { gatewayOrderId: string; amount: number; expiryMinutes: number }) {
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
    const { ok, data } = await this.call(`${QR_PATH}/qr-mpm-generate`, {
      partnerReferenceNo: gatewayOrderId,
      amount: { value: `${amount}.00`, currency: "IDR" },
      merchantId: this.config.merchantId,
      terminalId: this.config.terminalId,
      validityPeriod: snapTimestamp(expiresAt),
      additionalInfo: { postalCode: this.config.postalCode, feeType: "1" },
    });
    if (!ok || !data.qrContent) throw gatewayError(data.responseMessage);
    return { providerRef: data.referenceNo ?? null, qrString: data.qrContent, expiresAt };
  }

  async getStatus(gatewayOrderId: string, providerRef?: string | null) {
    if (!providerRef) return null;
    const { ok, data } = await this.call(`${QR_PATH}/qr-mpm-query`, {
      originalReferenceNo: providerRef,
      originalPartnerReferenceNo: gatewayOrderId,
      serviceCode: SERVICE_CODE,
      merchantId: this.config.merchantId,
    });
    if (!ok) return null;
    return { status: SNAP_STATUS[data.latestTransactionStatus ?? ""] ?? ("PENDING" as const), providerRef, amount: Math.round(Number(data.amount?.value ?? 0)) };
  }

  async cancel(gatewayOrderId: string, providerRef?: string | null) {
    if (!providerRef) return;
    await this.call(`${QR_PATH}/qr-expire`, { partnerReferenceNo: gatewayOrderId, referenceNo: providerRef, merchantId: this.config.merchantId, reason: "Dibatalkan" });
  }

  parseNotification(body: unknown) {
    const b = (body ?? {}) as { originalPartnerReferenceNo?: string; partnerReferenceNo?: string };
    const verifyOrderId = b.originalPartnerReferenceNo ?? b.partnerReferenceNo;
    if (!verifyOrderId) throw invalidSignature();
    return { verifyOrderId };
  }
}

export function createDokuProvider() {
  const { DOKU_CLIENT_ID: clientId, DOKU_SECRET_KEY: secretKey, DOKU_PRIVATE_KEY: privateKey, DOKU_MERCHANT_ID: merchantId, DOKU_TERMINAL_ID: terminalId, DOKU_POSTAL_CODE: postalCode } = env;
  if (!clientId || !secretKey || !privateKey || !merchantId || !terminalId || !postalCode) return null;
  return new DokuProvider({
    clientId,
    secretKey,
    privateKey: privateKey.replaceAll("\\n", "\n"),
    merchantId,
    terminalId,
    postalCode,
    base: env.DOKU_IS_PRODUCTION === "true" ? HOSTS.production : HOSTS.sandbox,
  });
}
