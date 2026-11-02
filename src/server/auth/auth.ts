import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { and, count, eq, gt, max, sql } from "drizzle-orm";
import { clientIp } from "@/server/api/rate-limit";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { mailEnabled, sendPasswordResetEmail } from "@/server/email/mailer";
import { env } from "@/server/env";

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_WINDOW = "15 minutes";
const AUTH_ENTITY = "auth";

/**
 * Rate limit per IP tidak menahan tebakan terdistribusi, jadi kegagalan juga dihitung per akun (PRD §3.1).
 * Hanya kegagalan setelah login berhasil terakhir yang dihitung, dan kunci terbuka sendiri setelah jendela lewat.
 */
async function loginLocked(email: string) {
  const { auditLogs } = schema;
  const [last] = await db
    .select({ at: max(auditLogs.createdAt) })
    .from(auditLogs)
    .where(and(eq(auditLogs.entity, AUTH_ENTITY), eq(auditLogs.entityId, email), eq(auditLogs.action, "login")));
  const [{ failed }] = await db
    .select({ failed: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entity, AUTH_ENTITY),
        eq(auditLogs.entityId, email),
        eq(auditLogs.action, "login_failed"),
        gt(auditLogs.createdAt, sql`now() - ${LOGIN_LOCK_WINDOW}::interval`),
        last?.at ? gt(auditLogs.createdAt, last.at) : undefined,
      ),
    );
  return failed >= MAX_LOGIN_FAILURES;
}

const auditAuth = (action: string, email: string, headers: Headers | undefined, actorId: string | null = null) =>
  db.insert(schema.auditLogs).values({
    actorId,
    actorType: actorId ? "USER" : "SYSTEM",
    action,
    entity: AUTH_ENTITY,
    entityId: email,
    ip: headers ? clientIp(headers) : null,
    userAgent: headers?.get("user-agent") ?? null,
  });

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Akun dibuat oleh admin lewat API /users, bukan registrasi publik.
    disableSignUp: true,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // Tidak ditunggu: waktu respons tidak boleh membedakan email yang terdaftar dan yang tidak.
    ...(mailEnabled()
      ? {
          sendResetPassword: async ({ user, url }: { user: { email: string; name: string; isActive?: boolean | null }; url: string }) => {
            if (user.isActive === false) return;
            void sendPasswordResetEmail(user.email, user.name, url).catch((error) => console.error("[email] gagal kirim reset password", (error as Error).message));
          },
        }
      : {}),
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false, input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 jam — satu hari kerja
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    useSecureCookies: env.NODE_ENV === "production",
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = String(ctx.body?.email ?? "").trim().toLowerCase();
      if (email && (await loginLocked(email))) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Terlalu banyak percobaan gagal. Akun dikunci sementara, coba lagi dalam 15 menit." });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = String(ctx.body?.email ?? "").trim().toLowerCase();
        if (!email) return;
        const session = ctx.context.newSession;
        if (session) await auditAuth("login", email, ctx.headers, session.user.id);
        else if (isAPIError(ctx.context.returned) && ctx.context.returned.statusCode === 401) await auditAuth("login_failed", email, ctx.headers);
      }
      if (ctx.path === "/reset-password" && !isAPIError(ctx.context.returned)) await auditAuth("reset_password_email", "token", ctx.headers);
      if (ctx.path === "/change-password" && !isAPIError(ctx.context.returned)) {
        const session = ctx.context.session ?? ctx.context.newSession;
        if (session) await auditAuth("change_password", session.user.email, ctx.headers, session.user.id);
      }
    }),
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
