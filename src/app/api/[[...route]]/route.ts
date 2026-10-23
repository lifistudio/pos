import { handle } from "hono/vercel";
import { app } from "@/server/api/app";

/** Satu pintu untuk semua API: /api/auth/* (Better Auth) dan /api/v1/* (bisnis). */
const hono = handle(app);

/**
 * /.well-known/oauth-* di-rewrite ke sini (next.config) tetapi request membawa URL aslinya; petakan ke route API
 * metadata OAuth agar Hono (basePath /api) mengenalinya.
 */
function handler(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) url.pathname = "/api/oauth/metadata/authorization-server";
  else if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) url.pathname = "/api/oauth/metadata/protected-resource";
  else return hono(req);
  return hono(new Request(url, req));
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
