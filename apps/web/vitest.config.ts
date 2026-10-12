import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig uses jsx "preserve" for Next.js; tests need the automatic React runtime.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Pure helpers run in Node; component tests opt into jsdom with a file-level docblock.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
