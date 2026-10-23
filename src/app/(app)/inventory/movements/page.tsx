import type { Metadata } from "next";
import { MovementList } from "./movement-list";

export const metadata: Metadata = { title: "Kartu stok" };

export default function MovementsPage() {
  return <MovementList />;
}
