/**
 * Encoder barcode murni (tanpa dependensi) untuk cetak label: EAN-13 / UPC-A / EAN-8 untuk kode angka
 * dengan digit cek valid, Code 128 (set B) untuk kode lain (SKU huruf-angka). Keluaran = deretan modul
 * "1" (batang) / "0" (spasi) yang digambar sebagai SVG.
 */

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function eanCheckDigit(body: string) {
  // Bobot 3 untuk digit paling kanan dari body, bergantian 1/3 ke kiri.
  const sum = [...body].reverse().reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

const validEan = (code: string, length: number) => new RegExp(`^\\d{${length}}$`).test(code) && eanCheckDigit(code.slice(0, -1)) === Number(code.at(-1));

function ean13Modules(code: string) {
  const first = Number(code[0]);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === "L" ? L : G)[Number(code[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
  return bits + "101";
}

function ean8Modules(code: string) {
  let bits = "101";
  for (let i = 0; i < 4; i++) bits += L[Number(code[i])];
  bits += "01010";
  for (let i = 4; i < 8; i++) bits += R[Number(code[i])];
  return bits + "101";
}

/** Lebar batang/spasi Code 128 untuk nilai 0–105; indeks 106 = stop (termasuk batang penutup). */
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

function widthsToBits(widths: string) {
  return [...widths].map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(Number(w))).join("");
}

function code128Modules(text: string) {
  const values = [...text].map((ch) => {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Karakter "${ch}" tidak bisa dibuat barcode Code 128.`);
    return v;
  });
  const checksum = values.reduce((acc, v, i) => acc + v * (i + 1), START_B) % 103;
  return [START_B, ...values, checksum, STOP].map((v) => widthsToBits(CODE128_PATTERNS[v])).join("");
}

export type Barcode = { format: "EAN-13" | "UPC-A" | "EAN-8" | "CODE128"; modules: string; text: string };

/** Pilih format terbaik untuk sebuah kode: EAN/UPC bila angka dengan digit cek valid, selain itu Code 128. */
export function encodeBarcode(code: string): Barcode {
  const value = code.trim();
  if (validEan(value, 13)) return { format: "EAN-13", modules: ean13Modules(value), text: value };
  if (validEan(value, 12)) return { format: "UPC-A", modules: ean13Modules(`0${value}`), text: value };
  if (validEan(value, 8)) return { format: "EAN-8", modules: ean8Modules(value), text: value };
  return { format: "CODE128", modules: code128Modules(value), text: value };
}
