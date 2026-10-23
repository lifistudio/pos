/**
 * PostgreSQL lokal untuk development tanpa Docker (binary resmi via embedded-postgres).
 * Data disimpan di `.data/pg`. Jalankan: `pnpm db:start`. Hentikan dengan Ctrl+C.
 * Jika Docker tersedia, `docker compose up -d` bisa dipakai sebagai gantinya (port sama).
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

const url = new URL(process.env.DATABASE_URL ?? "postgres://pos:pos_dev_password@127.0.0.1:5433/pos");
const databaseDir = path.resolve(".data/pg");
const isNew = !existsSync(path.join(databaseDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port),
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  if (isNew) await pg.initialise();
  await pg.start();
  const dbName = url.pathname.slice(1);
  if (isNew) await pg.createDatabase(dbName);
  console.log(`PostgreSQL siap di 127.0.0.1:${url.port}/${dbName}`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
