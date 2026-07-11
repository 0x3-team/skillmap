import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isFixturePath } from '../contracts/fixture-path.js';
import { readSkillMapConfig } from './config.js';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRoots(cwd: string, explicitRoots: string[], fixture?: string): Promise<{ roots: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const roots = new Set<string>();
  const add = async (candidate: string) => {
    const full = path.resolve(cwd, candidate.replace(/^~(?=$|\/)/, os.homedir()));
    if (await exists(full)) roots.add(full);
    else warnings.push(`Root not found: ${full}`);
  };

  if (fixture) {
    await add(fixture);
    return { roots: [...roots], warnings };
  }

  const configured = explicitRoots.length === 0 ? await readSkillMapConfig(cwd) : undefined;
  const rootsToUse = explicitRoots.length > 0 ? explicitRoots : configured?.roots;
  if (rootsToUse) {
    for (const root of rootsToUse) await add(root);
    if (rootsToUse.length === 0) warnings.push('No roots configured in .skillmap/config.yml. Run `skillmap init --root PATH` or pass --root to scan.');
  } else {
    await add(path.join(os.homedir(), '.agents/skills'));
    await add(path.join(os.homedir(), '.codex/skills'));
    await add(path.join(os.homedir(), '.claude/skills'));
    await add(path.join(cwd, '.agents/skills'));
    await add(path.join(cwd, '.codex/skills'));
    await add(path.join(cwd, '.claude/skills'));
  }
  return { roots: [...roots], warnings };
}

export function inferScope(root: string, cwd: string): 'user' | 'project' | 'plugin' | 'fixture' | 'unknown' {
  if (isFixturePath(root)) return 'fixture';
  const portableRoot = root.split(path.sep).join('/');
  if (portableRoot.includes('/.codex/plugins/')) return 'plugin';
  if (isContainedPath(cwd, root)) return 'project';
  if (portableRoot.includes('/.agents/') || portableRoot.includes('/.codex/') || portableRoot.includes('/.claude/')) return 'user';
  return 'unknown';
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function inferClientHints(root: string): string[] {
  const hints = new Set<string>();
  if (root.includes('.agents')) hints.add('shared');
  if (root.includes('.codex')) hints.add('codex');
  if (root.includes('.claude')) hints.add('claude');
  if (isFixturePath(root)) hints.add('fixture');
  return [...hints];
}
