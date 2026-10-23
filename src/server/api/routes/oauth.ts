import { createRoute, z } from "@hono/zod-openapi";
import { decideAuthorization, describeAuthorization, disconnectApp, listConnectedApps, OAuthError } from "@/server/services/oauth.service";
import { ApiError } from "../errors";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, json, serialize } from "../schemas";

/** Parameter permintaan otorisasi dari aplikasi AI (diteruskan apa adanya oleh halaman /oauth/authorize). */
const authorizeParams = z
  .object({
    response_type: z.string().max(20),
    client_id: z.string().min(1).max(100),
    redirect_uri: z.string().max(500).optional(),
    code_challenge: z.string().max(128).optional(),
    code_challenge_method: z.string().max(10).optional(),
    scope: z.string().max(200).optional(),
    state: z.string().max(500).optional(),
    resource: z.string().max(500).optional(),
  })
  .openapi("OAuthAuthorizeParams");

const appSchema = z
  .object({ clientId: z.string(), name: z.string(), redirectUris: z.array(z.string()), connectedAt: z.string().nullable(), lastUsedAt: z.string().nullable() })
  .openapi("OAuthConnectedApp");

/** Kesalahan OAuth sebelum redirect_uri tepercaya → tampil di halaman persetujuan (bukan di-redirect). */
const asApiError = (e: unknown) => (e instanceof OAuthError ? new ApiError(400, `OAUTH_${e.error.toUpperCase()}`, e.description) : e);

/** Route bersesi (cookie login): layar persetujuan & daftar aplikasi terhubung. */
export const oauthRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/oauth/authorize",
      tags: ["OAuth (aplikasi AI)"],
      summary: "Detail permintaan akses aplikasi AI untuk layar persetujuan",
      request: { query: authorizeParams },
      responses: {
        200: json(
          dataOf(
            z.object({
              client: z.object({ id: z.string(), name: z.string(), redirectHost: z.string() }),
              scope: z.string(),
              account: z.object({ name: z.string(), email: z.string() }),
              error: z.object({ error: z.string(), description: z.string(), redirectTo: z.string() }).nullable(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      try {
        return c.json({ data: await describeAuthorization(c.get("actor"), c.req.valid("query")) }, 200);
      } catch (e) {
        throw asApiError(e);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/oauth/authorize",
      tags: ["OAuth (aplikasi AI)"],
      summary: "Izinkan atau tolak akses aplikasi AI; mengembalikan alamat kembali ke aplikasi",
      request: { body: body(z.object({ params: authorizeParams, approve: z.boolean() })) },
      responses: { 200: json(dataOf(z.object({ redirectTo: z.string() }))), ...errorResponses },
    }),
    async (c) => {
      const { params, approve } = c.req.valid("json");
      try {
        return c.json({ data: await decideAuthorization(c.get("actor"), params, approve) }, 200);
      } catch (e) {
        throw asApiError(e);
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/oauth/apps",
      tags: ["OAuth (aplikasi AI)"],
      summary: "Aplikasi AI yang terhubung ke akun ini lewat OAuth",
      responses: { 200: json(dataOf(z.array(appSchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listConnectedApps(c.get("actor"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/oauth/apps/{clientId}",
      tags: ["OAuth (aplikasi AI)"],
      summary: "Putuskan aplikasi AI (cabut semua tokennya)",
      request: { params: z.object({ clientId: z.string().min(1).max(100).openapi({ param: { name: "clientId", in: "path" } }) }) },
      responses: { 204: { description: "Diputuskan" }, ...errorResponses },
    }),
    async (c) => {
      await disconnectApp(c.get("actor"), c.req.valid("param").clientId);
      return c.body(null, 204);
    },
  );
