import { readJson } from '../core/fs.js';
import type { Inventory } from '../schemas/types.js';
import { approvedArtifactPath, openApprovedWorkspaceRead } from '../services/workspace-read-model.js';

export async function listCommand(cwd: string): Promise<unknown> {
  const approved = await openApprovedWorkspaceRead(cwd, 'status');
  const inventory = await readJson<Inventory>(approvedArtifactPath(approved, 'inventory.json'));
  return {
    skills: inventory.skills.map((skill) => ({ skillId: skill.skillId, contentRevision: skill.contentRevision, name: skill.name, description: skill.description, scope: skill.scope, path: skill.path })),
    revision: approved.servingRevision
  };
}
