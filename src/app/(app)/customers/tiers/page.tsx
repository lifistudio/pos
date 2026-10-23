import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { TiersView } from "./tiers-view";

export const metadata: Metadata = { title: "Tier member" };

export default function TiersPage() {
  return (
    <Guard permission="customer:read">
      <TiersView />
    </Guard>
  );
}
