import * as esbuild from "esbuild";
import path from "node:path";

const root = process.cwd();
const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  alias: { "@": path.join(root, "src") },
};

const entries = [
  ["server/assistant.ts", "api-bundle/assistant.js"],
  ["server/categorize.ts", "api-bundle/categorize.js"],
  ["server/admin.ts", "api-bundle/admin.js"],
  ["server/household.ts", "api-bundle/household.js"],
];

for (const [entry, outfile] of entries) {
  await esbuild.build({ ...shared, entryPoints: [entry], outfile });
  console.log("bundled", outfile);
}
