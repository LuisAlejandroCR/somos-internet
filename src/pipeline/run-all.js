// run-all.js — runs the full pipeline (generate → funnel → experiments →
// derive) in sequence and prints a summary.
import { runGenerate } from "./01-generate.js";
import { runFunnel } from "./02-funnel.js";
import { runExperiments } from "./03-experiments.js";
import { runDerive } from "./04-derive.js";
import { isMain } from "../lib/is-main.js";

export function runAll() {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  SOMOS CRO LAB — pipeline completo                      │");
  console.log("│  ⚠ TODOS LOS DATOS SON SINTÉTICOS                       │");
  console.log("└─────────────────────────────────────────────────────────┘\n");
  runGenerate();
  console.log("");
  runFunnel();
  console.log("");
  runExperiments();
  console.log("");
  const derived = runDerive();
  console.log("\n✓ Listo. Levantar el dashboard con: npm run web");
  return derived;
}

if (isMain(import.meta.url)) {
  runAll();
}
