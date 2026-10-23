import { createRoute, z } from "@hono/zod-openapi";
import { createBranch, listBranches, updateBranch } from "@/server/services/branch.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const branchSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    type: z.enum(["STORE", "WAREHOUSE", "ONLINE"]),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    timezone: z.string(),
    settings: z.record(z.string(), z.unknown()),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Branch");

const branchInput = z
  .object({
    code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/, "Hanya huruf, angka, dan tanda hubung"),
    name: z.string().trim().min(2).max(80),
    type: z.enum(["STORE", "WAREHOUSE", "ONLINE"]).default("STORE"),
    address: z.string().trim().max(300).nullish(),
    phone: z.string().trim().max(30).nullish(),
    timezone: z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]).default("Asia/Jakarta"),
    settings: z
      .object({
        taxEnabled: z.boolean().optional(),
        taxRateBps: z.number().int().min(0).max(10_000).optional(),
        taxInclusive: z.boolean().optional(),
        receiptHeader: z.string().max(500).optional(),
        receiptFooter: z.string().max(500).optional(),
      })
      .optional(),
    isActive: z.boolean().optional(),
  })
  .openapi("BranchInput");

export const branchRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/branches",
      tags: ["Cabang"],
      summary: "Daftar cabang yang bisa diakses",
      responses: { 200: json(dataOf(z.array(branchSchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listBranches(c.get("actor"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/branches",
      tags: ["Cabang"],
      summary: "Tambah cabang",
      middleware: [requirePermission("branch:create")] as const,
      request: { body: body(branchInput) },
      responses: { 201: json(dataOf(branchSchema), "Cabang dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createBranch(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/branches/{id}",
      tags: ["Cabang"],
      summary: "Ubah cabang",
      middleware: [requirePermission("branch:update")] as const,
      request: { params: idParam, body: body(branchInput.partial()) },
      responses: { 200: json(dataOf(branchSchema)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await updateBranch(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  );
