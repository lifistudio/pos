import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { OpnameList } from "./opname-list";

export const metadata: Metadata = { title: "Stok opname" };

export default function OpnamesPage() {
  return (
    <Suspense>
      <Guard permission="stock_opname:read">
        <OpnameList />
      </Guard>
    </Suspense>
  );
}
