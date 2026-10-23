import { createRoute, z } from "@hono/zod-openapi";
import { effectivePermissions } from "@/server/rbac/access";
import { hasApprovalPin } from "@/server/services/approval.service";
import { listBranches } from "@/server/services/branch.service";
import { createRouter } from "../router";
import { dataOf, errorResponses, json } from "../schemas";

const meSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    authType: z.enum(["USER", "API_KEY", "OAUTH"]),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    branches: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), type: z.string() })),
    hasApprovalPin: z.boolean(),
  })
  .openapi("Me");

export const meRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["Akun"],
    summary: "Profil, role, permission efektif, dan cabang yang bisa diakses",
    responses: { 200: json(dataOf(meSchema)), 401: errorResponses[401] },
  }),
  async (c) => {
    const actor = c.get("actor");
    const [branches, hasPin] = await Promise.all([listBranches(actor), hasApprovalPin(actor.userId)]);
    return c.json(
      {
        data: {
          ...actor.user,
          authType: actor.type,
          roles: actor.access.roleNames,
          permissions: effectivePermissions(actor.access),
          branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name, type: b.type })),
          hasApprovalPin: hasPin,
        },
      },
      200,
    );
  },
);
