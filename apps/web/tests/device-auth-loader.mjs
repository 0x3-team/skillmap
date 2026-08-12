// ESM loader for focused M3.03 DeviceAuth tests: stubs `server-only` and maps
// `@/` -> apps/web root (+ .ts) so the real route/service/repository import
// graph resolves under plain Node without Next's bundler.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url))); // apps/web/

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: new URL("server-only-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    let p = path.join(appRoot, rel);
    if (!existsSync(p) && existsSync(p + ".ts")) p += ".ts";
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.includes("server-only-stub.mjs")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  return next(url, context);
}
