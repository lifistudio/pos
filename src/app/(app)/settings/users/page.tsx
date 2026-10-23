import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { Suspense } from "react";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Pengguna" };

export default function UsersPage() {
  return (
    <Suspense>
      <Guard permission="user:read">
        <UsersView />
      </Guard>
    </Suspense>
  );
}
