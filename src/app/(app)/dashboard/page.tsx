import type { Metadata } from "next";
import { HomeGuard } from "@/components/app/guard";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <HomeGuard>
      <DashboardView />
    </HomeGuard>
  );
}
