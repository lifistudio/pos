import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

export type Channel = "WEBSITE" | "WHATSAPP" | "INSTAGRAM" | "SHOPEE" | "TOKOPEDIA" | "TIKTOK" | "LAZADA" | "OTHER";

/** `extra`: data spesifik marketplace yang ikut terenkripsi (mis. shop_cipher & gudang TikTok Shop). */
export type Credentials = { accessToken: string; refreshToken: string; expiresAt: string; extra?: Record<string, string> };
export type AdapterContext = { shopId: string; credentials: Credentials | null };

/** Status order marketplace yang sudah dinormalisasi ke alur Konten. */
export type MpOrderStatus = "UNPAID" | "PAID" | "SHIPPED" | "COMPLETED" | "CANCELLED";

export type MpOrderItem = { externalItemId: string; externalModelId: string; sku: string | null; name: string; qty: number; unitPrice: number };
export type MpOrder = {
  externalOrderNo: string;
  status: MpOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  courier: string | null;
  trackingNo: string | null;
  note: string | null;
  items: MpOrderItem[];
};
export type MpListing = { externalItemId: string; externalModelId: string; sku: string | null; name: string; stock: number | null };

/**
 * Kontrak adapter marketplace. Logika sinkron (pemetaan SKU, reservasi, status order, push stok) ada di
 * marketplace.service dan tidak tahu marketplace mana yang dipakai — menambah marketplace = menambah adapter.
 */
export interface MarketplaceAdapter {
  readonly provider: string;
  readonly channel: Channel;
  readonly label: string;
  /** true = toko dihubungkan lewat OAuth (redirect ke marketplace). */
  readonly oauth: boolean;
  authorizeUrl?(redirectUrl: string): string;
  exchangeCode?(params: URLSearchParams): Promise<{ shopId: string; shopName: string; credentials: Credentials }>;
  refresh?(ctx: AdapterContext): Promise<Credentials>;
  /** Nomor order yang berubah dalam rentang waktu (berdasarkan waktu update). */
  listUpdatedOrders(ctx: AdapterContext, from: Date, to: Date): Promise<string[]>;
  getOrders(ctx: AdapterContext, orderNos: string[]): Promise<MpOrder[]>;
  listListings(ctx: AdapterContext): Promise<MpListing[]>;
  updateStock(ctx: AdapterContext, rows: { externalItemId: string; externalModelId: string; qty: number }[]): Promise<{ failed: { ref: string; message: string }[] }>;
  /** Verifikasi signature push & ambil order yang berubah. Signature salah → throw. null = event diabaikan. */
  parseWebhook(rawBody: string, headers: Headers, url: string): { shopId: string; orderNos: string[] } | null;
}

export class MarketplaceError extends Error {
  constructor(
    message: string,
    public readonly kind: "AUTH" | "RATE_LIMIT" | "REMOTE" = "REMOTE",
  ) {
    super(message);
  }
}

// ── Enkripsi kredensial (AES-256-GCM) ───────────────────────────────────

function key() {
  if (env.MARKETPLACE_SECRET) return Buffer.from(hkdfSync("sha256", env.MARKETPLACE_SECRET, "konten", "marketplace-credentials", 32));
  return Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "konten", "marketplace-credentials", 32));
}

export function encryptCredentials(c: Credentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptCredentials(blob: string): Credentials {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1") throw new MarketplaceError("Format kredensial tidak dikenal.", "AUTH");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8"));
}

// ── State OAuth bertanda tangan (mencegah CSRF di callback) ─────────────

export function signState(payload: { userId: string; branchId: string; provider: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string, maxAgeMs = 15 * 60_000) {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key()).update(body).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { userId: string; branchId: string; provider: string; ts: number };
  return Date.now() - payload.ts > maxAgeMs ? null : payload;
}

export const safeEqualHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
