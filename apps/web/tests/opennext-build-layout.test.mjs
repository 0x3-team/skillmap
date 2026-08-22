import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeOpenNextStandaloneLayout } from "../scripts/build-opennext.mjs";

test("OpenNext build adapter flattens the exact nested standalone package once", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillmap-opennext-layout-"));
  try {
    const repoDir = join(temp, "repo");
    const appDir = join(repoDir, "apps", "web");
    const nestedRoot = join(appDir, ".next", "standalone", "apps", "web");
    await mkdir(join(nestedRoot, ".next", "server"), { recursive: true });
    await mkdir(join(nestedRoot, "node_modules", "next"), { recursive: true });
    await writeFile(join(nestedRoot, ".next", "server", "pages-manifest.json"), "{}\n", "utf8");
    await writeFile(join(nestedRoot, "node_modules", "next", "package.json"), "{}\n", "utf8");
    await writeFile(join(nestedRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(nestedRoot, "server.js"), "export {};\n", "utf8");

    assert.deepEqual(await normalizeOpenNextStandaloneLayout({ appDir, repoDir }), {
      state: "normalized",
      packagePath: "apps/web"
    });
    assert.equal(
      await readFile(join(appDir, ".next", "standalone", ".next", "server", "pages-manifest.json"), "utf8"),
      "{}\n"
    );
    assert.equal(
      await readFile(join(appDir, ".next", "standalone", "node_modules", "next", "package.json"), "utf8"),
      "{}\n"
    );
    assert.deepEqual(await normalizeOpenNextStandaloneLayout({ appDir, repoDir }), {
      state: "already-normalized",
      packagePath: "apps/web"
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("OpenNext build adapter fails closed on a partial flat layout", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillmap-opennext-partial-"));
  try {
    const repoDir = join(temp, "repo");
    const appDir = join(repoDir, "apps", "web");
    const standaloneRoot = join(appDir, ".next", "standalone");
    const nestedRoot = join(standaloneRoot, "apps", "web");
    await mkdir(join(standaloneRoot, ".next"), { recursive: true });
    await mkdir(join(nestedRoot, ".next", "server"), { recursive: true });
    await mkdir(join(nestedRoot, "node_modules"), { recursive: true });
    await writeFile(join(nestedRoot, ".next", "server", "pages-manifest.json"), "{}\n", "utf8");
    await writeFile(join(nestedRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(nestedRoot, "server.js"), "export {};\n", "utf8");

    await assert.rejects(
      normalizeOpenNextStandaloneLayout({ appDir, repoDir }),
      /flat standalone destination is unexpectedly occupied: \.next/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("OpenNext build adapter rejects an incomplete already-normalized layout", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillmap-opennext-incomplete-flat-"));
  try {
    const repoDir = join(temp, "repo");
    const appDir = join(repoDir, "apps", "web");
    const standaloneRoot = join(appDir, ".next", "standalone");
    await mkdir(join(standaloneRoot, ".next", "server"), { recursive: true });
    await mkdir(join(standaloneRoot, "node_modules"), { recursive: true });
    await writeFile(join(standaloneRoot, ".next", "server", "pages-manifest.json"), "{}\n", "utf8");
    await writeFile(join(standaloneRoot, "package.json"), "{}\n", "utf8");

    await assert.rejects(
      normalizeOpenNextStandaloneLayout({ appDir, repoDir }),
      /already-normalized standalone entry is missing or unsafe: server\.js/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("OpenNext build adapter rejects an app outside the repository root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillmap-opennext-scope-"));
  try {
    await assert.rejects(
      normalizeOpenNextStandaloneLayout({ appDir: join(temp, "app"), repoDir: join(temp, "repo") }),
      /strict descendant/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
