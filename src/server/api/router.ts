import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "./context";

// Pesan validasi bawaan Zod dalam Bahasa Indonesia.
z.config(z.locales.id());

/** Router dengan validasi Zod yang mengembalikan format error standar (400 + detail field). */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Periksa kembali isian yang ditandai.",
              details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            },
          },
          400,
        );
      }
    },
  });
}
