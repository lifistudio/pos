import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { CustomersView } from "./customers-view";

export const metadata: Metadata = { title: "Customer" };

export default function CustomersPage() {
  return (
    <Suspense>
      <Guard permission="customer:read">
        <CustomersView />
      </Guard>
    </Suspense>
  );
}
