import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { approvalGrants, approvalPins, auditLogs, rolePermissions, user, userRoleAssignments } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { can } from "@/server/rbac/access";
import type { Permission } from "@/server/rbac/permissions";
import { writeAudit } from "./audit.service";

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

/** Aksi kasir yang boleh dijalankan dengan persetujuan PIN atasan. */
export const APPROVABLE = ["pos:void", "pos:refund", "pos:discount_manual"] as const satisfies readonly Permission[];
export type ApprovablePermission = (typeof APPROVABLE)[number];

const GRANT_TTL_MS = 10 * 60_000;
const MAX_FAILED = 5;
const LOCK_WINDOW = "10 minutes";

async function hashPin(pin: string, salt: string) {
  return (await scrypt(pin, salt, 32)).toString("hex");
}

// ── PIN milik sendiri ───────────────────────────────────────────────────

export async function hasApprovalPin(userId: string) {
  const [row] = await db.select({ userId: approvalPins.userId }).from(approvalPins).where(eq(approvalPins.userId, userId));
  return !!row;
}

/** Atur/ganti PIN sendiri. Mengganti PIN yang sudah ada wajib menyebut PIN lama. */
export async function setOwnPin(actor: Actor, input: { pin: string; currentPin?: string | null }) {
  if (actor.type !== "USER") throw forbidden("PIN hanya bisa diatur dari sesi login.");
  if (/^(\d)\1+$/.test(input.pin) || "0123456789".includes(input.pin) || "9876543210".includes(input.pin)) {
    throw badRequest("PIN_TOO_WEAK", "PIN terlalu mudah ditebak. Hindari angka berulang atau berurutan.");
  }
  const [existing] = await db.select().from(approvalPins).where(eq(approvalPins.userId, actor.userId));
  if (existing) {
    if (!input.currentPin) throw badRequest("CURRENT_PIN_REQUIRED", "Masukkan PIN lama untuk mengganti PIN.");
    const ok = await verifyHash(input.currentPin, existing.salt, existing.pinHash);
    if (!ok) throw new ApiError(403, "PIN_INVALID", "PIN lama salah.");
  }
  const salt = randomBytes(16).toString("hex");
  const pinHash = await hashPin(input.pin, salt);
  await db
    .insert(approvalPins)
    .values({ userId: actor.userId, pinHash, salt })
    .onConflictDoUpdate({ target: approvalPins.userId, set: { pinHash, salt, updatedAt: new Date() } });
  await writeAudit(actor, { action: existing ? "change_pin" : "set_pin", entity: "user", entityId: actor.userId });
}

/** Admin menghapus PIN pengguna (lupa PIN / karyawan keluar). */
export async function resetUserPin(actor: Actor, userId: string) {
  const deleted = await db.delete(approvalPins).where(eq(approvalPins.userId, userId)).returning({ userId: approvalPins.userId });
  if (!deleted.length) throw notFound("PIN");
  await writeAudit(actor, { action: "reset_pin", entity: "user", entityId: userId });
}

async function verifyHash(pin: string, salt: string, expected: string) {
  const got = Buffer.from(await hashPin(pin, salt), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── Permintaan persetujuan ──────────────────────────────────────────────

/**
 * Kasir meminta persetujuan: atasan mengetik PIN-nya di perangkat kasir. PIN dicocokkan dengan semua
 * user aktif yang punya permission tsb. di cabang ini (global atau penugasan cabang). Gagal 5× dalam
 * 10 menit → dikunci sementara. Berhasil → izin sekali pakai berlaku 10 menit.
 */
export async function requestApproval(actor: Actor, input: { permission: ApprovablePermission; branchId: string; pin: string }) {
  if (!can(actor.access, "pos:access", input.branchId) && !can(actor.access, "sale:read", input.branchId)) throw forbidden("pos:access");
  const [{ failed }] = await db
    .select({ failed: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actor.userId), eq(auditLogs.action, "approval_failed"), gt(auditLogs.createdAt, sql`now() - ${LOCK_WINDOW}::interval`)));
  if (failed >= MAX_FAILED) throw new ApiError(429, "APPROVAL_LOCKED", "Terlalu banyak PIN salah. Coba lagi dalam 10 menit.");

  // Calon penyetuju: penugasan global (branch null) atau di cabang ini, role memuat permission, punya PIN, akun aktif.
  const candidates = await db
    .selectDistinct({ userId: user.id, name: user.name, pinHash: approvalPins.pinHash, salt: approvalPins.salt })
    .from(userRoleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
    .innerJoin(user, eq(user.id, userRoleAssignments.userId))
    .innerJoin(approvalPins, eq(approvalPins.userId, user.id))
    .where(
      and(
        eq(user.isActive, true),
        or(isNull(userRoleAssignments.branchId), eq(userRoleAssignments.branchId, input.branchId)),
        inArray(rolePermissions.permission, [input.permission, "*"]),
      ),
    );
  let approver: { userId: string; name: string } | null = null;
  for (const c of candidates) {
    if (c.userId === actor.userId) continue; // tidak bisa menyetujui diri sendiri lewat PIN
    if (await verifyHash(input.pin, c.salt, c.pinHash)) {
      approver = c;
      break;
    }
  }
  if (!approver) {
    await writeAudit(actor, { action: "approval_failed", entity: "approval", after: { permission: input.permission, branchId: input.branchId } });
    throw new ApiError(403, "PIN_INVALID", "PIN salah atau pemilik PIN tidak berwenang di cabang ini.");
  }
  const [grant] = await db
    .insert(approvalGrants)
    .values({ permission: input.permission, branchId: input.branchId, requestedBy: actor.userId, approvedBy: approver.userId, expiresAt: new Date(Date.now() + GRANT_TTL_MS) })
    .returning({ id: approvalGrants.id, expiresAt: approvalGrants.expiresAt });
  await writeAudit(actor, { action: "approval_granted", entity: "approval", entityId: grant.id, after: { permission: input.permission, branchId: input.branchId, approvedBy: approver.userId } });
  return { approvalId: grant.id, approverName: approver.name, expiresAt: grant.expiresAt };
}

/**
 * Otorisasi aksi sensitif: punya permission sendiri → lanjut (approver null); kalau tidak, pakai izin
 * PIN yang masih berlaku untuk permission + cabang + peminta yang sama, sekali pakai (di transaksi aksi).
 * Mengembalikan id atasan yang menyetujui.
 */
export async function authorizeOrApprove(tx: Tx, actor: Actor, permission: ApprovablePermission, branchId: string, approvalId: string | null | undefined, usedFor: string) {
  if (can(actor.access, permission, branchId)) return null;
  if (!approvalId) throw new ApiError(403, "APPROVAL_REQUIRED", "Aksi ini butuh persetujuan atasan (PIN).", { permission });
  const [grant] = await tx
    .update(approvalGrants)
    .set({ usedAt: new Date(), usedFor })
    .where(
      and(
        eq(approvalGrants.id, approvalId),
        eq(approvalGrants.permission, permission),
        eq(approvalGrants.branchId, branchId),
        eq(approvalGrants.requestedBy, actor.userId),
        isNull(approvalGrants.usedAt),
        gt(approvalGrants.expiresAt, new Date()),
      ),
    )
    .returning({ approvedBy: approvalGrants.approvedBy });
  if (!grant) throw conflict("APPROVAL_INVALID", "Persetujuan tidak berlaku (sudah dipakai, kedaluwarsa, atau untuk aksi lain). Minta PIN atasan lagi.");
  return grant.approvedBy;
}
