// is-main.js — detects whether a module was run directly vs. imported.
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Lets a pipeline script be both `node src/pipeline/01-generate.js` and
// `import { generate } from "./01-generate.js"` without side effects.
export function isMain(importMetaUrl) {
  if (!argv[1]) return false;
  return resolve(fileURLToPath(importMetaUrl)) === resolve(argv[1]);
}
