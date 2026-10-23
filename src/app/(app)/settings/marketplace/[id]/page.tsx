import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { ConnectionDetail } from "./connection-detail";

export const metadata: Metadata = { title: "Marketplace" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConnectionDetail id={id} />;
}

export default function ConnectionPage({ params }: PageProps<"/settings/marketplace/[id]">) {
  return (
    <Guard permission="marketplace:read">
      <Suspense>
        <Content params={params} />
      </Suspense>
    </Guard>
  );
}
