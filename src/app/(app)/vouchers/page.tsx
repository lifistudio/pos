import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { VouchersView } from "./vouchers-view";

export const metadata: Metadata = { title: "Voucher" };

export default function VouchersPage() {
  return (
    <Suspense>
      <Guard permission="voucher:read">
        <VouchersView />
      </Guard>
    </Suspense>
  );
}
