import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { inferClientHints, inferScope } from './roots.js';
import type { Inventory, SkillRecord } from '../schemas/types.js';

async function listChildren(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const children = await listChildren(root);
  for (const child of children) {
    const candidate = path.join(root, child, 'SKILL.md');
    try {
      await stat(candidate);
      result.push(candidate);
    } catch {
      const nested = path.join(root, child);
      try {
        const st = await stat(nested);
        if (st.isDirectory() && child.includes(':')) {
          for (const grand of await listChildren(nested)) {
            const nestedSkill = path.join(nested, grand, 'SKILL.md');
            try {
              await stat(nestedSkill);
              result.push(nestedSkill);
            } catch {
              // not a skill folder
            }
          }
        }
      } catch {
        // ignored
      }
    }
  }
  return result.sort();
}

async function countDirectory(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).length;
  } catch {
    return 0;
  }
}

async function collectScripts(skillDir: string): Promise<string[]> {
  const scriptsDir = path.join(skillDir, 'scripts');
  try {
    return (await readdir(scriptsDir)).map((item) => path.join(scriptsDir, item)).sort();
  } catch {
    return [];
  }
}

export async function buildInventory(cwd: string, roots: string[], warnings: string[]): Promise<Inventory> {
  const skills: SkillRecord[] = [];
  for (const root of roots) {
    for (const skillPath of await collectSkillFiles(root)) {
      const content = await readFile(skillPath, 'utf8');
      const parsed = parseFrontmatter(content);
      const skillDir = path.dirname(skillPath);
      const fallbackName = path.basename(skillDir);
      const name = String(parsed.data.name ?? fallbackName).trim() || fallbackName;
      const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
      const st = await stat(skillPath);
      const scripts = await collectScripts(skillDir);
      const hash = createHash('sha256').update(content).digest('hex');
      skills.push({
        id: createHash('sha256').update(skillPath).digest('hex').slice(0, 16),
        name,
        description,
        path: skillPath,
        root,
        scope: inferScope(root, cwd),
        clientHints: inferClientHints(root),
        source: 'filesystem',
        frontmatterValid: parsed.valid,
        frontmatterErrors: parsed.errors,
        implicitAllowed: parsed.data['disable-model-invocation'] !== true,
        hasScripts: scripts.length > 0,
        scriptPaths: scripts,
        referenceCount: await countDirectory(path.join(skillDir, 'references')),
        assetCount: await countDirectory(path.join(skillDir, 'assets')),
        bodyBytes: Buffer.byteLength(parsed.body, 'utf8'),
        descriptionBytes: Buffer.byteLength(description, 'utf8'),
        mtime: st.mtime.toISOString(),
        hash
      });
    }
  }
  return { version: 1, generatedAt: new Date().toISOString(), cwd, roots, skills: skills.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

export function summarizeInventory(inventory: Inventory): string {
  const scripts = inventory.skills.filter((skill) => skill.hasScripts).length;
  const invalid = inventory.skills.filter((skill) => !skill.frontmatterValid).length;
  const roots = inventory.roots.length;
  return `SkillMap inventory: ${inventory.skills.length} skills across ${roots} roots; ${scripts} with scripts; ${invalid} invalid frontmatter.`;
}
