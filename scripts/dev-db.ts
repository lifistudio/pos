/**
 * PostgreSQL lokal untuk development tanpa Docker (binary resmi via embedded-postgres).
 * Data disimpan di `.data/pg`. Jalankan: `pnpm db:start`. Hentikan dengan Ctrl+C.
 * Jika Docker tersedia, `docker compose up -d` bisa dipakai sebagai gantinya (port sama).
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import "dotenv/config";

const url = new URL(process.env.DATABASE_URL ?? "postgres://pos:pos_dev_password@127.0.0.1:5433/pos");
const databaseDir = path.resolve(".data/pg");
// initdb yang terputus meninggalkan PG_VERSION tanpa database bawaan `postgres` (oid 5), dan belum berisi data.
if (existsSync(path.join(databaseDir, "PG_VERSION")) && !existsSync(path.join(databaseDir, "base", "5"))) {
  console.log("Folder database belum selesai dibuat, mengulang dari awal.");
  rmSync(databaseDir, { recursive: true, force: true });
}
const isNew = !existsSync(path.join(databaseDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port),
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  // Terminal ditutup paksa: tanpa ini postmaster sempat memulai ulang proses anak yang lalu tertinggal memegang port.
  postgresFlags: ["-c", "restart_after_crash=off"],
});

// Di Windows pg.stop() mematikan postmaster secara paksa, dan proses anaknya bisa tertinggal memegang port. pg_ctl berhenti rapi.
async function stopServer() {
  if (process.platform === "win32") {
    const fromRepo = createRequire(path.resolve("package.json"));
    const entry = createRequire(fromRepo.resolve("embedded-postgres")).resolve("@embedded-postgres/windows-x64");
    const pgCtl = path.join(path.dirname(entry), "..", "native", "bin", "pg_ctl.exe");
    const result = spawnSync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"], { stdio: "ignore", windowsHide: true });
    if (result.status === 0) return;
  }
  await pg.stop();
}

async function main() {
  if (isNew) await pg.initialise();
  await pg.start();
  const dbName = url.pathname.slice(1);
  const client = pg.getPgClient();
  await client.connect();
  const found = await client.query("select 1 from pg_database where datname = $1", [dbName]);
  await client.end();
  if (found.rowCount === 0) await pg.createDatabase(dbName);
  console.log(`PostgreSQL siap di 127.0.0.1:${url.port}/${dbName}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopServer();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Dipakai scripts/setup.mjs, supaya database ikut berhenti rapi walau penyiapan berakhir mendadak.
  if (process.env.POS_DB_STOP_ON_STDIN_END) {
    process.stdin.on("end", stop);
    process.stdin.resume();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
