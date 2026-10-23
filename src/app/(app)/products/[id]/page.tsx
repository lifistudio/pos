import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/app/page-header";
import { ApiClientError } from "@/lib/api-client";
import { apiServer } from "@/server/api/server-client";
import { ProductDetailView, type ProductDetail } from "./product-detail";

export const metadata: Metadata = { title: "Detail produk" };

/** SSR: data awal produk diambil di server lewat API in-process (lihat ARCHITECTURE §6). */
async function ProductContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await apiServer<{ data: ProductDetail }>(`/products/${id}`).then(
    (r) => r.data,
    (error) => {
      if (error instanceof ApiClientError && error.status === 404) notFound();
      throw error;
    },
  );
  return <ProductDetailView initial={data} />;
}

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      }
    >
      <ProductContent params={params} />
    </Suspense>
  );
}
