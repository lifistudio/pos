import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { PosScreen } from "./pos-screen";

export const metadata: Metadata = { title: "Kasir" };

export default function PosPage() {
  return (
    <Guard permission="pos:access">
      <PosScreen />
    </Guard>
  );
}
