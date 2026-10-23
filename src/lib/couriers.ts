import { displayName, nameKey } from "./names";

/** Kurir umum di Indonesia. Ejaan lain ("jnt", "J & T", "sicepat ekspres") dipetakan ke nama resmi agar laporan konsisten. */
export const COURIERS: { name: string; aliases?: string[] }[] = [
  { name: "JNE", aliases: ["jne express"] },
  { name: "J&T Express", aliases: ["jnt", "j&t", "jt express", "jnt express"] },
  { name: "SiCepat", aliases: ["sicepat ekspres", "sicepat express", "si cepat"] },
  { name: "AnterAja", aliases: ["anter aja"] },
  { name: "Ninja Xpress", aliases: ["ninja", "ninja express"] },
  { name: "Pos Indonesia", aliases: ["pos", "kantor pos"] },
  { name: "TIKI" },
  { name: "Lion Parcel" },
  { name: "ID Express", aliases: ["idexpress", "ide"] },
  { name: "SPX Express", aliases: ["shopee express", "spx", "shopee xpress"] },
  { name: "J&T Cargo" },
  { name: "Wahana" },
  { name: "GoSend", aliases: ["gojek", "go send", "gosend instant", "gosend sameday"] },
  { name: "GrabExpress", aliases: ["grab", "grab express", "grabexpress instant"] },
  { name: "Lalamove" },
  { name: "Paxel" },
  { name: "Kurir toko", aliases: ["kurir sendiri", "diantar toko", "antar sendiri"] },
  { name: "Ambil di toko", aliases: ["pickup", "pick up", "ambil sendiri"] },
];

const byKey = new Map<string, string>();
for (const c of COURIERS) for (const n of [c.name, ...(c.aliases ?? [])]) byKey.set(nameKey(n), c.name);

/**
 * Rapikan nama kurir: bagian depan yang dikenali diganti nama resmi, sisanya (layanan) dipertahankan —
 * "jne reg" → "JNE REG", "jnt  ez" → "J&T Express EZ", "Kurir Pak Budi" tetap apa adanya (dirapikan spasinya).
 */
export function canonicalCourier(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const words = displayName(value).split(" ");
  for (let n = Math.min(words.length, 4); n >= 1; n--) {
    const known = byKey.get(nameKey(words.slice(0, n).join(" ")));
    if (known) {
      const service = words.slice(n).join(" ").toUpperCase();
      return service ? `${known} ${service}` : known;
    }
  }
  return words.join(" ");
}
