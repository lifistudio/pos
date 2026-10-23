import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { TransferDetail } from "./transfer-detail";

export const metadata: Metadata = { title: "Detail transfer" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferDetail id={id} />;
}

export default function TransferPage({ params }: PageProps<"/inventory/transfers/[id]">) {
  return (
    <Guard permission="stock_transfer:read">
      <Suspense>
        <Content params={params} />
      </Suspense>
    </Guard>
  );
}
