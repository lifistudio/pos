"use client";

import { SubNav } from "@/components/app/sub-nav";

export function CustomersNav() {
  return (
    <SubNav
      label="Sub-menu customer"
      tabs={[
        { href: "/customers", label: "Customer", exact: true },
        { href: "/customers/tiers", label: "Tier member" },
      ]}
    />
  );
}
