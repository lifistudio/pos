import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, type BranchSettings } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { forbidden, notFound } from "@/server/api/errors";
import { branchScope, can } from "@/server/rbac/access";
import { writeAudit } from "./audit.service";

export type BranchInput = {
  code: string;
  name: string;
  type: "STORE" | "WAREHOUSE" | "ONLINE";
  address?: string | null;
  phone?: string | null;
  timezone?: string;
  settings?: BranchSettings;
  isActive?: boolean;
};

/** Cabang yang boleh dilihat actor (global → semua; selain itu hanya cabang yang di-assign). */
export async function listBranches(actor: Actor) {
  const scope = branchScope(actor.access, "branch:read");
  if (scope === "ALL") return db.select().from(branches).orderBy(asc(branches.name));
  // Tanpa branch:read global, user tetap melihat cabang tempat ia ditugaskan (untuk pemilih cabang).
  const ids = [...new Set([...scope, ...actor.access.byBranch.keys()])];
  if (ids.length === 0) return [];
  return db.select().from(branches).where(inArray(branches.id, ids)).orderBy(asc(branches.name));
}

export async function createBranch(actor: Actor, input: BranchInput) {
  const [row] = await db
    .insert(branches)
    .values({ ...input, code: input.code.toUpperCase() })
    .returning();
  await writeAudit(actor, { action: "create", entity: "branch", entityId: row.id, after: row });
  return row;
}

export async function updateBranch(actor: Actor, id: string, input: Partial<BranchInput>) {
  if (!can(actor.access, "branch:update", id)) throw forbidden("branch:update");
  const [before] = await db.select().from(branches).where(eq(branches.id, id));
  if (!before) throw notFound("Cabang");
  const [row] = await db
    .update(branches)
    .set({ ...input, code: input.code?.toUpperCase() })
    .where(eq(branches.id, id))
    .returning();
  await writeAudit(actor, { action: "update", entity: "branch", entityId: id, before, after: row });
  return row;
}
