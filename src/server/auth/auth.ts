import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env } from "@/server/env";

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
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    useSecureCookies: env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
