#!/usr/bin/env node
/** `pnpm local`: jalankan PostgreSQL bawaan + aplikasi hasil build, untuk instalasi tanpa Docker. Ctrl+C untuk berhenti. */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import "dotenv/config";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shell = process.platform === "win32";
const run = (script, env) => spawn("corepack", ["pnpm", script], { cwd: root, stdio: "inherit", shell, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", ...env } });
const open = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

const dbPort = Number(new URL(process.env.DATABASE_URL).port);
let db = null;
if (!(await open(dbPort))) {
  db = run("db:start", { NODE_ENV: "development" });
  while (!(await open(dbPort))) await new Promise((r) => setTimeout(r, 500));
}
const app = run("start", { NODE_ENV: "production" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (app.kill(signal), db?.kill(signal)));
app.on("exit", (code) => {
  db?.kill("SIGINT");
  process.exit(code ?? 0);
});
