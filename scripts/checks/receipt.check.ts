/**
 * Pemeriksaan struk: tata letak tidak melebihi lebar kertas, byte ESC/POS benar, PDF valid (xref menunjuk objek).
 * Jalankan: pnpm check:receipt
 */
import assert from "node:assert/strict";
import { escPosReceipt } from "../../src/lib/receipt/escpos";
import { columnsFor, layoutReceipt, toAscii, toPlainLines, twoCol, wrap, type ReceiptDoc } from "../../src/lib/receipt/layout";
import { receiptPdf } from "../../src/lib/receipt/pdf";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const doc: ReceiptDoc = {
  storeName: "Toko Contoh Cabang Bandung Dago Atas",
  headerLines: ["Jl. Ir. H. Juanda No. 45, Bandung — 40135", "0812 3456 7890"],
  banner: null,
  meta: [["No.", "INV/BDG/261021/0001"], ["Waktu", "21 Okt 2026 14.30"], ["Kasir", "Rina Kasir Bandung"], ["Customer", "Sari Wulandari (M-000123)"]],
  items: [
    { name: "Kaos Essential Cotton Hitam / XL dengan nama produk yang sangat panjang sekali", qtyLine: "2 x Rp149.000", amount: "Rp298.000" },
    { name: "Café Latté (ç)", qtyLine: "1 × Rp25.000", amount: "Rp25.000" },
  ],
  summary: [{ label: "Subtotal", value: "Rp323.000" }, { label: "Voucher MEMBER20", value: "-Rp50.000" }, { label: "TOTAL", value: "Rp273.000", bold: true }],
  payments: [["Tunai", "Rp300.000"], ["Kembali", "Rp27.000"]],
  extra: [["Poin didapat", "+27"]],
  footerLines: ["Terima kasih telah berbelanja", "Barang yang sudah dibeli dapat ditukar 7 hari dengan struk"],
};

assert.equal(toAscii("Café × Latté — “ok” …"), 'Cafe x Latte - "ok" ...');
assert.deepEqual(wrap("satu dua tiga empat", 9), ["satu dua", "tiga", "empat"]);
assert.deepEqual(wrap("abcdefghijkl", 5), ["abcde", "fghij", "kl"]);
assert.deepEqual(twoCol("Total", "Rp1.000", 20), ["Total        Rp1.000"]);
assert.deepEqual(twoCol("Nama barang yang panjang", "Rp1.000", 16), ["Nama barang yang", "panjang  Rp1.000"]);
ok("ASCII, wrap, dua kolom");

for (const paper of [58, 80] as const) {
  const cols = columnsFor(paper);
  const lines = layoutReceipt(doc, cols);
  for (const l of toPlainLines(lines, cols)) {
    const width = l.large ? cols / 2 : cols;
    assert.ok(l.text.length <= width, `baris "${l.text}" (${l.text.length}) > ${width} kolom`);
    assert.match(l.text, /^[\x20-\x7e]*$/, "hanya ASCII");
  }
  ok(`tata letak ${paper} mm: semua baris ≤ ${cols} kolom & ASCII`);

  const bytes = escPosReceipt(lines, cols, { cut: true, openDrawer: true, copies: 2 });
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40], "diawali ESC @");
  const count = (seq: number[]) => {
    let n = 0;
    for (let i = 0; i <= bytes.length - seq.length; i++) if (seq.every((b, j) => bytes[i + j] === b)) n++;
    return n;
  };
  assert.equal(count([0x1b, 0x40]), 2, "2 salinan");
  assert.equal(count([0x1d, 0x56, 0x42, 0x00]), 2, "potong tiap salinan");
  assert.equal(count([0x1b, 0x70, 0x00, 0x19, 0xfa]), 1, "laci dibuka sekali");
  assert.ok([...escPosReceipt(lines, cols)].every((b) => b < 0x80), "teks & perintah dasar tanpa byte non-ASCII");
  ok(`ESC/POS ${paper} mm: init, 2 salinan, cut, laci`);

  const pdf = new TextDecoder().decode(receiptPdf(lines, { paperMm: paper, columns: cols, title: "INV/BDG/261021/0001" }));
  assert.ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
  const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.ok(pdf.slice(xrefAt).startsWith("xref"), "startxref menunjuk tabel xref");
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 7);
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `offset objek ${i + 1}`));
  const length = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)![1]);
  const streamStart = pdf.indexOf("stream\n") + 7;
  assert.equal(pdf.indexOf("\nendstream"), streamStart + length, "/Length tepat");
  const mediaWidth = Number(/\/MediaBox \[0 0 ([\d.]+)/.exec(pdf)![1]);
  assert.ok(Math.abs(mediaWidth - (paper * 72) / 25.4) < 0.1, "lebar halaman = lebar kertas");
  ok(`PDF ${paper} mm: struktur, xref, panjang stream, ukuran halaman`);
}

console.log(`\nStruk: ${passed} pemeriksaan lulus.`);
