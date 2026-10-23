import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { BranchesView } from "./branches-view";

export const metadata: Metadata = { title: "Cabang" };

export default function BranchesPage() {
  return (
    <Guard permission="branch:read">
      <BranchesView />
    </Guard>
  );
}
