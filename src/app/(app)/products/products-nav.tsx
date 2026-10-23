"use client";

import { SubNav } from "@/components/app/sub-nav";

export function ProductsNav() {
  return (
    <SubNav
      label="Sub-menu produk"
      tabs={[
        { href: "/products", label: "Semua produk", exact: true },
        { href: "/products/categories", label: "Kategori", permission: "category:read" },
        { href: "/products/brands", label: "Merek", permission: "brand:read" },
      ]}
    />
  );
}
