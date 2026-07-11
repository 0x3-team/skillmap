import path from 'node:path';
import { flagStrings, hasFlag } from '../core/args.js';
import { DEFAULT_PROFILE, configPath, ensureWorkspaceIdentity, workspaceIdentityPath, writeSkillMapConfig } from '../core/config.js';
import { writeText } from '../core/fs.js';
import { renderPolicy, EMPTY_POLICY } from '../core/policy.js';
import { outDir } from './common.js';

export async function initCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const dir = outDir(cwd);
  const roots = flagStrings(flags, 'root');
  const files = [configPath(cwd), workspaceIdentityPath(cwd), path.join(dir, 'policy.yml'), path.join(dir, 'real-evals.json')];
  let identity: Awaited<ReturnType<typeof ensureWorkspaceIdentity>> | undefined;
  if (!hasFlag(flags, 'dry-run')) {
    identity = await ensureWorkspaceIdentity(cwd, roots);
    await writeSkillMapConfig(cwd, { version: 1, profile: DEFAULT_PROFILE, roots });
    await writeText(files[2], renderPolicy(EMPTY_POLICY));
    await writeText(files[3], '{\n  "evals": []\n}\n');
  }
  return {
    initialized: !hasFlag(flags, 'dry-run'),
    profile: DEFAULT_PROFILE,
    roots,
    workspaceId: identity?.registry.workspaceId,
    rootRecords: identity?.approvedRoots,
    files,
    summary: `${hasFlag(flags, 'dry-run') ? 'Would initialize' : 'Initialized'} SkillMap ${DEFAULT_PROFILE}${roots.length ? ` with ${roots.length} configured root(s).` : '; no roots configured yet.'}`
  };
}
