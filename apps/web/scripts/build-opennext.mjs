import { spawnSync } from "node:child_process";
import { cp, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(appDir, "../..");

async function kind(path) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

function packagePathWithinRepo(resolvedRepoDir, resolvedAppDir) {
  const packagePath = relative(resolvedRepoDir, resolvedAppDir);
  if (!packagePath || isAbsolute(packagePath) || packagePath === ".." || packagePath.startsWith("../")) {
    throw new Error("OpenNext app path must be a strict descendant of the repository root.");
  }
  return packagePath;
}

export async function normalizeOpenNextStandaloneLayout(options = {}) {
  const resolvedAppDir = resolve(options.appDir ?? appDir);
  const resolvedRepoDir = resolve(options.repoDir ?? repoDir);
  const packagePath = packagePathWithinRepo(resolvedRepoDir, resolvedAppDir);
  const standaloneRoot = join(resolvedAppDir, ".next", "standalone");
  const expectedManifest = join(standaloneRoot, ".next", "server", "pages-manifest.json");

  if (await kind(expectedManifest) === "file") {
    return { state: "already-normalized", packagePath };
  }

  const nestedRoot = join(standaloneRoot, packagePath);
  const entries = [
    { path: ".next", kind: "directory" },
    { path: "node_modules", kind: "directory" },
    { path: "package.json", kind: "file" },
    { path: "server.js", kind: "file" }
  ];

  for (const entry of entries) {
    const source = join(nestedRoot, entry.path);
    const destination = join(standaloneRoot, entry.path);
    if (await kind(source) !== entry.kind) {
      throw new Error(`OpenNext nested standalone entry is missing or unsafe: ${entry.path}`);
    }
    if (await kind(destination) !== "missing") {
      throw new Error(`OpenNext flat standalone destination is unexpectedly occupied: ${entry.path}`);
    }
  }

  const nestedManifest = join(nestedRoot, ".next", "server", "pages-manifest.json");
  if (await kind(nestedManifest) !== "file") {
    throw new Error("OpenNext nested standalone pages manifest is missing or unsafe.");
  }

  for (const entry of entries) {
    await cp(join(nestedRoot, entry.path), join(standaloneRoot, entry.path), {
      recursive: entry.kind === "directory",
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true
    });
  }

  if (await kind(expectedManifest) !== "file") {
    throw new Error("OpenNext standalone normalization did not produce the required pages manifest.");
  }
  return { state: "normalized", packagePath };
}

function runNextBuild() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "build"], {
    cwd: appDir,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Next build terminated by signal ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  runNextBuild();
  const receipt = await normalizeOpenNextStandaloneLayout();
  process.stdout.write(`[skillmap] OpenNext standalone layout ${receipt.state}: ${receipt.packagePath}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await main();
}
