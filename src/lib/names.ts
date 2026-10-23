/**
 * Normalisasi nama master data (merek, kurir, nama variasi) — dipakai server untuk keunikan dan client untuk saran.
 * `displayName`: rapikan spasi. `nameKey`: kunci pembanding — huruf kecil, tanpa aksen, tanpa spasi & tanda baca,
 * sehingga "Coca-Cola", "coca cola", "COCA  COLA" dianggap sama.
 */
export const displayName = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

export const nameKey = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
