import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const integration = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
    exclude: integration ? [] : ["src/**/*.int.test.ts", "node_modules/**"],
    testTimeout: 20_000,
  },
});
