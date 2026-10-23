import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { numberSequences } from "@/server/db/schema";
import { ApiError } from "@/server/api/errors";
import { skuPart } from "@/lib/slug";

/**
 * SKU & barcode varian: unik di seluruh katalog, termasuk SILANG (barcode varian A tidak boleh sama dengan SKU varian B),
 * karena scan di kasir/stok mencocokkan keduanya. SKU dibandingkan tanpa beda huruf besar/kecil.
 * Penulisan dibuat berurutan dengan advisory lock transaksi agar dua penyimpanan bersamaan tidak menghasilkan kode sama.
 */

export type CodeRequest = {
  /** Kosong/null = buat otomatis; `false` = tidak diubah (tidak divalidasi, tidak dibuat). */
  sku?: string | null | false;
  barcode?: string | null | false;
  /** Bagian penanda varian untuk SKU otomatis, misal ["Hitam", "L"]. */
  optionValues: string[];
};

export const normalizeSku = (value: string) => value.trim().toUpperCase();
export const normalizeBarcode = (value: string) => value.replace(/\s+/g, "");

/** Validasi digit cek untuk EAN-8 / UPC-A / EAN-13 / GTIN-14 (barcode angka murni dengan panjang itu). */
export function hasValidCheckDigit(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return true;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** EAN-13 "in-store" GS1 (awalan 20–29, tidak bentrok dengan barcode pabrik) dari counter global. */
export function ean13FromNumber(n: number) {
  const body = "20" + String(n).padStart(10, "0");
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + ((10 - (sum % 10)) % 10);
}

async function nextCounter(tx: Tx, key: string, count: number) {
  const [row] = await tx
    .insert(numberSequences)
    .values({ key, value: count })
    .onConflictDoUpdate({ target: numberSequences.key, set: { value: sql`${numberSequences.value} + ${count}` } })
    .returning({ value: numberSequences.value });
  // Rentang [value-count+1 .. value] milik pemanggil ini.
  return Array.from({ length: count }, (_, i) => row.value - count + 1 + i);
}

function conflict(code: string, message: string, details?: unknown): never {
  throw new ApiError(409, code, message, details);
}

const list = (values: string[]) => sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

/** Kode yang sudah dipakai varian lain (SKU tanpa beda kapital, barcode persis, dan silang keduanya). */
async function findTaken(tx: Tx, codes: string[], excludeVariantId?: string) {
  if (!codes.length) return [];
  const upper = codes.map((c) => c.toUpperCase());
  const rows = await tx.execute<{ id: string; sku: string; barcode: string | null; product: string; title: string }>(sql`
    select v.id, v.sku, v.barcode, p.name as product, v.title
    from product_variants v join products p on p.id = v.product_id
    where (upper(v.sku) in ${list(upper)} or upper(v.barcode) in ${list(upper)})
      ${excludeVariantId ? sql`and v.id <> ${excludeVariantId}` : sql``}`);
  return [...rows];
}

const describe = (r: { product: string; title: string }) => (r.title === "Default" ? r.product : `${r.product} (${r.title})`);

/**
 * Tentukan SKU & barcode final untuk sekumpulan varian (satu produk). Kode manual divalidasi; yang kosong dibuat otomatis.
 * Wajib dipanggil di dalam transaksi yang juga menulis variannya.
 */
export async function resolveVariantCodes(tx: Tx, productName: string, requests: CodeRequest[], options: { excludeVariantId?: string } = {}) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('konten:variant-codes'))`);

  const result = requests.map((r) => ({
    sku: r.sku === false ? null : r.sku?.trim() ? normalizeSku(r.sku) : null,
    barcode: r.barcode === false ? null : r.barcode?.trim() ? normalizeBarcode(r.barcode) : null,
  }));

  // 1) Validasi format manual.
  for (const r of result) {
    if (r.sku && !/^[A-Z0-9._-]{2,64}$/.test(r.sku)) {
      throw new ApiError(400, "INVALID_SKU", `SKU "${r.sku}" tidak valid. Pakai 2–64 huruf, angka, titik, - atau _.`);
    }
    if (r.barcode && !/^[A-Za-z0-9.-]{4,32}$/.test(r.barcode)) {
      throw new ApiError(400, "INVALID_BARCODE", `Barcode "${r.barcode}" tidak valid. Pakai 4–32 huruf/angka tanpa spasi.`);
    }
    if (r.barcode && !hasValidCheckDigit(r.barcode)) {
      throw new ApiError(400, "INVALID_BARCODE_CHECKSUM", `Digit terakhir barcode ${r.barcode} tidak cocok. Periksa kembali, mungkin salah ketik.`);
    }
  }

  // 2) Duplikat di dalam permintaan ini (termasuk silang SKU ↔ barcode).
  const seen = new Map<string, string>();
  for (const [i, r] of result.entries()) {
    for (const [kind, code] of [["SKU", r.sku], ["barcode", r.barcode]] as const) {
      if (!code) continue;
      const key = code.toUpperCase();
      const prev = seen.get(key);
      if (prev && prev !== `${i}:${kind}`) conflict("CODE_DUPLICATE_IN_REQUEST", `${kind} ${code} dipakai lebih dari sekali pada produk ini.`);
      seen.set(key, `${i}:${kind}`);
    }
  }

  // 3) Bentrok dengan varian lain di database.
  const manual = result.flatMap((r) => [r.sku, r.barcode]).filter((c): c is string => !!c);
  const taken = await findTaken(tx, manual, options.excludeVariantId);
  for (const r of result) {
    if (r.sku) {
      const hit = taken.find((t) => t.sku.toUpperCase() === r.sku || t.barcode?.toUpperCase() === r.sku);
      if (hit) conflict("SKU_TAKEN", `SKU ${r.sku} sudah dipakai ${hit.sku.toUpperCase() === r.sku ? "sebagai SKU" : "sebagai barcode"} produk ${describe(hit)}. Gunakan SKU lain atau biarkan otomatis.`, { variantId: hit.id });
    }
    if (r.barcode) {
      const hit = taken.find((t) => t.barcode?.toUpperCase() === r.barcode!.toUpperCase() || t.sku.toUpperCase() === r.barcode!.toUpperCase());
      if (hit) conflict("BARCODE_TAKEN", `Barcode ${r.barcode} sudah dipakai ${hit.barcode?.toUpperCase() === r.barcode.toUpperCase() ? "sebagai barcode" : "sebagai SKU"} produk ${describe(hit)}.`, { variantId: hit.id });
    }
  }

  // 4) SKU otomatis: KODE-NNNNN[-OPSI-...], nomor dari counter global → selalu unik antarproduk.
  const needSku = result.map((r, i) => (r.sku || requests[i].sku === false ? -1 : i)).filter((i) => i >= 0);
  if (needSku.length) {
    const base = skuPart(productName, 4) || "PRD";
    let [n] = await nextCounter(tx, "SKU", 1);
    for (let attempt = 0; attempt < 20; attempt++) {
      const stem = `${base}-${String(n).padStart(5, "0")}`;
      const used = new Set(result.flatMap((r) => [r.sku, r.barcode]).filter(Boolean).map((c) => c!.toUpperCase()));
      const candidates = needSku.map((i) => {
        const parts = requests[i].optionValues.map((v) => skuPart(v, 3));
        let sku = [stem, ...parts].join("-");
        for (let k = 2; used.has(sku); k++) sku = `${[stem, ...parts].join("-")}-${k}`;
        used.add(sku);
        return sku;
      });
      const clash = await findTaken(tx, candidates, options.excludeVariantId);
      if (!clash.length) {
        needSku.forEach((i, j) => (result[i].sku = candidates[j]));
        break;
      }
      [n] = await nextCounter(tx, "SKU", 1);
    }
    if (needSku.some((i) => !result[i].sku)) throw new ApiError(500, "SKU_GENERATION_FAILED", "Gagal membuat SKU otomatis. Coba lagi.");
  }

  // 5) Barcode otomatis: EAN-13 in-store dari counter global (lewati yang kebetulan sudah dipakai manual).
  const needBarcode = result.map((r, i) => (r.barcode || requests[i].barcode === false ? -1 : i)).filter((i) => i >= 0);
  let pending = needBarcode;
  for (let attempt = 0; pending.length && attempt < 20; attempt++) {
    const numbers = await nextCounter(tx, "EAN13", pending.length);
    const candidates = numbers.map(ean13FromNumber);
    const clash = new Set((await findTaken(tx, candidates, options.excludeVariantId)).flatMap((t) => [t.barcode, t.sku.toUpperCase()]));
    const next: number[] = [];
    pending.forEach((i, j) => {
      if (clash.has(candidates[j])) next.push(i);
      else result[i].barcode = candidates[j];
    });
    pending = next;
  }
  if (pending.length) throw new ApiError(500, "BARCODE_GENERATION_FAILED", "Gagal membuat barcode otomatis. Coba lagi.");

  // Field yang ditandai `false` dikembalikan null (pemanggil tidak menulisnya).
  return result;
}

/** Untuk validasi langsung di form: siapa yang sudah memakai kode ini (SKU atau barcode)? */
export async function findCodeOwner(code: string, excludeVariantId?: string) {
  const value = code.trim();
  if (!value) return null;
  const [hit] = await findTaken(db as unknown as Tx, [value], excludeVariantId);
  if (!hit) return null;
  return {
    variantId: hit.id,
    productName: hit.product,
    variantTitle: hit.title,
    usedAs: hit.sku.toUpperCase() === value.toUpperCase() ? ("SKU" as const) : ("BARCODE" as const),
  };
}
