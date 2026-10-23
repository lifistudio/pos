"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/components/app/session-context";
import { SETTINGS_TABS } from "./settings-nav";

/** /settings → tab pertama yang boleh diakses. */
export default function SettingsIndex() {
  const { can } = useSession();
  const router = useRouter();
  const first = SETTINGS_TABS.find((t) => can(t.permission));
  useEffect(() => {
    router.replace(first?.href ?? "/dashboard");
  }, [first, router]);
  return null;
}
