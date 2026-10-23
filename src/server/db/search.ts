import "server-only";
import { and, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Escape karakter wildcard LIKE agar input user dicari apa adanya. */
const escapeLike = (term: string) => term.replace(/[\\%_]/g, (m) => "\\" + m);

/**
 * Pencarian per kata: "hoodie hitam l" → setiap kata harus cocok di salah satu kolom.
 * Memakai index trigram (pg_trgm) pada nama produk & SKU.
 */
export function matchAllTerms(query: string, columns: AnyColumn[]): SQL | undefined {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 6).map(escapeLike);
  if (terms.length === 0) return undefined;
  return and(...terms.map((t) => or(...columns.map((c) => ilike(c, `%${t}%`)))));
}

/** Filter kategori termasuk sub-kategorinya (pohon maks 3 tingkat → cukup 2 level turunan, satu subquery). */
export function inCategoryTree(column: AnyColumn, categoryId: string): SQL {
  return sql`${column} in (
    select c1.id from categories c1 where c1.id = ${categoryId}
    union select c2.id from categories c2 where c2.parent_id = ${categoryId}
    union select c3.id from categories c3 join categories c2 on c3.parent_id = c2.id where c2.parent_id = ${categoryId}
  )`;
}
