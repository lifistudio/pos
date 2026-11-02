import "server-only";
import { Scalar } from "@scalar/hono-api-reference";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { rateLimit } from "./rate-limit";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { auth } from "@/server/auth/auth";
import { MarketplaceError } from "@/server/marketplace/types";
import { createMcpServer, type CallApi } from "@/server/mcp/server";
import { handleMarketplaceWebhook } from "@/server/services/marketplace.service";
import { mailEnabled } from "@/server/email/mailer";
import { handleGatewayNotification } from "@/server/services/payment.service";
import { providerByName } from "@/server/payments/provider";
import {
  authorizationServerMetadata,
  exchangeToken,
  issuer,
  OAuthError,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
} from "@/server/services/oauth.service";
import { can } from "@/server/rbac/access";
import { buildQuery } from "@/lib/api-client";
import type { AppEnv } from "./context";
import { ApiError, forbidden } from "./errors";
import { authenticate } from "./middleware";
import { createRouter } from "./router";
import { apiKeyRoutes } from "./routes/api-keys";
import { approvalRoutes } from "./routes/approvals";
import { auditRoutes } from "./routes/audit-logs";
import { branchRoutes } from "./routes/branches";
import { brandRoutes } from "./routes/brands";
import { categoryRoutes } from "./routes/categories";
import { dashboardRoutes } from "./routes/dashboard";
import { inventoryRoutes } from "./routes/inventory";
import { marketplaceRoutes } from "./routes/marketplace";
import { meRoutes } from "./routes/me";
import { productRoutes } from "./routes/products";
import { roleRoutes } from "./routes/roles";
import { customerRoutes } from "./routes/customers";
import { offlineRoutes } from "./routes/offline";
import { oauthRoutes } from "./routes/oauth";
import { onlineOrderRoutes } from "./routes/online-orders";
import { reportRoutes } from "./routes/reports";
import { returnRoutes } from "./routes/returns";
import { salesRoutes } from "./routes/sales";
import { stockOpsRoutes } from "./routes/stock-ops";
import { voucherRoutes } from "./routes/vouchers";
import { userRoutes } from "./routes/users";

/** Pesan ramah untuk pelanggaran unique constraint Postgres (kode 23505). */
const UNIQUE_MESSAGES: Record<string, { code: string; message: string }> = {
  product_variants_sku_uq: { code: "SKU_TAKEN", message: "SKU sudah dipakai varian lain. Gunakan SKU berbeda." },
  product_variants_barcode_uq: { code: "BARCODE_TAKEN", message: "Barcode sudah dipakai varian lain." },
  branches_code_uq: { code: "BRANCH_CODE_TAKEN", message: "Kode cabang sudah dipakai." },
  roles_name_uq: { code: "ROLE_NAME_TAKEN", message: "Nama role sudah ada." },
  roles_name_lower_uq: { code: "ROLE_NAME_TAKEN", message: "Nama role sudah ada (huruf besar/kecil dianggap sama)." },
  membership_tiers_name_lower_uq: { code: "TIER_NAME_TAKEN", message: "Nama tier sudah ada (huruf besar/kecil dianggap sama)." },
  brands_name_key_uq: { code: "BRAND_EXISTS", message: "Merek ini sudah ada." },
  categories_slug_uq: { code: "CATEGORY_TAKEN", message: "Kategori dengan nama ini sudah ada." },
  vouchers_code_uq: { code: "VOUCHER_CODE_TAKEN", message: "Kode voucher sudah dipakai. Gunakan kode lain." },
  customers_phone_uq: { code: "PHONE_TAKEN", message: "Nomor HP sudah terdaftar." },
  membership_tiers_name_uq: { code: "TIER_NAME_TAKEN", message: "Nama tier sudah ada." },
  online_orders_external_uq: { code: "EXTERNAL_ORDER_EXISTS", message: "Nomor order kanal ini sudah pernah diinput." },
  marketplace_connections_shop_uq: { code: "SHOP_ALREADY_CONNECTED", message: "Toko ini sudah terhubung." },
};

function findPgError(err: unknown): { code?: string; constraint_name?: string } | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return null;
}

const v1 = createRouter();

v1.openAPIRegistry.registerComponent("securitySchemes", "ApiKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "API key personal (Pengaturan → API key). Hak akses mengikuti role pemilik key.",
});
v1.openAPIRegistry.registerComponent("securitySchemes", "Session", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "Cookie sesi setelah login di aplikasi.",
});


// Spesifikasi & dokumentasi interaktif hanya untuk user/API key dengan permission api_docs:read.
const requireDocs = createMiddleware<AppEnv>(async (c, next) => {
  if (!can(c.get("actor").access, "api_docs:read")) throw forbidden("api_docs:read");
  return next();
});
v1.use("/openapi.json", authenticate, requireDocs);
v1.use("/reference", authenticate, requireDocs);
v1.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "POS API",
    version: "1.0.0",
    description:
      "API sistem POS multi-cabang. Semua data aplikasi (UI, integrasi, MCP) melewati API ini. " +
      "Uang dalam rupiah integer. List memakai pagination (`page`/`pageSize` atau `cursor`/`limit`).",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ Session: [] }, { ApiKey: [] }],
});
v1.get(
  "/reference",
  Scalar({
    url: "/api/v1/openapi.json",
    // Versi bundle dikunci (≥ 2 minggu sejak rilis) agar CDN tidak diam-diam memuat versi baru.
    cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.3",
    pageTitle: "POS API Reference",
    theme: "default",
    layout: "modern",
    // Matikan fitur cloud Scalar agar spesifikasi API tidak pernah dikirim ke pihak luar.
    ...({ showToolbar: "never" } as object), // belum ada di tipe Configuration, tetapi dibaca runtime Scalar
    showDeveloperTools: "never",
    telemetry: false,
    mcp: { disabled: true },
    ...({ agent: { disabled: true } } as object), // matikan "Ask AI" (mengirim spesifikasi ke layanan Scalar)
    hideClientButton: true,
    defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
  }),
);

// Semua route bisnis wajib terautentikasi (dokumen di atas sudah diautentikasi sendiri).
v1.use("*", async (c, next) => {
  if (c.req.path.endsWith("/openapi.json") || c.req.path.endsWith("/reference")) return next();
  return authenticate(c, next);
});
// Batas wajar per pengguna/API key (UI kasir normal jauh di bawah ini); melindungi dari skrip/AI yang berulang tanpa henti.
v1.use("*", rateLimit("api", 600));

v1.route("/", meRoutes)
  .route("/", branchRoutes)
  .route("/", roleRoutes)
  .route("/", userRoutes)
  .route("/", categoryRoutes)
  .route("/", brandRoutes)
  .route("/", productRoutes)
  .route("/", inventoryRoutes)
  .route("/", dashboardRoutes)
  .route("/", auditRoutes)
  .route("/", apiKeyRoutes)
  .route("/", salesRoutes)
  .route("/", customerRoutes)
  .route("/", voucherRoutes)
  .route("/", stockOpsRoutes)
  .route("/", returnRoutes)
  .route("/", onlineOrderRoutes)
  .route("/", approvalRoutes)
  .route("/", reportRoutes)
  .route("/", marketplaceRoutes)
  .route("/", offlineRoutes)
  .route("/", oauthRoutes);

export const app = createRouter().basePath("/api");

app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-origin" }));
// Limit Better Auth memakai entri kiri X-Forwarded-For yang bisa dipalsukan; ini memakai IP dari proxy tepercaya.
app.use("/auth/sign-in/*", rateLimit("sign-in", 20, 60_000, "ip"));
app.use("/auth/request-password-reset", rateLimit("password-reset", 10, 3_600_000, "ip"));
app.use("/auth/reset-password", rateLimit("password-reset", 10, 3_600_000, "ip"));
app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
app.route("/v1", v1);
/** Opsi publik untuk halaman login (tanpa sesi). Tidak boleh berisi data rahasia. */
app.get("/public/config", (c) => c.json({ passwordReset: mailEnabled() }));

/**
 * Webhook payment gateway (publik, tanpa sesi): keaslian dijamin signature, idempotensi oleh
 * `payment_events.event_key`. Selalu jawab 200 untuk event yang sudah diproses agar gateway berhenti mengulang.
 */
/** Push marketplace (publik, tanpa sesi): signature diverifikasi adapter; body mentah dipakai untuk HMAC. */
app.post("/marketplace/webhook/:provider", rateLimit("webhook", 300, 60_000, "ip"), async (c) => {
  const raw = await c.req.text();
  // Shopee menandatangani URL yang didaftarkan; di balik reverse proxy c.req.url bisa berupa alamat internal.
  const result = await handleMarketplaceWebhook(c.req.param("provider"), raw, c.req.raw.headers, `${issuer()}${c.req.path}`);
  return c.json({ ok: true, ...result }, 200);
});

app.post("/payments/webhook/:provider", rateLimit("webhook", 300, 60_000, "ip"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw new ApiError(400, "INVALID_JSON", "Body harus JSON.");
  const name = c.req.param("provider");
  const result = await handleGatewayNotification(name, body, { headers: c.req.raw.headers, path: c.req.path });
  return c.json({ ok: true, outcome: result.outcome, ...providerByName(name)?.webhookAck }, 200);
});

/**
 * MCP server (Streamable HTTP, stateless) untuk AI agent: POST /api/mcp dengan header `x-api-key`.
 * Tool memanggil /api/v1 in-process memakai kredensial yang sama → RBAC identik dengan UI.
 */
/**
 * OAuth 2.1 untuk aplikasi AI (spesifikasi otorisasi MCP). Endpoint publik tanpa sesi; metadata juga tersedia di
 * /.well-known/* lewat rewrite next.config. CORS terbuka (tanpa cookie) agar klien MCP berbasis browser bisa memakainya.
 */
const oauthCors = createMiddleware(async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  return next();
});
app.use("/oauth/*", oauthCors);
app.get("/oauth/metadata/authorization-server", (c) => c.json(authorizationServerMetadata()));
app.get("/oauth/metadata/protected-resource", (c) => c.json(protectedResourceMetadata()));

/** Body token/revoke: form-urlencoded (standar) atau JSON; kredensial klien boleh lewat HTTP Basic. */
async function oauthForm(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const raw: Record<string, unknown> = type.includes("application/json")
    ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries(new URLSearchParams(await req.text()));
  const form: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.length <= 2000) form[k] = v;
  const authz = req.headers.get("authorization");
  let basic: { id: string; secret: string } | null = null;
  if (authz?.startsWith("Basic ")) {
    const decoded = Buffer.from(authz.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    try {
      if (colon > 0) basic = { id: decodeURIComponent(decoded.slice(0, colon)), secret: decodeURIComponent(decoded.slice(colon + 1)) };
    } catch {
      throw new OAuthError("invalid_client", "Header Basic tidak valid.", 401);
    }
  }
  return { form, basic };
}
const oauthFail = (e: unknown) => {
  if (!(e instanceof OAuthError)) throw e;
  return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
};

app.post("/oauth/register", rateLimit("oauth-register", 30, 3_600_000, "ip"), async (c) => {
  try {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== "object") throw new OAuthError("invalid_client_metadata", "Body harus JSON.");
    return c.json(await registerClient(input), 201, { "cache-control": "no-store" });
  } catch (e) {
    return oauthFail(e);
  }
});
app.post("/oauth/token", rateLimit("oauth-token", 120, 60_000, "ip"), async (c) => {
  try {
    const { form, basic } = await oauthForm(c.req.raw);
    return c.json(await exchangeToken(form, basic), 200, { "cache-control": "no-store", pragma: "no-cache" }); // token tidak boleh di-cache
  } catch (e) {
    return oauthFail(e);
  }
});
app.post("/oauth/revoke", rateLimit("oauth-token", 120, 60_000, "ip"), async (c) => {
  try {
    const { form, basic } = await oauthForm(c.req.raw);
    await revokeToken(form, basic);
    return c.body(null, 200);
  } catch (e) {
    return oauthFail(e);
  }
});

/** 401 di /api/mcp menunjuk metadata OAuth (RFC 9728) agar klien AI bisa memulai login sendiri. */
const mcpAuth = createMiddleware<AppEnv>(async (c, next) => {
  try {
    await authenticate(c, next);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const err = e.code === "INVALID_TOKEN" || e.code === "INVALID_API_KEY" ? ', error="invalid_token"' : "";
      c.header("WWW-Authenticate", `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read"${err}`);
      c.header("Access-Control-Expose-Headers", "WWW-Authenticate");
    }
    throw e;
  }
});

app.post("/mcp", mcpAuth, rateLimit("mcp", 120), async (c) => {
  const forwarded = new Headers();
  for (const key of ["x-api-key", "authorization", "cookie", "user-agent"]) {
    const value = c.req.header(key);
    if (value) forwarded.set(key, value);
  }
  const callApi: CallApi = async (path, query) => {
    const res = await app.request(`/api/v1${path}${buildQuery(query)}`, { headers: forwarded });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error?.message ?? `Permintaan gagal (${res.status}).`);
    return payload;
  };
  const server = createMcpServer(c.get("actor"), callApi);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
app.on(["GET", "DELETE"], "/mcp", (c) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Gunakan POST (mode stateless)." }, id: null }, 405),
);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof MarketplaceError) {
    const status = err.kind === "AUTH" ? 401 : err.kind === "RATE_LIMIT" ? 429 : 502;
    return c.json({ error: { code: `MARKETPLACE_${err.kind}`, message: err.message } }, status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "HTTP_ERROR", message: err.message } }, err.status);
  }
  const pg = findPgError(err);
  if (pg?.code === "23505") {
    const mapped = (pg.constraint_name && UNIQUE_MESSAGES[pg.constraint_name]) || {
      code: "DUPLICATE",
      message: "Data yang sama sudah ada.",
    };
    return c.json({ error: mapped }, 409);
  }
  if (pg?.code === "23503") {
    return c.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Data terkait tidak ditemukan atau masih dipakai." } }, 409);
  }
  console.error("[api] unhandled error", err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan di server. Coba lagi." } }, 500);
});

export type App = typeof app;
