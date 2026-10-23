import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { TransferList } from "./transfer-list";

export const metadata: Metadata = { title: "Transfer stok" };

export default function TransfersPage() {
  return (
    <Suspense>
      <Guard permission="stock_transfer:read">
        <TransferList />
      </Guard>
    </Suspense>
  );
}
