import type { Metadata } from "next";
import { Guard } from "@/components/app/guard";
import { AuditLogView } from "./audit-log-view";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditLogPage() {
  return (
    <Guard permission="audit_log:read">
      <AuditLogView />
    </Guard>
  );
}
