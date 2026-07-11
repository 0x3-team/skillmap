export interface SkillFilesystemLimits {
  maxRoots: number;
  maxDiscoveryDirectories: number;
  maxDiscoveryEntries: number;
  maxSkills: number;
  maxTreeDepth: number;
  maxTreeDirectories: number;
  maxTreeEntries: number;
  maxTreeFiles: number;
  maxFileBytes: number;
  maxSkillMarkdownBytes: number;
  maxTreeBytes: number;
  maxWorkspaceBytes: number;
}

/**
 * One canonical policy is used by scan and filesystem freshness. A tree that
 * cannot be re-verified under these defaults must never be published by scan.
 */
export const DEFAULT_SKILL_FILESYSTEM_LIMITS: Readonly<SkillFilesystemLimits> = Object.freeze({
  maxRoots: 1_000,
  maxDiscoveryDirectories: 20_000,
  maxDiscoveryEntries: 100_000,
  maxSkills: 10_000,
  maxTreeDepth: 32,
  maxTreeDirectories: 1_024,
  maxTreeEntries: 4_096,
  maxTreeFiles: 2_048,
  maxFileBytes: 16 * 1024 * 1024,
  maxSkillMarkdownBytes: 1024 * 1024,
  maxTreeBytes: 64 * 1024 * 1024,
  maxWorkspaceBytes: 256 * 1024 * 1024
});

export class SkillFilesystemLimitError extends Error {
  readonly code = 'SKILL_FILESYSTEM_LIMIT_EXCEEDED';

  constructor(readonly limit: keyof SkillFilesystemLimits) {
    super(`Skill filesystem exceeds the canonical ${limit} limit.`);
    this.name = 'SkillFilesystemLimitError';
  }
}

export interface SkillWorkspaceByteBudget {
  totalBytes: number;
  readonly maxBytes: number;
  totalDirectories: number;
  readonly maxDirectories: number;
  totalEntries: number;
  readonly maxEntries: number;
}

export function createSkillWorkspaceByteBudget(
  maxBytes = DEFAULT_SKILL_FILESYSTEM_LIMITS.maxWorkspaceBytes,
  limits: Pick<SkillFilesystemLimits, 'maxDiscoveryDirectories' | 'maxDiscoveryEntries'> = DEFAULT_SKILL_FILESYSTEM_LIMITS
): SkillWorkspaceByteBudget {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Workspace byte budget must be a positive safe integer.');
  return {
    totalBytes: 0,
    maxBytes,
    totalDirectories: 0,
    maxDirectories: limits.maxDiscoveryDirectories,
    totalEntries: 0,
    maxEntries: limits.maxDiscoveryEntries
  };
}

export function resolveSkillFilesystemLimits(overrides: Partial<SkillFilesystemLimits> = {}): SkillFilesystemLimits {
  const limits = { ...DEFAULT_SKILL_FILESYSTEM_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive safe integer.`);
  }
  if (limits.maxSkillMarkdownBytes > limits.maxFileBytes) throw new Error('maxSkillMarkdownBytes cannot exceed maxFileBytes.');
  if (limits.maxFileBytes > limits.maxTreeBytes) throw new Error('maxFileBytes cannot exceed maxTreeBytes.');
  if (limits.maxTreeBytes > limits.maxWorkspaceBytes) throw new Error('maxTreeBytes cannot exceed maxWorkspaceBytes.');
  return limits;
}
