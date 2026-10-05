import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/db/cli.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // The shared package ships as TypeScript source, so inline it. Everything else stays external.
  noExternal: ["@project-name/shared"],
});
