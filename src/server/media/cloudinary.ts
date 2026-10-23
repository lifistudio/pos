import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/server/env";
import { ApiError } from "@/server/api/errors";

/**
 * Penyimpanan media di Cloudinary lewat REST API resmi (tanpa SDK): unggahan bertanda tangan dari server,
 * API secret tidak pernah dikirim ke browser. Aktif bila CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET diisi.
 * Dokumentasi: https://cloudinary.com/documentation/image_upload_api_reference
 */

export type ResourceType = "image" | "video" | "raw";

export function cloudinaryEnabled() {
  return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

/** Tanda tangan: parameter diurutkan alfabetis "k=v&k2=v2" + API secret, lalu SHA-1 (hex). */
export function signParams(params: Record<string, string | number | boolean>, secret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(payload + secret).digest("hex");
}

async function call(path: string, params: Record<string, string | number | boolean>, file?: { data: Buffer; mime: string }) {
  if (!cloudinaryEnabled()) throw new ApiError(503, "MEDIA_NOT_CONFIGURED", "Penyimpanan media (Cloudinary) belum dikonfigurasi.");
  const signed = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.set(k, String(v));
  form.set("api_key", env.CLOUDINARY_API_KEY!);
  form.set("signature", signParams(signed, env.CLOUDINARY_API_SECRET!));
  if (file) form.set("file", new Blob([new Uint8Array(file.data)], { type: file.mime }));
  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${path}`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError(502, "MEDIA_UNREACHABLE", "Tidak bisa terhubung ke Cloudinary. Periksa koneksi server lalu coba lagi.");
  }
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = (payload?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    // Pesan Cloudinary tidak berisi secret; tetap diringkas agar tidak membocorkan detail konfigurasi ke klien.
    console.error("[cloudinary]", path, res.status, message);
    if (res.status === 401) throw new ApiError(502, "MEDIA_AUTH_FAILED", "Kredensial Cloudinary ditolak. Periksa CLOUDINARY_API_KEY dan CLOUDINARY_API_SECRET.");
    throw new ApiError(502, "MEDIA_UPLOAD_FAILED", "Cloudinary menolak permintaan. Coba lagi atau hubungi admin.");
  }
  return payload ?? {};
}

export type UploadResult = { publicId: string; version: number; secureUrl: string; width: number; height: number; bytes: number; format: string };

/** Unggah (atau timpa) aset dengan public_id tetap. `invalidate` membersihkan cache CDN versi lama. */
export async function cloudinaryUpload(input: { data: Buffer; mime: string; publicId: string; resourceType?: ResourceType }) {
  const r = await call(
    `${input.resourceType ?? "image"}/upload`,
    { public_id: input.publicId, overwrite: true, invalidate: true },
    { data: input.data, mime: input.mime },
  );
  return {
    publicId: String(r.public_id),
    version: Number(r.version),
    secureUrl: String(r.secure_url),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    bytes: Number(r.bytes ?? 0),
    format: String(r.format ?? ""),
  } satisfies UploadResult;
}

export async function cloudinaryDestroy(publicId: string, resourceType: ResourceType = "image") {
  await call(`${resourceType}/destroy`, { public_id: publicId, invalidate: true });
}

/**
 * URL pengiriman dengan transformasi on-the-fly, misal "c_fill,g_auto,w_480,h_480,f_auto,q_auto"
 * (potong rapi ke kotak, format & kualitas otomatis sesuai browser).
 */
export function cloudinaryUrl(publicId: string, version: number, transformation: string, resourceType: ResourceType = "image") {
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/${transformation}/v${version}/${publicId}`;
}

/** public_id untuk sebuah kelompok aset, misal mediaPublicId("products", id) → "konten-pos/products/<id>". */
export const mediaPublicId = (group: string, id: string) => `${env.CLOUDINARY_FOLDER}/${group}/${id}`;
