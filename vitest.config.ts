import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@vi/contracts", replacement: path.resolve(__dirname, "packages/contracts/src") },
      { find: "@vi/domain", replacement: path.resolve(__dirname, "packages/domain/src") },
      { find: "@vi/application", replacement: path.resolve(__dirname, "packages/application/src") },
      { find: "@vi/db", replacement: path.resolve(__dirname, "packages/db/src") },
      { find: "@vi/providers", replacement: path.resolve(__dirname, "packages/providers/src") },
      { find: "@vi/observability", replacement: path.resolve(__dirname, "packages/observability/src") },
      { find: "@vi/config", replacement: path.resolve(__dirname, "packages/config/src") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    clearMocks: true,
    restoreMocks: true,
  },
});
