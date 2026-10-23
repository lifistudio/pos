/**
 * Pemeriksaan adapter Cloudinary tanpa akun: fetch tiruan memverifikasi endpoint, parameter, dan tanda tangan.
 * Jalankan: pnpm check:media
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
process.env.CLOUDINARY_API_KEY = "123456789012345";
process.env.CLOUDINARY_API_SECRET = "test_secret_value_123";
process.env.CLOUDINARY_FOLDER = "konten-pos";
process.env.DATABASE_URL ??= "postgres://x:y@127.0.0.1:5433/x";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { cloudinaryEnabled, cloudinaryUpload, cloudinaryDestroy, cloudinaryUrl, mediaPublicId, signParams } = await import("../../src/server/media/cloudinary");

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// Contoh resmi dokumentasi Cloudinary (Authentication signatures).
assert.equal(signParams({ timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd"), "bfd09f95f331f558cbd1320e67aa8d488770583e");
ok("tanda tangan cocok dengan contoh dokumentasi");

assert.equal(cloudinaryEnabled(), true);
assert.equal(mediaPublicId("products", "abc"), "konten-pos/products/abc");
ok("konfigurasi env terbaca & public_id berfolder");

const calls: { url: string; form: FormData }[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, form: init.body as FormData });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

function verifySigned(form: FormData) {
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (!["file", "api_key", "signature"].includes(k)) params[k] = String(v);
  const expected = createHash("sha1")
    .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&") + process.env.CLOUDINARY_API_SECRET)
    .digest("hex");
  assert.equal(form.get("signature"), expected, "signature");
  assert.equal(form.get("api_key"), process.env.CLOUDINARY_API_KEY);
  assert.ok(Math.abs(Number(params.timestamp) - Date.now() / 1000) < 60, "timestamp sekarang");
  assert.equal(form.get("api_secret"), null, "secret tidak pernah dikirim");
}

reply = { status: 200, body: { public_id: "konten-pos/products/abc", version: 1712345678, secure_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1712345678/konten-pos/products/abc.webp", width: 800, height: 600, bytes: 52000, format: "webp" } };
const up = await cloudinaryUpload({ data: Buffer.from("RIFF0000WEBPVP8 "), mime: "image/webp", publicId: "konten-pos/products/abc" });
assert.equal(calls[0].url, "https://api.cloudinary.com/v1_1/demo-cloud/image/upload");
verifySigned(calls[0].form);
assert.equal(calls[0].form.get("public_id"), "konten-pos/products/abc");
assert.equal(calls[0].form.get("overwrite"), "true");
assert.equal(calls[0].form.get("invalidate"), "true");
assert.ok(calls[0].form.get("file") instanceof Blob);
assert.equal(up.version, 1712345678);
ok("unggah: endpoint, parameter, file, tanda tangan");

assert.equal(
  cloudinaryUrl(up.publicId, up.version, "c_fill,g_auto,w_480,h_480,f_auto,q_auto"),
  "https://res.cloudinary.com/demo-cloud/image/upload/c_fill,g_auto,w_480,h_480,f_auto,q_auto/v1712345678/konten-pos/products/abc",
);
ok("URL pengiriman dengan transformasi & versi");

reply = { status: 200, body: { result: "ok" } };
await cloudinaryDestroy("konten-pos/products/abc");
assert.equal(calls[1].url, "https://api.cloudinary.com/v1_1/demo-cloud/image/destroy");
verifySigned(calls[1].form);
ok("hapus aset bertanda tangan");

reply = { status: 401, body: { error: { message: "Invalid API key" } } };
await assert.rejects(cloudinaryUpload({ data: Buffer.from("x"), mime: "image/png", publicId: "p" }), (e: { code?: string }) => e.code === "MEDIA_AUTH_FAILED");
reply = { status: 400, body: { error: { message: "Invalid image file" } } };
await assert.rejects(cloudinaryUpload({ data: Buffer.from("x"), mime: "image/png", publicId: "p" }), (e: { code?: string }) => e.code === "MEDIA_UPLOAD_FAILED");
ok("kredensial salah → MEDIA_AUTH_FAILED, ditolak → MEDIA_UPLOAD_FAILED");

console.log(`\nCloudinary: ${passed} pemeriksaan lulus.`);
