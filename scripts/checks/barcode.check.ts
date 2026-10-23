/**
 * Pemeriksaan encoder barcode (src/lib/barcode.ts): struktur EAN/UPC, tabel Code 128, digit cek.
 * Jalankan: pnpm check:barcode
 */
import assert from "node:assert/strict";
import { CODE128_PATTERNS, eanCheckDigit, encodeBarcode } from "../../src/lib/barcode";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// Tabel Code 128: 106 simbol masing-masing 11 modul (3 batang + 3 spasi), stop 13 modul, semua unik.
assert.equal(CODE128_PATTERNS.length, 107);
CODE128_PATTERNS.slice(0, 106).forEach((p, i) => {
  assert.equal(p.length, 6, `pola ${i}`);
  assert.equal([...p].reduce((a, d) => a + Number(d), 0), 11, `lebar pola ${i}`);
  // Jumlah modul batang selalu genap pada Code 128 (paritas).
  assert.equal((Number(p[0]) + Number(p[2]) + Number(p[4])) % 2, 0, `paritas pola ${i}`);
});
assert.equal([...CODE128_PATTERNS[106]].reduce((a, d) => a + Number(d), 0), 13);
assert.equal(new Set(CODE128_PATTERNS.slice(0, 106)).size, 106);
ok("tabel Code 128: 106 pola unik, 11 modul, paritas genap; stop 13 modul");

// Digit cek EAN dari contoh nyata.
assert.equal(eanCheckDigit("400638133393"), 1); // 4006381333931
assert.equal(eanCheckDigit("9638507"), 4); // EAN-8 96385074
ok("digit cek EAN-13 & EAN-8");

const e13 = encodeBarcode("4006381333931");
assert.equal(e13.format, "EAN-13");
assert.equal(e13.modules.length, 95);
assert.ok(e13.modules.startsWith("101") && e13.modules.endsWith("101") && e13.modules.slice(45, 50) === "01010");
// Digit pertama 4 → paritas LGLLGG; digit ke-2 '0' dengan L = 0001101.
assert.equal(e13.modules.slice(3, 10), "0001101");
// Digit ke-3 '0' dengan G = 0100111.
assert.equal(e13.modules.slice(10, 17), "0100111");
ok("EAN-13: 95 modul, guard, paritas sesuai digit pertama");

assert.equal(encodeBarcode("2000000000015").format, "EAN-13");
assert.equal(encodeBarcode("036000291452").format, "UPC-A");
assert.equal(encodeBarcode("036000291452").modules.length, 95);
assert.equal(encodeBarcode("96385074").format, "EAN-8");
assert.equal(encodeBarcode("96385074").modules.length, 67);
ok("UPC-A & EAN-8");

// Angka dengan digit cek salah / SKU huruf → Code 128.
const c = encodeBarcode("KSEC-00042-HTM-L");
assert.equal(c.format, "CODE128");
// start(11) + 16 karakter × 11 + checksum(11) + stop(13)
assert.equal(c.modules.length, 11 + 16 * 11 + 11 + 13);
assert.ok(c.modules.startsWith("11010010000"), "start B");
assert.ok(c.modules.endsWith("1100011101011"), "stop");
assert.equal(encodeBarcode("4006381333932").format, "CODE128");
// Simbol checksum di dalam barcode harus = (104 + Σ nilai×posisi) mod 103.
const sym = (bits: string, i: number) => bits.slice(i * 11, i * 11 + 11);
const vals = [..."KSEC-00042-HTM-L"].map((ch) => ch.charCodeAt(0) - 32);
const expected = vals.reduce((a, v, i) => a + v * (i + 1), 104) % 103;
const toBits = (w: string) => [...w].map((d, i) => (i % 2 === 0 ? "1" : "0").repeat(Number(d))).join("");
assert.equal(sym(c.modules, 17), toBits(CODE128_PATTERNS[expected]));
ok("Code 128 set B: start, stop, panjang, checksum");

assert.throws(() => encodeBarcode("Kode\tTab"));
ok("karakter di luar set B ditolak");

console.log(`\nBarcode: ${passed} pemeriksaan lulus.`);
