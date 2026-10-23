import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Aturan arsitektur: UI tidak boleh menyentuh database/service langsung — semua lewat API (docs/ARCHITECTURE.md §2).
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/db", "@/server/db/*"], message: "UI tidak boleh query database langsung. Panggil API (/api/v1) lewat lib/api-client atau apiServer()." },
            { group: ["@/server/services/*"], message: "UI tidak boleh memanggil service langsung. Panggil API (/api/v1)." },
            { group: ["drizzle-orm", "drizzle-orm/*", "postgres"], message: "Akses database hanya di src/server." },
          ],
        },
      ],
    },
  },
  {
    // Komponen vendor dari BoardUI CLI dibiarkan apa adanya agar mudah diperbarui; aturan React Compiler yang ketat dilonggarkan di sini.
    files: ["src/components/base/**", "src/components/application/**", "src/components/foundations/**", "src/hooks/use-count-up.ts", "src/utils/**"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**", ".data/**"]),
]);

export default eslintConfig;
