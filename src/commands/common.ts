import path from 'node:path';
import { access } from 'node:fs/promises';
import { buildInventory } from '../core/inventory.js';
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
  if (roots.length === 0 && !fixture) {
    const inventoryPath = path.join(outDir(cwd), 'inventory.json');
    if (await fileExists(inventoryPath)) return readJson<Inventory>(inventoryPath);
  }
  const resolved = await resolveRoots(cwd, roots, fixture);
  const inventory = await buildInventory(cwd, resolved.roots, resolved.warnings);
  await writeJson(path.join(outDir(cwd), 'inventory.json'), inventory);
  return inventory;
}

export async function loadOrBuildDoctor(cwd: string, inventory: Inventory): Promise<DoctorReport> {
  const report = doctorInventory(inventory);
  await writeJson(path.join(outDir(cwd), 'doctor.json'), report);
  await writeText(path.join(outDir(cwd), 'reports/doctor.md'), renderDoctorMarkdown(report));
  return report;
}
