"use client";

import { SubNav } from "@/components/app/sub-nav";

export const SETTINGS_TABS = [
  { href: "/settings/branches", label: "Cabang", permission: "branch:read" },
  { href: "/settings/users", label: "Pengguna", permission: "user:read" },
  { href: "/settings/roles", label: "Role & akses", permission: "role:read" },
  { href: "/settings/policy", label: "Kebijakan toko", permission: "setting:read" },
  { href: "/settings/marketplace", label: "Marketplace", permission: "marketplace:read" },
  { href: "/settings/api-keys", label: "API key & MCP", permission: "api_key:read" },
  { href: "/settings/audit-log", label: "Audit log", permission: "audit_log:read" },
];

export function SettingsNav() {
  return <SubNav label="Menu pengaturan" tabs={SETTINGS_TABS} />;
}
