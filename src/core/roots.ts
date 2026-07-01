import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

  for (const root of explicitRoots) await add(root);
  if (explicitRoots.length === 0) {
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
  if (root.includes('/test/fixtures/')) return 'fixture';
  if (root.includes('/.codex/plugins/')) return 'plugin';
  if (root.startsWith(cwd)) return 'project';
  if (root.includes('/.agents/') || root.includes('/.codex/') || root.includes('/.claude/')) return 'user';
  return 'unknown';
}

export function inferClientHints(root: string): string[] {
  const hints = new Set<string>();
  if (root.includes('.agents')) hints.add('shared');
  if (root.includes('.codex')) hints.add('codex');
  if (root.includes('.claude')) hints.add('claude');
  if (root.includes('/test/fixtures/')) hints.add('fixture');
  return [...hints];
}
