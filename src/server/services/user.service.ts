import "server-only";
import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { account, branches, roles, session, user, userRoleAssignments } from "@/server/db/schema";
import { auth } from "@/server/auth/auth";
import type { Actor } from "@/server/api/context";
import { ApiError, conflict, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { writeAudit } from "./audit.service";

export type AssignmentInput = { roleId: string; branchId: string | null };

/** 3 query: halaman user, total, dan assignment untuk user di halaman itu. */
export async function listUsers(params: { q?: string; page: number; pageSize: number }) {
  const where: SQL | undefined = params.q
    ? or(ilike(user.name, `%${params.q}%`), ilike(user.email, `%${params.q}%`))
    : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email, phone: user.phone, isActive: user.isActive, createdAt: user.createdAt })
      .from(user)
      .where(where)
      .orderBy(asc(user.name))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(user).where(where),
  ]);

  const assignments = rows.length
    ? await db
        .select({
          userId: userRoleAssignments.userId,
          roleId: roles.id,
          roleName: roles.name,
          branchId: branches.id,
          branchName: branches.name,
        })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .leftJoin(branches, eq(branches.id, userRoleAssignments.branchId))
        .where(inArray(userRoleAssignments.userId, rows.map((r) => r.id)))
    : [];

  const byUser = new Map<string, typeof assignments>();
  for (const a of assignments) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);

  return {
    data: rows.map((r) => ({
      ...r,
      assignments: (byUser.get(r.id) ?? []).map(({ userId: _userId, ...a }) => a),
    })),
    meta: toPageMeta(params.page, params.pageSize, total),
  };
}

async function assertAssignable(actor: Actor, assignments: AssignmentInput[]) {
  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  if (!roleIds.length) return;
  const found = await db.select({ id: roles.id, isSystem: roles.isSystem }).from(roles).where(inArray(roles.id, roleIds));
  if (found.length !== roleIds.length) throw notFound("Role");
  // Hanya Owner yang boleh menjadikan orang lain Owner.
  if (found.some((r) => r.isSystem) && !actor.access.roleNames.includes("Owner")) {
    throw new ApiError(403, "PERMISSION_ESCALATION", "Hanya Owner yang bisa memberikan role Owner.");
  }
}

export async function createUser(
  actor: Actor,
  input: { name: string; email: string; phone?: string | null; password: string; assignments: AssignmentInput[] },
) {
  await assertAssignable(actor, input.assignments);
  const email = input.email.toLowerCase();
  const [exists] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (exists) throw conflict("EMAIL_TAKEN", "Email sudah dipakai pengguna lain.");

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(input.password);
  const id = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id, name: input.name, email, phone: input.phone, emailVerified: true });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
    });
    if (input.assignments.length) {
      await tx.insert(userRoleAssignments).values(input.assignments.map((a) => ({ userId: id, ...a })));
    }
    await writeAudit(
      actor,
      { action: "create", entity: "user", entityId: id, after: { name: input.name, email, assignments: input.assignments } },
      tx,
    );
  });
  return { id, name: input.name, email };
}

export async function updateUser(
  actor: Actor,
  id: string,
  input: { name?: string; phone?: string | null; isActive?: boolean; assignments?: AssignmentInput[] },
) {
  const [existing] = await db.select().from(user).where(eq(user.id, id));
  if (!existing) throw notFound("Pengguna");
  if (id === actor.userId && input.isActive === false) {
    throw conflict("CANNOT_DISABLE_SELF", "Anda tidak bisa menonaktifkan akun sendiri.");
  }
  if (input.assignments) await assertAssignable(actor, input.assignments);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ name: input.name, phone: input.phone, isActive: input.isActive, updatedAt: new Date() })
      .where(eq(user.id, id));
    if (input.assignments) {
      await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, id));
      if (input.assignments.length) {
        await tx.insert(userRoleAssignments).values(input.assignments.map((a) => ({ userId: id, ...a })));
      }
    }
    if (input.isActive === false) {
      // Putus semua sesi aktif saat akun dinonaktifkan.
      await tx.delete(session).where(eq(session.userId, id));
    }
    await writeAudit(actor, { action: "update", entity: "user", entityId: id, before: existing, after: input }, tx);
  });
}

export async function resetUserPassword(actor: Actor, id: string, password: string) {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const [row] = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, id), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  if (!row) throw notFound("Pengguna");
  await writeAudit(actor, { action: "reset_password", entity: "user", entityId: id });
}
