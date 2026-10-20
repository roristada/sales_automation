import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      // Needs a running local Supabase (`npm run db:start`); see docs/SETUP.md.
      { resolve: { alias }, test: { name: "rls", include: ["tests/rls/**/*.test.ts"], environment: "node", testTimeout: 30_000 } },
    ],
  },
});
