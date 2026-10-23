/**
 * Struk sebagai data → baris teks lebar tetap. Satu sumber untuk printer thermal (ESC/POS), PDF, dan pratinjau,
 * sehingga isi struk sama persis di semua cara cetak. Tanpa dependensi; aman di client & server.
 */

export type ReceiptDoc = {
  storeName: string;
  headerLines: string[];
  /** Penanda besar di atas, mis. "DIBATALKAN" atau "STRUK SEMENTARA (OFFLINE)". */
  banner?: string | null;
  meta: [string, string][];
  items: { name: string; qtyLine: string; amount: string }[];
  summary: { label: string; value: string; bold?: boolean }[];
  payments: [string, string][];
  extra: [string, string][];
  footerLines: string[];
};

export type ReceiptLine =
  | { kind: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; large?: boolean }
  | { kind: "rule" }
  | { kind: "feed"; lines: number };

/** Karakter per baris untuk font A standar (12×24): 58 mm → 32, 80 mm → 48. */
export const columnsFor = (paperMm: 58 | 80) => (paperMm === 58 ? 32 : 48);

/** Printer thermal hanya pasti mendukung ASCII: hilangkan aksen & ganti simbol tipografis. */
export function toAscii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[×✕]/g, "x")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

/** Pecah teks panjang menjadi beberapa baris selebar `width` (per kata, kata kepanjangan dipotong). */
export function wrap(text: string, width: number) {
  const out: string[] = [];
  for (const para of toAscii(text).split("\n")) {
    const start = out.length;
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (line) out.push(line);
        line = "";
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    // Paragraf kosong tetap satu baris kosong; sisa kosong setelah kata panjang tidak ditambahkan.
    if (line || out.length === start) out.push(line);
  }
  return out;
}

/** "Kiri ........ Kanan" dalam satu baris; bila tidak muat, kiri di-wrap dan kanan di baris terakhir. */
export function twoCol(left: string, right: string, width: number) {
  const l = toAscii(left);
  const r = toAscii(right);
  if (l.length + 1 + r.length <= width) return [l + " ".repeat(width - l.length - r.length) + r];
  const lines = wrap(l, width);
  const last = lines[lines.length - 1];
  if (last.length + 1 + r.length <= width) lines[lines.length - 1] = last + " ".repeat(width - last.length - r.length) + r;
  else lines.push(" ".repeat(Math.max(0, width - r.length)) + r);
  return lines;
}

export function layoutReceipt(doc: ReceiptDoc, columns: number): ReceiptLine[] {
  const L: ReceiptLine[] = [];
  const text = (t: string, o: Omit<Extract<ReceiptLine, { kind: "text" }>, "kind" | "text"> = {}) => L.push({ kind: "text", text: t, ...o });
  const rule = () => L.push({ kind: "rule" });
  const pairs = (rows: [string, string][], bold = false) => rows.forEach(([a, b]) => twoCol(a, b, columns).forEach((t) => text(t, { bold })));

  if (doc.banner) {
    for (const t of wrap(doc.banner, columns)) text(t, { align: "center", bold: true });
    rule();
  }
  for (const t of wrap(doc.storeName, Math.floor(columns / 2))) text(t, { align: "center", bold: true, large: true });
  for (const h of doc.headerLines) for (const t of wrap(h, columns)) text(t, { align: "center" });
  rule();
  pairs(doc.meta);
  rule();
  for (const i of doc.items) {
    for (const t of wrap(i.name, columns)) text(t);
    twoCol(`  ${i.qtyLine}`, i.amount, columns).forEach((t) => text(t));
  }
  rule();
  for (const s of doc.summary) {
    if (s.bold) twoCol(s.label, s.value, Math.floor(columns / 2)).forEach((t) => text(t, { bold: true, large: true }));
    else twoCol(s.label, s.value, columns).forEach((t) => text(t));
  }
  if (doc.payments.length) {
    rule();
    pairs(doc.payments);
  }
  if (doc.extra.length) {
    rule();
    pairs(doc.extra);
  }
  rule();
  for (const f of doc.footerLines) for (const t of wrap(f, columns)) text(t, { align: "center" });
  L.push({ kind: "feed", lines: 3 });
  return L;
}

/** Baris final sebagai teks polos (pratinjau, PDF): rata tengah/kanan diterapkan dengan spasi. */
export function toPlainLines(lines: ReceiptLine[], columns: number) {
  const out: { text: string; bold: boolean; large: boolean }[] = [];
  for (const l of lines) {
    if (l.kind === "rule") out.push({ text: "-".repeat(columns), bold: false, large: false });
    else if (l.kind === "feed") for (let i = 0; i < l.lines; i++) out.push({ text: "", bold: false, large: false });
    else {
      const width = l.large ? Math.floor(columns / 2) : columns;
      const pad = l.align === "center" ? Math.max(0, Math.floor((width - l.text.length) / 2)) : l.align === "right" ? Math.max(0, width - l.text.length) : 0;
      out.push({ text: " ".repeat(pad) + l.text, bold: !!l.bold, large: !!l.large });
    }
  }
  return out;
}
