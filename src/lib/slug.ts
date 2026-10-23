/** "Kaos Basic Hitam" → "kaos-basic-hitam" */
export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Potongan SKU dari teks: "Hitam Pekat" → "HTP" (konsonan awal tiap kata, maks 4 karakter). */
export function skuPart(value: string, length = 4) {
  const words = slugify(value).split("-").filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("").slice(0, length).toUpperCase();
  const word = words[0] ?? "X";
  return (word[0] + word.slice(1).replace(/[aeiou]/g, "")).slice(0, length).toUpperCase();
}
