import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { OrderDetail } from "./order-detail";

export const metadata: Metadata = { title: "Detail order" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Guard permission="online_order:read">
      <Suspense>
        <Content params={params} />
      </Suspense>
    </Guard>
  );
}
