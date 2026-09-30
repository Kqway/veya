import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/ui/**/*.test.tsx", "tests/integration/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    setupFiles: ["./tests/support/setup.ts"],
    clearMocks: true,
  },
});
