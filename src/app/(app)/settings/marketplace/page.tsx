import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { MarketplaceView } from "./marketplace-view";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <Suspense>
      <Guard permission="marketplace:read">
        <MarketplaceView />
      </Guard>
    </Suspense>
  );
}
