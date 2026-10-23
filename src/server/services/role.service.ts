import "server-only";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { rolePermissions, roles, userRoleAssignments } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, notFound } from "@/server/api/errors";
import { effectivePermissions } from "@/server/rbac/access";
import { isPermission } from "@/server/rbac/permissions";
import { writeAudit } from "./audit.service";

/** 3 query tetap, berapa pun jumlah role (bukan 1 + N). */
export async function listRoles() {
  const [roleRows, permRows, countRows] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.createdAt)),
    db.select().from(rolePermissions),
    db
      .select({ roleId: userRoleAssignments.roleId, users: count() })
      .from(userRoleAssignments)
      .groupBy(userRoleAssignments.roleId),
  ]);
  const perms = new Map<string, string[]>();
  for (const p of permRows) perms.set(p.roleId, [...(perms.get(p.roleId) ?? []), p.permission]);
  const counts = new Map(countRows.map((r) => [r.roleId, r.users]));
  return roleRows.map((r) => ({ ...r, permissions: (perms.get(r.id) ?? []).sort(), userCount: counts.get(r.id) ?? 0 }));
}

/** Mencegah eskalasi: actor hanya boleh memberi permission yang ia miliki sendiri. */
function assertGrantable(actor: Actor, permissions: string[]) {
  const invalid = permissions.filter((p) => !isPermission(p));
  if (invalid.length) throw badRequest("INVALID_PERMISSION", "Ada permission yang tidak dikenal.", { invalid });
  const own = new Set(effectivePermissions(actor.access));
  const notOwned = permissions.filter((p) => !own.has(p));
  if (notOwned.length) {
    throw new ApiError(403, "PERMISSION_ESCALATION", "Anda tidak bisa memberi akses yang tidak Anda miliki.", {
      permissions: notOwned,
    });
  }
}

export async function createRole(actor: Actor, input: { name: string; description?: string | null; permissions: string[] }) {
  assertGrantable(actor, input.permissions);
  const role = await db.transaction(async (tx) => {
    const [row] = await tx.insert(roles).values({ name: input.name, description: input.description }).returning();
    if (input.permissions.length) {
      await tx.insert(rolePermissions).values(input.permissions.map((permission) => ({ roleId: row.id, permission })));
    }
    await writeAudit(actor, { action: "create", entity: "role", entityId: row.id, after: input }, tx);
    return row;
  });
  return { ...role, permissions: input.permissions, userCount: 0 };
}

export async function updateRole(
  actor: Actor,
  id: string,
  input: { name?: string; description?: string | null; permissions?: string[] },
) {
  const [existing] = await db.select().from(roles).where(eq(roles.id, id));
  if (!existing) throw notFound("Role");
  if (existing.isSystem) throw conflict("SYSTEM_ROLE_LOCKED", "Role Owner terkunci dan tidak bisa diubah.");
  if (input.permissions) assertGrantable(actor, input.permissions);

  await db.transaction(async (tx) => {
    const before = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (input.name !== undefined || input.description !== undefined) {
      await tx.update(roles).set({ name: input.name, description: input.description }).where(eq(roles.id, id));
    }
    if (input.permissions) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (input.permissions.length) {
        await tx.insert(rolePermissions).values(input.permissions.map((permission) => ({ roleId: id, permission })));
      }
    }
    await writeAudit(
      actor,
      {
        action: "update",
        entity: "role",
        entityId: id,
        before: { name: existing.name, permissions: before.map((p) => p.permission) },
        after: input,
      },
      tx,
    );
  });
  return (await listRoles()).find((r) => r.id === id)!;
}

export async function deleteRole(actor: Actor, id: string) {
  const [existing] = await db.select().from(roles).where(eq(roles.id, id));
  if (!existing) throw notFound("Role");
  if (existing.isSystem) throw conflict("SYSTEM_ROLE_LOCKED", "Role Owner tidak bisa dihapus.");
  const [{ value }] = await db.select({ value: count() }).from(userRoleAssignments).where(eq(userRoleAssignments.roleId, id));
  if (value > 0) throw conflict("ROLE_IN_USE", `Role masih dipakai ${value} pengguna. Pindahkan mereka ke role lain dulu.`);
  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, id));
    await writeAudit(actor, { action: "delete", entity: "role", entityId: id, before: existing }, tx);
  });
}
