import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
