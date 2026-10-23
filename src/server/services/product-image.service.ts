import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { productImages, products } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, notFound } from "@/server/api/errors";
import { cloudinaryDestroy, cloudinaryEnabled, cloudinaryUpload, cloudinaryUrl, mediaPublicId } from "@/server/media/cloudinary";
import { writeAudit } from "./audit.service";

/** Gambar diperkecil di perangkat (sisi terpanjang ≤ 1024 px, WebP) sebelum diunggah; 1 MB sudah sangat longgar. */
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 2048;
/** Transformasi Cloudinary untuk tile kasir & daftar: kotak 480 px, fokus otomatis, format & kualitas otomatis. */
const CLOUDINARY_THUMB = "c_fill,g_auto,w_480,h_480,f_auto,q_auto";

type Sniffed = { mime: "image/webp" | "image/jpeg" | "image/png"; width: number; height: number };

/** Kenali format dari isi file (bukan dari header Content-Type) dan baca ukuran gambar. */
export function sniffImage(buf: Buffer): Sniffed | null {
  // PNG: signature 8 byte, IHDR berisi lebar/tinggi.
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP: RIFF....WEBP + chunk VP8 / VP8L / VP8X.
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { mime: "image/webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { mime: "image/webp", width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: cari marker SOFn.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: "image/jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export const thumbnailUrl = (productId: string, hash: string) => `/api/v1/products/${productId}/thumbnail?v=${hash}`;

export async function setProductThumbnail(actor: Actor, productId: string, data: Buffer) {
  if (data.length === 0) throw badRequest("EMPTY_FILE", "File gambar kosong.");
  if (data.length > THUMBNAIL_MAX_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "Gambar terlalu besar (maks 1 MB setelah diperkecil). Pilih gambar lain.");
  const info = sniffImage(data);
  if (!info) throw badRequest("UNSUPPORTED_IMAGE", "Format gambar tidak didukung. Pakai JPG, PNG, atau WebP.");
  if (!info.width || !info.height || info.width > MAX_SIDE || info.height > MAX_SIDE) {
    throw badRequest("IMAGE_DIMENSIONS", `Ukuran gambar maksimal ${MAX_SIDE}×${MAX_SIDE} piksel.`);
  }
  const [product] = await db.select({ id: products.id, imageUrl: products.imageUrl }).from(products).where(eq(products.id, productId));
  if (!product) throw notFound("Produk");
  const [previous] = await db.select({ provider: productImages.provider, externalId: productImages.externalId }).from(productImages).where(eq(productImages.productId, productId));

  const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
  let row: typeof productImages.$inferInsert;
  let url: string;
  if (cloudinaryEnabled()) {
    // public_id tetap per produk (ditimpa); versi baru → URL baru sehingga cache browser/CDN tidak basi.
    const up = await cloudinaryUpload({ data, mime: info.mime, publicId: mediaPublicId("products", productId) });
    url = cloudinaryUrl(up.publicId, up.version, CLOUDINARY_THUMB);
    row = { productId, provider: "cloudinary", externalId: up.publicId, data: null, mime: info.mime, width: up.width || info.width, height: up.height || info.height, bytes: up.bytes || data.length, hash: String(up.version) };
  } else {
    url = thumbnailUrl(productId, hash);
    row = { productId, provider: "database", externalId: null, data, mime: info.mime, width: info.width, height: info.height, bytes: data.length, hash };
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(productImages)
      .values(row)
      .onConflictDoUpdate({ target: productImages.productId, set: { ...row, updatedAt: new Date() } });
    await tx.update(products).set({ imageUrl: url, updatedAt: new Date() }).where(eq(products.id, productId));
    await writeAudit(actor, { action: "update", entity: "product_image", entityId: productId, before: { imageUrl: product.imageUrl }, after: { imageUrl: url, provider: row.provider, bytes: row.bytes, mime: info.mime, width: row.width, height: row.height } }, tx);
  });
  // Dulu di Cloudinary dengan public_id lain (mis. folder diganti) → bersihkan aset lama, kegagalan tidak membatalkan.
  if (previous?.provider === "cloudinary" && previous.externalId && previous.externalId !== row.externalId) {
    await cloudinaryDestroy(previous.externalId).catch((e) => console.error("[media] gagal hapus aset lama", e));
  }
  return { imageUrl: url, width: info.width, height: info.height, bytes: data.length };
}

export async function removeProductThumbnail(actor: Actor, productId: string) {
  const [product] = await db.select({ imageUrl: products.imageUrl }).from(products).where(eq(products.id, productId));
  if (!product) throw notFound("Produk");
  const [image] = await db.select({ provider: productImages.provider, externalId: productImages.externalId }).from(productImages).where(eq(productImages.productId, productId));
  if (image?.provider === "cloudinary" && image.externalId) await cloudinaryDestroy(image.externalId);
  await db.transaction(async (tx) => {
    await tx.delete(productImages).where(eq(productImages.productId, productId));
    await tx.update(products).set({ imageUrl: null, updatedAt: new Date() }).where(eq(products.id, productId));
    await writeAudit(actor, { action: "delete", entity: "product_image", entityId: productId, before: { imageUrl: product.imageUrl } }, tx);
  });
}

export async function getProductThumbnail(productId: string) {
  const [row] = await db
    .select({ data: productImages.data, mime: productImages.mime, hash: productImages.hash })
    .from(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.provider, "database")));
  return row?.data ? { ...row, data: row.data } : null;
}
