import path from 'node:path';
import { access } from 'node:fs/promises';
import { isFixturePath } from '../contracts/fixture-path.js';
import { buildInventory } from '../core/inventory.js';
import { assertQualifiedInventory } from '../core/identity.js';
import { reconcileIdentityMoves } from '../core/identity-migrations.js';
import { resolveRoots } from '../core/roots.js';
import { readJson, writeJson, writeText } from '../core/fs.js';
import { doctorInventory } from '../core/doctor-rules.js';
import { renderDoctorMarkdown } from '../core/reports.js';
import type { DoctorReport, Inventory } from '../schemas/types.js';

export function outDir(cwd: string): string {
  return path.join(cwd, '.skillmap');
}

export async function fileExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function loadOrBuildInventory(cwd: string, roots: string[], fixture?: string): Promise<Inventory> {
  // Explicit roots/fixtures are diagnostic scopes for doctor commands. They
  // must never replace the canonical inventory or clear its identity gates.
  if (roots.length > 0 || fixture) {
    const resolved = await resolveRoots(cwd, roots, fixture);
    return buildInventory(cwd, resolved.roots, resolved.warnings, { persistIdentity: false });
  }
  if (roots.length === 0 && !fixture) {
    const inventoryPath = path.join(outDir(cwd), 'inventory.json');
    if (await fileExists(inventoryPath)) {
      const inventory = await readJson<Inventory>(inventoryPath);
      assertQualifiedInventory(inventory, 'use routing, policy, graph, or doctor consumers');
      return inventory;
    }
  }
  return buildAndPersistInventory(cwd, [], undefined);
}

export async function buildAndPersistInventory(cwd: string, roots: string[], fixture?: string, options: { logicalCwd?: string } = {}): Promise<Inventory> {
  const inventoryPath = path.join(outDir(cwd), 'inventory.json');
  const previous = await fileExists(inventoryPath) ? await readJson<Inventory>(inventoryPath) : undefined;
  const previousIsFixture = previous?.version === 2 && (previous.skills.some((skill) => skill.scope === 'fixture')
    || previous.roots.some(isFixturePath));
  const resolved = await resolveRoots(cwd, roots, fixture);
  const requestedIsFixture = Boolean(fixture)
    || resolved.roots.some(isFixturePath);
  if (requestedIsFixture && previous?.version === 2 && !previousIsFixture) {
    throw new Error('Refusing to replace a canonical real-root inventory with fixture state. Use `skillmap doctor --fixtures PATH` for diagnostic fixture analysis.');
  }
  const inventory = await buildInventory(cwd, resolved.roots, resolved.warnings, options);
  if (resolved.warnings.length) {
    inventory.identityIssues.push({
      code: 'incomplete-root-set',
      message: `Inventory root set is incomplete: ${resolved.warnings.join('; ')}`,
      skillIds: [],
      rootIds: inventory.rootRecords.map((root) => root.rootId),
      relativePaths: []
    });
  }
  const moveIssues = await reconcileIdentityMoves(cwd, previous, inventory);
  inventory.identityIssues.push(...moveIssues);
  inventory.warnings.push(...moveIssues.map((issue) => issue.message));
  await writeJson(inventoryPath, inventory);
  return inventory;
}

export async function loadOrBuildDoctor(cwd: string, inventory: Inventory): Promise<DoctorReport> {
  const report = doctorInventory(inventory);
  await writeJson(path.join(outDir(cwd), 'doctor.json'), report);
  await writeText(path.join(outDir(cwd), 'reports/doctor.md'), renderDoctorMarkdown(report));
  return report;
}
