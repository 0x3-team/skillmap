import type { DoctorFinding, DoctorReport, Inventory, SkillRecord } from '../schemas/types.js';

const BROAD_WORDS = ['anything', 'everything', 'all tasks', 'general', 'any coding', 'all coding', 'helps with coding', 'useful for all'];

export function doctorInventory(inventory: Inventory): DoctorReport {
  const findings: DoctorFinding[] = [];
  const byName = groupBy(inventory.skills, (skill) => skill.name);
  for (const [name, skills] of byName.entries()) {
    if (skills.length > 1) {
      findings.push({
        id: `duplicate-name:${name}`,
        severity: 'P1',
        title: `Duplicate skill name: ${name}`,
        skills: skills.map((skill) => skill.path),
        evidence: `${skills.length} skills share the same name across roots: ${skills.map((skill) => skill.root).join(', ')}`,
        recommendation: 'Pick a canonical source in policy; mark lower-priority copies specialist, archived, or explicit-only.'
      });
    }
  }

  for (const skill of inventory.skills) {
    if (!skill.frontmatterValid) {
      findings.push({
        id: `invalid-frontmatter:${skill.id}`,
        severity: 'P1',
        title: `Invalid frontmatter: ${skill.name}`,
        skills: [skill.path],
        evidence: skill.frontmatterErrors.join('; '),
        recommendation: 'Fix SKILL.md frontmatter before relying on model invocation.'
      });
    }
    if (!skill.description) {
      findings.push({
        id: `missing-description:${skill.id}`,
        severity: 'P1',
        title: `Missing description: ${skill.name}`,
        skills: [skill.path],
        evidence: 'No description is available for model routing.',
        recommendation: 'Add a concise trigger-focused description or make the skill explicit-only.'
      });
    }
    if (skill.hasScripts) {
      findings.push({
        id: `script-bearing:${skill.id}`,
        severity: 'P2',
        title: `Skill has executable scripts: ${skill.name}`,
        skills: [skill.path, ...skill.scriptPaths],
        evidence: `${skill.scriptPaths.length} script file(s) found.`,
        recommendation: 'Review script inputs, side effects, and dependency assumptions before allowing broad use.'
      });
    }
    if (skill.bodyBytes > 12000) {
      findings.push({
        id: `large-body:${skill.id}`,
        severity: 'P3',
        title: `Large skill body: ${skill.name}`,
        skills: [skill.path],
        evidence: `${skill.bodyBytes} bytes in SKILL.md body.`,
        recommendation: 'Move branch-specific reference material behind explicit reference files.'
      });
    }
    if (skill.descriptionBytes > 650) {
      findings.push({
        id: `long-description:${skill.id}`,
        severity: 'P2',
        title: `Long description: ${skill.name}`,
        skills: [skill.path],
        evidence: `${skill.descriptionBytes} bytes in description.`,
        recommendation: 'Shorten description to distinct trigger branches so it survives catalog truncation.'
      });
    }
    const lower = skill.description.toLowerCase();
    if (BROAD_WORDS.some((word) => lower.includes(word))) {
      findings.push({
        id: `broad-trigger:${skill.id}`,
        severity: 'P2',
        title: `Broad trigger language: ${skill.name}`,
        skills: [skill.path],
        evidence: `Description contains broad routing language: "${skill.description}"`,
        recommendation: 'Replace broad language with concrete task intents and near-miss exclusions.'
      });
    }
  }

  const byDescription = groupBy(
    inventory.skills.filter((skill) => skill.description),
    (skill) => normalize(skill.description)
  );
  for (const [description, skills] of byDescription.entries()) {
    if (skills.length > 1 && description) {
      findings.push({
        id: `duplicate-description:${description.slice(0, 32)}`,
        severity: 'P2',
        title: 'Duplicate or near-identical descriptions',
        skills: skills.map((skill) => skill.path),
        evidence: `${skills.map((skill) => skill.name).join(', ')} share effectively the same description.`,
        recommendation: 'Differentiate trigger language or make lower-priority variants explicit-only.'
      });
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      skillCount: inventory.skills.length,
      duplicateNameCount: [...byName.values()].filter((skills) => skills.length > 1).length,
      scriptBearingCount: inventory.skills.filter((skill) => skill.hasScripts).length,
      findingCount: findings.length
    },
    findings: findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title))
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function severityRank(severity: DoctorFinding['severity']): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity];
}
