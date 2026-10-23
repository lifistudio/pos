/** Aturan redirect_uri klien OAuth (RFC 8252/OAuth 2.1). Murni agar bisa diuji (pnpm check:oauth). */
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);

/** https, http loopback (aplikasi desktop), atau skema khusus aplikasi (cursor://, vscode://). Tanpa fragment. */
export function validRedirectUri(value: string) {
  if (value.length > 500) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !BLOCKED_SCHEMES.has(u.protocol);
}
