import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryList } from "./inventory-list";

export const metadata: Metadata = { title: "Stok" };

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryList />
    </Suspense>
  );
}
