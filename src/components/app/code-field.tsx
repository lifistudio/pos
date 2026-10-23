"use client";

import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/base/input/input";
import { useDebounced } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";

type Owner = { variantId: string; productName: string; variantTitle: string; usedAs: "SKU" | "BARCODE" };

/**
 * Input SKU/barcode dengan cek keunikan langsung ke server (debounce) + duplikat di form yang sama.
 * Server tetap memvalidasi ulang saat menyimpan; ini hanya umpan balik cepat.
 */
export function CodeField({
  kind,
  value,
  onChange,
  excludeVariantId,
  duplicateInForm,
  placeholder,
  name,
  isRequired,
  className,
}: {
  kind: "SKU" | "BARCODE";
  value: string;
  onChange: (value: string) => void;
  excludeVariantId?: string;
  /** Diisi pemanggil bila kode ini sama dengan kode lain di form yang sama. */
  duplicateInForm?: boolean;
  placeholder?: string;
  name?: string;
  isRequired?: boolean;
  className?: string;
}) {
  const code = useDebounced(value.trim(), 350);
  const check = useQuery({
    queryKey: ["code-check", code.toUpperCase(), excludeVariantId],
    queryFn: () => api<{ data: Owner | null }>("/variants/code-check", { query: { code, excludeVariantId } }).then((r) => r.data),
    enabled: code.length >= 2,
    staleTime: 10_000,
  });
  const owner = code === value.trim() ? check.data : null;
  const label = kind === "SKU" ? "SKU" : "Barcode";
  const problem = duplicateInForm
    ? `${label} ini dipakai varian lain di form ini.`
    : owner
      ? `Sudah dipakai ${owner.usedAs === "SKU" ? "sebagai SKU" : "sebagai barcode"} ${owner.variantTitle === "Default" ? owner.productName : `${owner.productName} (${owner.variantTitle})`}.`
      : null;

  return (
    <Input
      size="small"
      name={name}
      label={label}
      placeholder={placeholder ?? "Kosongkan = otomatis"}
      value={value}
      onChange={(v) => onChange(kind === "SKU" ? v.toUpperCase().replace(/\s+/g, "-") : v.replace(/\s+/g, ""))}
      isRequired={isRequired}
      isInvalid={!!problem}
      hint={problem ?? undefined}
      inputClassName="font-mono"
      className={className}
    />
  );
}
