import type { Metadata } from "next";
import { Suspense } from "react";
import { Guard } from "@/components/app/guard";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Laporan" };

export default function ReportsPage() {
  return (
    <Suspense>
      <Guard permission="report:read">
        <ReportsView />
      </Guard>
    </Suspense>
  );
}
