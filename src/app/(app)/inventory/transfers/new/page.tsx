import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Buat transfer" };

export default function NewTransferPage() {
  return (
    <Guard permission="stock_transfer:create">
      <TransferForm />
    </Guard>
  );
}
