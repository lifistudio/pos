import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductList } from "./product-list";

export const metadata: Metadata = { title: "Produk" };

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductList />
    </Suspense>
  );
}
