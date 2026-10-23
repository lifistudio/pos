import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { RolesView } from "./roles-view";

export const metadata: Metadata = { title: "Role & akses" };

export default function RolesPage() {
  return (
    <Guard permission="role:read">
      <RolesView />
    </Guard>
  );
}
