import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Buat order" };

export default function NewOrderPage() {
  return (
    <Guard permission="online_order:create">
      <OrderForm />
    </Guard>
  );
}
