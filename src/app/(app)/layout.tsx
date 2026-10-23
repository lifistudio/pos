import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import type { Me } from "@/components/app/session-context";
import { ApiClientError } from "@/lib/api-client";
import { apiServer } from "@/server/api/server-client";

async function Shell({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    ({ data: me } = await apiServer<{ data: Me }>("/me"));
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) redirect("/login");
    throw error;
  }
  return <AppShell me={me}>{children}</AppShell>;
}

function ShellFallback() {
  return (
    <div className="flex min-h-dvh lg:gap-4 lg:p-4" aria-busy="true">
      <div className="hidden h-[calc(100dvh-2rem)] w-[260px] animate-pulse rounded-3xl bg-background-secondary-default lg:block" />
      <div className="flex-1 p-6">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-background-secondary-default" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
