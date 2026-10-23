import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Gateway QRIS dinamis: "mock" (simulator lokal, hanya non-production) atau "midtrans". */
  PAYMENT_PROVIDER: z.enum(["mock", "midtrans", "none"]).default("mock"),
  MIDTRANS_SERVER_KEY: z.string().min(10).optional(),
  MIDTRANS_IS_PRODUCTION: z.enum(["true", "false"]).default("false"),
  /** URL publik webhook (mis. https://toko.com/api/payments/webhook/midtrans); dikirim sebagai X-Override-Notification. */
  PAYMENT_NOTIFICATION_URL: z.string().url().optional(),
  /** Masa berlaku QR (menit). */
  QRIS_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Shopee Open Platform (opsional). Tanpa ini, adapter Shopee tidak tersedia. */
  SHOPEE_PARTNER_ID: z.string().regex(/^\d+$/).optional(),
  SHOPEE_PARTNER_KEY: z.string().min(10).optional(),
  SHOPEE_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  /** TikTok Shop / Tokopedia Partner API (opsional). Service ID dari Partner Center untuk URL otorisasi. */
  TIKTOK_APP_KEY: z.string().min(4).optional(),
  TIKTOK_APP_SECRET: z.string().min(10).optional(),
  TIKTOK_SERVICE_ID: z.string().min(4).optional(),
  /** Kunci enkripsi token marketplace (≥32 karakter). Default: diturunkan dari BETTER_AUTH_SECRET. */
  MARKETPLACE_SECRET: z.string().min(32).optional(),
  /**
   * Cloudinary untuk aset media (gambar produk, video, dll.). Bila ketiganya diisi, unggahan disimpan di Cloudinary;
   * bila kosong, gambar disimpan di database (cukup untuk demo/development).
   */
  CLOUDINARY_CLOUD_NAME: z.string().regex(/^[a-z0-9_-]+$/i, "Cloud name hanya huruf, angka, - dan _").optional(),
  CLOUDINARY_API_KEY: z.string().regex(/^\d+$/, "API key Cloudinary berupa angka").optional(),
  CLOUDINARY_API_SECRET: z.string().min(10).optional(),
  /** Folder induk di Media Library Cloudinary. */
  CLOUDINARY_FOLDER: z.string().regex(/^[a-z0-9_/-]+$/i).default("konten-pos"),
});

/** Gagal cepat saat env tidak lengkap, tanpa membocorkan nilainya. */
export const env = schema.parse(process.env);
