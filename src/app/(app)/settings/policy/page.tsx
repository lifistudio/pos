import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { PolicyView } from "./policy-view";

export const metadata: Metadata = { title: "Poin & retur" };

export default function PolicyPage() {
  return (
    <Guard permission="setting:read">
      <PolicyView />
    </Guard>
  );
}
