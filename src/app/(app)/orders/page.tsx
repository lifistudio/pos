import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { OrdersView } from "./orders-view";

export const metadata: Metadata = { title: "Order online" };

export default function OrdersPage() {
  return (
    <Suspense>
      <Guard permission="online_order:read">
        <OrdersView />
      </Guard>
    </Suspense>
  );
}
