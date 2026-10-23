/**
 * Perkecil gambar di perangkat sebelum diunggah: sisi terpanjang ≤ `maxSide` (default 1024 px), WebP (JPEG bila browser tidak
 * bisa meng-encode WebP). Foto HP 4–8 MB menjadi ±60–200 KB — hemat kuota & cepat tampil di kasir.
 * Metadata EXIF (termasuk lokasi) ikut hilang karena gambar digambar ulang di canvas.
 */
export async function resizeImage(file: File, maxSide = 1024): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("File bukan gambar.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Gambar tidak bisa dibaca. Pakai JPG, PNG, atau WebP.");
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pengolahan gambar.");
  // Latar putih agar PNG transparan tidak menjadi hitam saat disimpan sebagai JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode("image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg", 0.85);
  if (!jpeg) throw new Error("Gagal memproses gambar.");
  return jpeg;
}
