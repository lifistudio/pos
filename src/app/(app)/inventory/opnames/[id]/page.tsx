import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { OpnameDetail } from "./opname-detail";

export const metadata: Metadata = { title: "Stok opname" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpnameDetail id={id} />;
}

export default function OpnamePage({ params }: PageProps<"/inventory/opnames/[id]">) {
  return (
    <Guard permission="stock_opname:read">
      <Suspense>
        <Content params={params} />
      </Suspense>
    </Guard>
  );
}
