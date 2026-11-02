import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initSync } from "../wasm/pkg/cubes_wasm";

let done = false;

/** Load the WASM engine synchronously in Node-based tests (vitest + jsdom). */
export function initEngineForTests(): void {
  if (done) return;
  initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/pkg/cubes_wasm_bg.wasm")) });
  done = true;
}
