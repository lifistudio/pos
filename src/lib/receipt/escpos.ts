import { toAscii, type ReceiptLine } from "./layout";

/**
 * Perintah ESC/POS standar (Epson) — didukung hampir semua printer struk thermal: Epson, Xprinter, Zjiang, Rongta,
 * HPRT, Panda, Bixolon, Sunmi, dan printer Bluetooth 58 mm. Hanya perintah dasar agar kompatibel luas.
 */
const ESC = 0x1b;
const GS = 0x1d;

export type EscPosOptions = {
  /** Potong kertas setelah struk (printer dengan auto-cutter; diabaikan printer tanpa cutter). */
  cut?: boolean;
  /** Buka laci kas yang tersambung ke printer (kick-out pin 2). */
  openDrawer?: boolean;
  copies?: number;
};

/** Baris struk (hasil layoutReceipt dengan `columns` sesuai kertas) → byte ESC/POS siap kirim ke printer. */
export function escPosReceipt(lines: ReceiptLine[], columns: number, options: EscPosOptions = {}) {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const text = (s: string) => {
    for (const ch of toAscii(s)) push(ch.charCodeAt(0));
    push(0x0a);
  };

  const once = () => {
    push(ESC, 0x40); // inisialisasi printer
    push(ESC, 0x74, 0x00); // code page PC437 (ASCII aman)
    for (const l of lines) {
      if (l.kind === "feed") {
        push(ESC, 0x64, Math.min(255, l.lines));
      } else if (l.kind === "rule") {
        push(ESC, 0x61, 0x00, ESC, 0x45, 0x00, GS, 0x21, 0x00);
        text("-".repeat(columns));
      } else {
        push(ESC, 0x61, l.align === "center" ? 1 : l.align === "right" ? 2 : 0); // perataan
        push(ESC, 0x45, l.bold ? 1 : 0); // tebal
        push(GS, 0x21, l.large ? 0x11 : 0x00); // 2× lebar & tinggi
        text(l.text);
      }
    }
    push(GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00); // kembalikan gaya normal
  };

  const copies = Math.min(5, Math.max(1, options.copies ?? 1));
  for (let i = 0; i < copies; i++) {
    once();
    if (options.cut) push(GS, 0x56, 0x42, 0x00); // feed lalu potong sebagian
  }
  if (options.openDrawer) push(ESC, 0x70, 0x00, 0x19, 0xfa); // pulsa laci: 50 ms nyala, 500 ms jeda
  return new Uint8Array(bytes);
}
