import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { ApiKeysView } from "./api-keys-view";

export const metadata: Metadata = { title: "API key & MCP" };

export default function ApiKeysPage() {
  return (
    <Guard permission="api_key:read">
      <ApiKeysView />
    </Guard>
  );
}
