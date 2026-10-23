import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { AdjustStockForm } from "./adjust-form";

export const metadata: Metadata = { title: "Terima / sesuaikan stok" };

export default function AdjustStockPage() {
  return (
    <Guard permission="inventory:adjust">
      <AdjustStockForm />
    </Guard>
  );
}
