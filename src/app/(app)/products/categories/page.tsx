import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { CategoriesView } from "./categories-view";

export const metadata: Metadata = { title: "Kategori" };

export default function CategoriesPage() {
  return (
    <Guard permission="category:read">
      <CategoriesView />
    </Guard>
  );
}
