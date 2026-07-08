export type SkillTier = 'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked';

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  path: string;
  root: string;
  scope: 'user' | 'project' | 'plugin' | 'fixture' | 'unknown';
  clientHints: string[];
  source: 'filesystem';
  frontmatterValid: boolean;
  frontmatterErrors: string[];
  implicitAllowed: boolean;
  hasScripts: boolean;
  scriptPaths: string[];
  referenceCount: number;
  assetCount: number;
  bodyBytes: number;
  descriptionBytes: number;
  mtime: string;
  hash: string;
}

export interface Inventory {
  version: 1;
  generatedAt: string;
  cwd: string;
  roots: string[];
  skills: SkillRecord[];
  warnings: string[];
}

export interface DoctorFinding {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  skills: string[];
  evidence: string;
  recommendation: string;
}

export interface DoctorReport {
  version: 1;
  generatedAt: string;
  inventoryPath?: string;
  summary: {
    skillCount: number;
    duplicateNameCount: number;
    scriptBearingCount: number;
    findingCount: number;
  };
  findings: DoctorFinding[];
}

export interface SkillPolicyEntry {
  tier?: SkillTier;
  family?: string;
  aliases?: string[];
  preferred_for?: string[];
  avoid_for?: string[];
  overlaps?: string[];
  supersedes?: string[];
  notes?: string;
}

export interface Policy {
  version: 1;
  skills: Record<string, SkillPolicyEntry>;
}

export interface EffectiveSkill extends SkillRecord {
  tier: SkillTier;
  family?: string;
  aliases: string[];
  preferredFor: string[];
  avoidFor: string[];
  overlaps: string[];
  supersedes: string[];
  notes?: string;
  routeEligible: boolean;
  effectiveReasons: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  source: 'scan' | 'policy' | 'doctor' | 'source' | 'curation' | 'eval';
  confidence: number;
}

export interface SkillGraph {
  version: 1;
  generatedAt: string;
  mode: 'raw' | 'effective';
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: GraphEdge[];
}

export interface EffectiveRegistry {
  version: 1;
  generatedAt: string;
  inventory: Inventory;
  policy: Policy;
  skills: EffectiveSkill[];
  graph: SkillGraph;
}

export interface RouteCandidate {
  name: string;
  score: number;
  tier: SkillTier;
  family?: string;
  path: string;
  reasons: string[];
}

export interface RouteExclusion {
  name: string;
  reason: string;
}

export interface RouteResult {
  version: 1;
  generatedAt: string;
  prompt: string;
  recommendations: RouteCandidate[];
  exclusions: RouteExclusion[];
  hookText: string;
}
