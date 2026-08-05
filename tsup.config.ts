import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  target: "node18",
  sourcemap: true,
  // Zero runtime dependencies: nothing to bundle from node_modules.
  // Native `fetch` + `node:crypto` only. See plan §1 / §13.
});
