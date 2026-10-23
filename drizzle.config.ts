import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
});
