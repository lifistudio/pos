import { createRoute, z } from "@hono/zod-openapi";
import { APPROVABLE, requestApproval, resetUserPin, setOwnPin } from "@/server/services/approval.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, json } from "../schemas";

const pin = z.string().regex(/^\d{6}$/, "PIN harus 6 angka");

export const approvalRoutes = createRouter()
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/approvals",
      tags: ["Kasir (POS)"],
      summary: "Minta persetujuan atasan dengan PIN → izin sekali pakai (10 menit) untuk void/retur/diskon manual",
      description:
        "Kirim id izin di header `X-Approval-Id` pada aksi yang dimaksud. PIN dicocokkan dengan pengguna aktif yang punya permission tersebut di cabang ini. Salah 5× dalam 10 menit → terkunci sementara.",
      request: {
        body: body(z.object({ permission: z.enum(APPROVABLE), branchId: z.string().uuid(), pin })),
      },
      responses: { 200: json(dataOf(z.object({ approvalId: z.string(), approverName: z.string(), expiresAt: z.string() }))), ...errorResponses },
    }),
    async (c) => {
      const r = await requestApproval(c.get("actor"), c.req.valid("json"));
      return c.json({ data: { ...r, expiresAt: r.expiresAt.toISOString() } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/me/approval-pin",
      tags: ["Akun"],
      summary: "Atur atau ganti PIN persetujuan sendiri (6 angka)",
      request: { body: body(z.object({ pin, currentPin: pin.nullish() })) },
      responses: { 200: json(dataOf(z.object({ ok: z.boolean() }))), ...errorResponses },
    }),
    async (c) => {
      await setOwnPin(c.get("actor"), c.req.valid("json"));
      return c.json({ data: { ok: true } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/users/{id}/approval-pin",
      tags: ["Pengguna"],
      summary: "Hapus PIN persetujuan pengguna (lupa PIN / keluar)",
      middleware: [requirePermission("user:update")] as const,
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { 200: json(dataOf(z.object({ ok: z.boolean() }))), ...errorResponses },
    }),
    async (c) => {
      await resetUserPin(c.get("actor"), c.req.valid("param").id);
      return c.json({ data: { ok: true } }, 200);
    },
  );
