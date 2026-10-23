import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { BrandsView } from "./brands-view";

export const metadata: Metadata = { title: "Merek" };

export default function BrandsPage() {
  return (
    <Guard permission="brand:read">
      <BrandsView />
    </Guard>
  );
}
