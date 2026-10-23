import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { ReturnsView } from "./returns-view";

export const metadata: Metadata = { title: "Retur" };

export default function ReturnsPage() {
  return (
    <Suspense>
      <Guard permission="sale:read">
        <ReturnsView />
      </Guard>
    </Suspense>
  );
}
