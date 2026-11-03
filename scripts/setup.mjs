#!/usr/bin/env node
/**
 * Penyiapan aplikasi. Dipanggil oleh install.sh / install.ps1, atau langsung:
 *   node scripts/setup.mjs --docker   tulis .env saja; aplikasi dijalankan docker compose
 *   node scripts/setup.mjs --local    pasang semua tanpa Docker (Node.js + PostgreSQL bawaan), lalu jalankan
 * Tanpa pertanyaan: isi POS_URL, POS_OWNER_EMAIL, POS_OWNER_PASSWORD, POS_DEMO (true/false).
 * Aman dijalankan ulang: .env yang sudah ada tidak ditimpa.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, chmodSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const mode = process.argv.includes("--docker") ? "docker" : "local";
const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");

const windows = process.platform === "win32";
const pnpm = (args, opts = {}) => {
  const r = spawnSync("corepack", ["pnpm", ...args], { cwd: root, stdio: "inherit", shell: windows, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", ...opts.env } });
  if (r.status !== 0) throw new Error(`Perintah gagal: pnpm ${args.join(" ")}`);
};

async function terminal() {
  // Saat dijalankan lewat `curl | bash`, stdin berisi skrip: pertanyaan harus dibaca dari terminal.
  if (process.stdin.isTTY) return createInterface({ input: process.stdin, output: process.stdout });
  if (!windows && existsSync("/dev/tty")) {
    try {
      const { createReadStream } = await import("node:fs");
      closeSync(openSync("/dev/tty", "r"));
      return createInterface({ input: createReadStream("/dev/tty"), output: process.stdout });
    } catch {
      return null;
    }
  }
  return null;
}

async function askAll() {
  const given = { url: process.env.POS_URL, email: process.env.POS_OWNER_EMAIL, password: process.env.POS_OWNER_PASSWORD, demo: process.env.POS_DEMO };
  const rl = given.email && given.password ? null : await terminal();
  const ask = async (q, fallback) => (rl ? (await rl.question(`${q}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback : fallback);
  const url = (given.url ?? (await ask("Alamat aplikasi", "http://localhost:3000"))).replace(/\/$/, "");
  const email = given.email ?? (await ask("Email Owner", "owner@pos.local"));
  let password = given.password ?? (await ask("Password Owner (min. 12 karakter, kosongkan untuk dibuatkan)", ""));
  const generated = !password;
  if (generated) password = secret(12);
  if (password.length < 12) throw new Error("Password Owner minimal 12 karakter.");
  const demo = given.demo ?? (mode === "local" ? ((await ask("Isi data contoh? (y/n)", "y")).toLowerCase().startsWith("y") ? "true" : "false") : "false");
  rl?.close();
  return { url, email, password, generated, demo };
}

function writeEnv(a) {
  const dbPassword = secret(18);
  const lines = [
    "# Dibuat oleh installer. Semua opsi lain ada di .env.example. JANGAN commit berkas ini.",
    "NODE_ENV=production",
    `BETTER_AUTH_URL=${a.url}`,
    `BETTER_AUTH_SECRET=${secret()}`,
    `MARKETPLACE_SECRET=${secret()}`,
    `SEED_OWNER_EMAIL=${a.email}`,
    `SEED_OWNER_PASSWORD=${a.password}`,
    `SEED_DEMO=${a.demo}`,
    "PAYMENT_PROVIDER=none",
    ...(mode === "docker" ? [`POSTGRES_PASSWORD=${dbPassword}`] : [`DATABASE_URL=postgres://pos:${dbPassword}@127.0.0.1:5433/pos`, "TRUSTED_PROXY_HOPS=0"]),
  ];
  writeFileSync(envPath, `${lines.join("\n")}\n`);
  if (!windows) chmodSync(envPath, 0o600);
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

function readEnv() {
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

let database = null;

// dev-db berhenti rapi saat stdin ditutup. taskkill tidak dipakai: postgres yang dibunuh paksa bisa tertinggal memegang port.
async function stopDatabase() {
  if (!database || database.exitCode !== null) return;
  const exited = new Promise((resolve) => database.once("exit", resolve));
  database.stdin.end();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 20000))]);
}

async function startDatabase(env) {
  const port = Number(new URL(env.DATABASE_URL).port);
  if (await portOpen(port)) return;
  const log = openSync(path.join(root, ".data-db.log"), "a");
  // Tidak dilepas (detached): di Windows proses terlepas kadang terhenti oleh 0xC000013A saat initdb.
  // Database hidup selama penyiapan dan aplikasi, lalu berhenti bersamanya. Lihat ADR-040.
  database = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/dev-db.ts"], { cwd: root, stdio: ["pipe", log, log], windowsHide: true, env: { ...process.env, ...env, NODE_ENV: "development", POS_DB_STOP_ON_STDIN_END: "1" } });
  closeSync(log);
  for (let i = 0; i < 120; i++) {
    if (await portOpen(port)) return;
    if (database.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("PostgreSQL tidak menyala. Lihat .data-db.log.");
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Butuh Node.js 22 atau lebih baru (terpasang ${process.versions.node}).`);

  let answers = null;
  if (existsSync(envPath)) {
    console.log("• .env sudah ada, dipakai apa adanya.");
  } else {
    answers = await askAll();
    writeEnv(answers);
    console.log("✓ .env dibuat dengan kunci acak");
  }
  if (mode === "docker") return report(answers);

  const env = readEnv();
  // Paket dev dibutuhkan untuk PostgreSQL bawaan, migrasi, dan seed.
  pnpm(["install", "--frozen-lockfile"], { env: { NODE_ENV: "development" } });
  await startDatabase(env);
  console.log("✓ PostgreSQL berjalan");
  pnpm(["db:migrate"]);
  if (env.SEED_OWNER_PASSWORD) {
    pnpm(["db:seed"], { env: { ...env } });
    // Akun Owner sudah dibuat: password awal tidak perlu tertinggal di disk.
    writeFileSync(envPath, readFileSync(envPath, "utf8").replace(/^SEED_OWNER_PASSWORD=.*\r?\n/m, ""));
  }
  pnpm(["build"], { env: { NODE_ENV: "production" } });
  report(answers);
  if (!process.argv.includes("--no-start")) pnpm(["local"]);
}

function report(a) {
  if (!a) return;
  console.log(`\n  Alamat : ${a.url}\n  Email  : ${a.email}${a.generated ? `\n  Password: ${a.password}\n\n  Simpan password ini sekarang, tidak ditampilkan lagi.` : ""}\n`);
}

main()
  .catch((error) => {
    console.error(`\nGagal: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopDatabase();
    process.exit();
  });
