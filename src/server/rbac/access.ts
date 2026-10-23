import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { rolePermissions, roles, userRoleAssignments } from "@/server/db/schema";
import type { Permission } from "./permissions";

/**
 * Hak akses efektif seorang user.
 * - `global`: permission dari role yang berlaku di semua cabang.
 * - `byBranch`: permission dari role yang di-assign ke cabang tertentu.
 */
export type Access = {
  global: Set<string>;
  byBranch: Map<string, Set<string>>;
  roleNames: string[];
};

/** Satu query (join) — tidak N+1 terhadap jumlah role. */
export async function loadAccess(userId: string): Promise<Access> {
  const rows = await db
    .select({
      branchId: userRoleAssignments.branchId,
      roleName: roles.name,
      permission: rolePermissions.permission,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoleAssignments.userId, userId));

  const access: Access = { global: new Set(), byBranch: new Map(), roleNames: [] };
  const names = new Set<string>();
  for (const row of rows) {
    names.add(row.roleName);
    if (!row.permission) continue;
    if (row.branchId === null) {
      access.global.add(row.permission);
    } else {
      const set = access.byBranch.get(row.branchId) ?? new Set<string>();
      set.add(row.permission);
      access.byBranch.set(row.branchId, set);
    }
  }
  access.roleNames = [...names];
  return access;
}

/**
 * Tanpa `branchId`: true bila user punya permission di setidaknya satu cakupan.
 * Dengan `branchId`: true bila permission berlaku global atau di cabang tersebut.
 */
export function can(access: Access, permission: Permission, branchId?: string | null): boolean {
  if (access.global.has(permission)) return true;
  if (branchId) return access.byBranch.get(branchId)?.has(permission) ?? false;
  for (const set of access.byBranch.values()) if (set.has(permission)) return true;
  return false;
}

/** Cabang yang boleh diakses untuk sebuah permission: "ALL" atau daftar id cabang. */
export function branchScope(access: Access, permission: Permission): "ALL" | string[] {
  if (access.global.has(permission)) return "ALL";
  const ids: string[] = [];
  for (const [branchId, set] of access.byBranch) if (set.has(permission)) ids.push(branchId);
  return ids;
}

/** Semua permission efektif (untuk dikirim ke client agar UI bisa menyembunyikan aksi). */
export function effectivePermissions(access: Access): string[] {
  const all = new Set(access.global);
  for (const set of access.byBranch.values()) for (const p of set) all.add(p);
  return [...all].sort();
}
