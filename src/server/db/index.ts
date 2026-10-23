import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

declare global {
  var __posSql: ReturnType<typeof postgres> | undefined;
}

/** Satu pool per proses (dev HMR memakai ulang koneksi lewat globalThis). */
const client = globalThis.__posSql ?? postgres(env.DATABASE_URL, { max: 10, prepare: true });
if (process.env.NODE_ENV !== "production") globalThis.__posSql = client;

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
  logger: process.env.DB_LOG_QUERIES === "1",
});

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
