import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { APP_ENV: "test", PGLITE_DATA_DIR: "memory://", DEMO_MODE: "true", RUN_WORKER_IN_PROCESS: "false", AUTH_SECRET: "test-secret-not-for-production" },
    fileParallelism: false,
  },
});
