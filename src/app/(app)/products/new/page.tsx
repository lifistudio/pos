import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Tambah produk" };

export default function NewProductPage() {
  return (
    <Guard permission="product:create">
      <ProductForm />
    </Guard>
  );
}
