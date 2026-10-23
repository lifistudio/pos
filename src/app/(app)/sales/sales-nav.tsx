"use client";

import { SubNav } from "@/components/app/sub-nav";

export function SalesNav() {
  return (
    <SubNav
      label="Sub-menu transaksi"
      tabs={[
        { href: "/sales", label: "Penjualan", exact: true },
        { href: "/sales/returns", label: "Retur" },
      ]}
    />
  );
}
