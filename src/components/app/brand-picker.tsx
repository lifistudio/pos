"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/app/session-context";
import { api, ApiClientError } from "@/lib/api-client";
import { SearchSelect, type SearchOption } from "./search-select";

type BrandRow = { id: string; name: string; productCount: number; exact?: boolean };

/**
 * Pilih merek dari master (cari, ejaan mirip ikut tampil). Pemegang `brand:create` bisa menambah merek baru;
 * bila nama ternyata sudah ada (beda kapital/spasi/tanda baca), merek yang ada langsung dipakai.
 */
export function BrandPicker({ value, onChange, className }: { value: SearchOption | null; onChange: (v: SearchOption | null) => void; className?: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  return (
    <SearchSelect
      label="Merek"
      placeholder="Cari merek"
      queryKey={["brands", "picker"]}
      value={value}
      onChange={onChange}
      className={className}
      createLabel="Tambah merek"
      search={async (q) => {
        const r = await api<{ data: BrandRow[] }>("/brands", { query: { q: q || undefined, pageSize: 20 } });
        return r.data.map((b) => ({ id: b.id, name: b.name, exact: b.exact, hint: `${b.productCount} produk` }));
      }}
      onCreate={
        can("brand:create")
          ? async (name) => {
              try {
                const r = await api<{ data: BrandRow }>("/brands", { method: "POST", body: { name } });
                qc.invalidateQueries({ queryKey: ["brands"] });
                return { id: r.data.id, name: r.data.name };
              } catch (e) {
                // Sudah ada dengan ejaan lain → pakai yang ada, jangan buat ganda.
                const existing = e instanceof ApiClientError && e.code === "BRAND_EXISTS" ? (e.details as { brandId: string; name: string }) : null;
                if (existing) return { id: existing.brandId, name: existing.name };
                throw e;
              }
            }
          : undefined
      }
    />
  );
}
