import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Jumlah reverse proxy tepercaya di depan aplikasi; menentukan IP asli dari X-Forwarded-For (rate limit & audit). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Gateway QRIS dinamis: "mock" (simulator lokal, hanya non-production), "midtrans", "xendit", "doku", atau "none". */
  PAYMENT_PROVIDER: z.enum(["mock", "midtrans", "xendit", "doku", "none"]).default("mock"),
  MIDTRANS_SERVER_KEY: z.string().min(10).optional(),
  MIDTRANS_IS_PRODUCTION: z.enum(["true", "false"]).default("false"),
  /** URL publik webhook (mis. https://toko.com/api/payments/webhook/midtrans); dikirim sebagai X-Override-Notification. */
  PAYMENT_NOTIFICATION_URL: z.string().url().optional(),
  /** Xendit Payments API v3. Secret key + token verifikasi webhook (Dashboard › Webhooks). Test/live mengikuti jenis key. */
  XENDIT_SECRET_KEY: z.string().min(10).optional(),
  XENDIT_WEBHOOK_TOKEN: z.string().min(10).optional(),
  /** DOKU QRIS (SNAP). Client ID & secret + private key RSA untuk token B2B; merchant & terminal dari persetujuan QRIS DOKU. */
  DOKU_CLIENT_ID: z.string().min(4).optional(),
  DOKU_SECRET_KEY: z.string().min(10).optional(),
  /** Isi PEM satu baris dengan \n, atau berkas PEM utuh. */
  DOKU_PRIVATE_KEY: z.string().min(50).optional(),
  DOKU_MERCHANT_ID: z.string().min(1).optional(),
  DOKU_TERMINAL_ID: z.string().min(3).max(16).optional(),
  DOKU_POSTAL_CODE: z.string().regex(/^\d{1,5}$/).optional(),
  DOKU_IS_PRODUCTION: z.enum(["true", "false"]).default("false"),
  /** Masa berlaku QR (menit). */
  QRIS_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Email keluar untuk lupa password. Tanpa SMTP_HOST, fitur lupa password tidak tampil. */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true = TLS langsung (port 465); false = STARTTLS bila tersedia (port 587). */
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(3).optional(),
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
  CLOUDINARY_FOLDER: z.string().regex(/^[a-z0-9_/-]+$/i).default("pos-lifistudio"),
});

/** Gagal cepat saat env tidak lengkap, tanpa membocorkan nilainya. */
export const env = schema.parse(process.env);
