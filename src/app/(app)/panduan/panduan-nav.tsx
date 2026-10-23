"use client";

import { SubNav, type SubNavTab } from "@/components/app/sub-nav";

/** Tab panduan bergaya sama dengan Pengaturan & Stok (SubNav BoardUI). */
export function PanduanNav({ tabs }: { tabs: SubNavTab[] }) {
  return <SubNav label="Daftar panduan" tabs={[{ href: "/panduan", label: "Semua", exact: true }, ...tabs]} />;
}
