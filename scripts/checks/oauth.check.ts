/**
 * Pemeriksaan OAuth: aturan redirect_uri (anti open-redirect & skema berbahaya) dan PKCE S256 (vektor RFC 7636).
 * Alur penuh (register → izin → token → MCP → rotasi/pemakaian ulang) diuji e2e terhadap server berjalan. Jalankan: pnpm check:oauth
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validRedirectUri } from "../../src/lib/oauth-redirect";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

for (const good of [
  "https://claude.ai/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "http://localhost:6274/oauth/callback",
  "http://127.0.0.1:33418/callback",
  "http://[::1]:8080/cb",
  "cursor://anysphere.cursor-retrieval/oauth/user-konten/callback",
  "vscode://vscode.github-authentication/did-authenticate",
]) assert.ok(validRedirectUri(good), good);
ok("redirect_uri sah: https, loopback, skema aplikasi");

for (const bad of [
  "http://evil.com/cb",
  "http://localhost.evil.com/cb",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "https://claude.ai/cb#frag",
  "https://user:pass@claude.ai/cb",
  "not a url",
  `https://claude.ai/${"a".repeat(600)}`,
]) assert.ok(!validRedirectUri(bad), bad);
ok("redirect_uri ditolak: http non-loopback, javascript/data/file, fragment, kredensial, terlalu panjang");

// RFC 7636 Appendix B
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
assert.equal(createHash("sha256").update(verifier).digest("base64url"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
ok("PKCE S256 sesuai vektor uji RFC 7636");

console.log(`\nOAuth: ${passed} pemeriksaan lulus.`);
