import { toPlainLines, type ReceiptLine } from "./layout";

/**
 * PDF struk tanpa dependensi: satu halaman selebar kertas thermal (58/80 mm), tinggi mengikuti isi,
 * font Courier bawaan PDF (tidak perlu menyematkan font). Hasilnya bisa dibuka/dicetak di mana saja.
 */
const MM = 72 / 25.4;

function escapePdf(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function receiptPdf(lines: ReceiptLine[], opts: { paperMm: 58 | 80; columns: number; title?: string }) {
  const plain = toPlainLines(lines, opts.columns);
  const margin = 3 * MM;
  const pageWidth = opts.paperMm * MM;
  // Lebar huruf Courier = 0,6 × ukuran font → pilih ukuran agar `columns` karakter pas di area cetak.
  const fontSize = Math.round(((pageWidth - margin * 2) / (opts.columns * 0.6)) * 100) / 100;
  const leading = fontSize * 1.25;
  const height = margin * 2 + plain.reduce((h, l) => h + (l.large ? leading * 2 : leading), 0);

  let y = height - margin;
  const ops: string[] = [];
  for (const l of plain) {
    const size = l.large ? fontSize * 2 : fontSize;
    y -= l.large ? leading * 2 : leading;
    if (!l.text.trim()) continue;
    ops.push(`BT /${l.bold ? "F2" : "F1"} ${size.toFixed(2)} Tf ${margin.toFixed(2)} ${(y + leading * 0.25).toFixed(2)} Td (${escapePdf(l.text)}) Tj ET`);
  }
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Title (${escapePdf(opts.title ?? "Struk")}) /Producer (Konten POS) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Teks sudah ASCII (toAscii), jadi panjang string = panjang byte.
  return new TextEncoder().encode(out);
}
