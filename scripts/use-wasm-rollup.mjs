import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const nativePath = path.join(process.cwd(), "node_modules", "rollup", "dist", "native.js");

try {
  require(nativePath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = message.includes("ERR_DLOPEN_FAILED") || message.includes("bloqueou") || message.includes("Application Control");
  if (!blocked) {
    console.warn(message);
    process.exit(0);
  }
  writeFileSync(nativePath, 'module.exports = require("@rollup/wasm-node/dist/native.js");\n');
  console.log("O Windows bloqueou o Rollup nativo. O build local vai usar a versão WebAssembly.");
}
