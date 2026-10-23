"use client";

import { SubNav } from "@/components/app/sub-nav";

export function InventoryNav() {
  return (
    <SubNav
      label="Sub-menu stok"
      tabs={[
        { href: "/inventory", label: "Stok per cabang", exact: true },
        { href: "/inventory/transfers", label: "Transfer", permission: "stock_transfer:read" },
        { href: "/inventory/opnames", label: "Stok opname", permission: "stock_opname:read" },
        { href: "/inventory/movements", label: "Kartu stok" },
      ]}
    />
  );
}
