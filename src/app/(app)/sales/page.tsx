import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { SalesView } from "./sales-view";

export const metadata: Metadata = { title: "Transaksi" };

export default function SalesPage() {
  return (
    <Suspense>
      <Guard permission="sale:read">
        <SalesView />
      </Guard>
    </Suspense>
  );
}
