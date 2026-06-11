import { builtinModules } from "node:module";
import packageJson from "./package.json" with { type: "json" };

const dependencies = Object.keys(packageJson.dependencies ?? {});
const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default {
  input: "server/index.ts",
  platform: "node",
  external: [...nodeBuiltins, ...dependencies],
  output: {
    file: "dist-server/index.js",
    format: "esm",
    sourcemap: true,
  },
};
