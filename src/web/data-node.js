// data-node.js — loads the pipeline's raw/*.json output from disk, cached.
// Node-only: the Cloudflare Function does the equivalent with static JSON
// imports, because Workers have no filesystem at runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "..", "raw");

let cache = null;

export function loadData({ force = false } = {}) {
  if (cache && !force) return cache;
  const read = (name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf-8"));
  try {
    cache = {
      meta: read("meta.json"),
      funnel: read("funnel.json"),
      experiments: read("experiment-results.json"),
      operations: read("operations.json"),
      derived: read("derived.json"),
    };
  } catch (err) {
    throw new Error(
      `No se pudieron leer los datos de raw/. ¿Corriste "npm run run-all"? (causa: ${err.message})`
    );
  }
  return cache;
}
