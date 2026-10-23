import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { numberSequences } from "@/server/db/schema";

/** {PREFIX}/{KODE}/{YYMMDD}/{0001} — naik atomik per kode cabang per hari (zona waktu cabang). */
export async function nextDocNumber(tx: Tx, prefix: string, branch: { code: string; timezone: string }) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: branch.timezone, year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const ymd = ["year", "month", "day"].map((t) => parts.find((p) => p.type === t)!.value).join("");
  const key = `${prefix}/${branch.code}/${ymd}`;
  const [row] = await tx
    .insert(numberSequences)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: numberSequences.key, set: { value: sql`${numberSequences.value} + 1` } })
    .returning({ value: numberSequences.value });
  return `${key}/${String(row.value).padStart(4, "0")}`;
}
