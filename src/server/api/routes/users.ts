import { createRoute, z } from "@hono/zod-openapi";
import { createUser, listUsers, resetUserPassword, updateUser } from "@/server/services/user.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, json, serialize, userIdParam } from "../schemas";

const assignmentInput = z.object({
  roleId: z.string().uuid(),
  branchId: z.string().uuid().nullable().openapi({ description: "null = berlaku di semua cabang" }),
});

const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    assignments: z.array(
      z.object({ roleId: z.string(), roleName: z.string(), branchId: z.string().nullable(), branchName: z.string().nullable() }),
    ),
  })
  .openapi("User");

const password = z.string().min(10, "Minimal 10 karakter").max(128);

export const userRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/users",
      tags: ["Pengguna"],
      summary: "Daftar pengguna",
      middleware: [requirePermission("user:read")] as const,
      request: { query: pageQuery.extend({ q: z.string().trim().max(100).optional() }) },
      responses: { 200: json(z.object({ data: z.array(userSchema), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listUsers(c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/users",
      tags: ["Pengguna"],
      summary: "Tambah pengguna dan tetapkan role per cabang",
      middleware: [requirePermission("user:create")] as const,
      request: {
        body: body(
          z
            .object({
              name: z.string().trim().min(2).max(80),
              email: z.string().trim().email(),
              phone: z.string().trim().max(30).nullish(),
              password,
              assignments: z.array(assignmentInput).min(1, "Pilih minimal satu role").max(100),
            })
            .openapi("UserCreateInput"),
        ),
      },
      responses: {
        201: json(dataOf(z.object({ id: z.string(), name: z.string(), email: z.string() })), "Pengguna dibuat"),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await createUser(c.get("actor"), c.req.valid("json")) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/users/{id}",
      tags: ["Pengguna"],
      summary: "Ubah data, status aktif, atau role pengguna",
      middleware: [requirePermission("user:update")] as const,
      request: {
        params: userIdParam,
        body: body(
          z
            .object({
              name: z.string().trim().min(2).max(80),
              phone: z.string().trim().max(30).nullable(),
              isActive: z.boolean(),
              assignments: z.array(assignmentInput).max(100),
            })
            .partial()
            .openapi("UserUpdateInput"),
        ),
      },
      responses: { 204: { description: "Tersimpan" }, ...errorResponses },
    }),
    async (c) => {
      await updateUser(c.get("actor"), c.req.valid("param").id, c.req.valid("json"));
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/users/{id}/reset-password",
      tags: ["Pengguna"],
      summary: "Atur ulang password pengguna",
      middleware: [requirePermission("user:update")] as const,
      request: { params: userIdParam, body: body(z.object({ password })) },
      responses: { 204: { description: "Password diperbarui" }, ...errorResponses },
    }),
    async (c) => {
      await resetUserPassword(c.get("actor"), c.req.valid("param").id, c.req.valid("json").password);
      return c.body(null, 204);
    },
  );
