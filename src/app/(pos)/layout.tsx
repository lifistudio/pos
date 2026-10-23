import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SessionProvider, type Me } from "@/components/app/session-context";
import { ApiClientError } from "@/lib/api-client";
import { apiServer } from "@/server/api/server-client";

/** Layar kasir: fullscreen tanpa sidebar back-office, tetap memakai sesi & permission yang sama. */
async function PosSession({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    ({ data: me } = await apiServer<{ data: Me }>("/me"));
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) redirect("/login?next=/pos");
    throw error;
  }
  return <SessionProvider me={me}>{children}</SessionProvider>;
}

export default function PosLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-body-medium text-text-tertiary">Menyiapkan kasir…</div>}>
      <PosSession>{children}</PosSession>
    </Suspense>
  );
}
