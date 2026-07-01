import type { DoctorFinding, DoctorReport, Inventory, SkillRecord } from '../schemas/types.js';

export interface DoctorPackOptions {
  summaryOnly?: boolean;
  maxSkills?: number;
}

export function renderDoctorMarkdown(report: DoctorReport): string {
  const lines = [
    '# SkillMap Doctor Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Skills: ${report.summary.skillCount}`,
    `- Duplicate names: ${report.summary.duplicateNameCount}`,
    `- Script-bearing skills: ${report.summary.scriptBearingCount}`,
    `- Findings: ${report.summary.findingCount}`,
    '',
    '## Findings',
    ''
  ];
  if (report.findings.length === 0) lines.push('No findings.');
  for (const finding of report.findings) {
    lines.push(`### ${finding.severity} ${finding.title}`, '', `- Evidence: ${finding.evidence}`, `- Recommendation: ${finding.recommendation}`, '- Skills:');
    for (const skill of finding.skills) lines.push(`  - ${skill}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderDoctorPack(inventory: Inventory, report: DoctorReport, options: DoctorPackOptions = {}): string {
  const duplicateFindings = report.findings.filter((finding) => finding.id.startsWith('duplicate-name'));
  const scriptSkills = inventory.skills.filter((skill) => skill.hasScripts);
  const broad = report.findings.filter((finding) => finding.id.startsWith('broad-trigger'));
  const invalid = inventory.skills.filter((skill) => !skill.frontmatterValid);
  const maxSkills = Math.max(0, options.maxSkills ?? 120);
  const catalogSkills = options.summaryOnly ? [] : inventory.skills.slice(0, maxSkills);
  const omitted = Math.max(0, inventory.skills.length - catalogSkills.length);
  const estimatedFullCatalogBytes = estimateCatalogBytes(inventory.skills);
  const lines = [
    '# SkillMap Doctor Pack',
    '',
    'Use this pack in a native Codex/Claude chat to create a reviewed policy proposal. Propose policy only; do not delete or mutate source skills.',
    '',
    '## Recommended Native-Agent Prompt',
    '',
    '```text',
    'You are curating my local agent-skill registry. Read this SkillMap doctor pack and return only:',
    '1. .skillmap/policy.yml using tiers active-default, specialist, explicit-only, archived, or blocked.',
    '2. .skillmap/policy-rationale.md explaining duplicate resolution, risky script-bearing skills, canonical defaults, and uncertain choices.',
    'Be conservative: do not mark risky script-bearing or security/reverse skills active-default unless clearly justified. Do not tell me to delete skills.',
    '```',
    '',
    '## Inventory Summary',
    '',
    `- Skills: ${inventory.skills.length}`,
    `- Roots: ${inventory.roots.length}`,
    `- Doctor findings: ${report.findings.length}`,
    `- Duplicate-name groups: ${duplicateFindings.length}`,
    `- Script-bearing skills: ${scriptSkills.length}`,
    `- Invalid frontmatter: ${invalid.length}`,
    `- Catalog mode: ${options.summaryOnly ? 'summary-only' : `first ${catalogSkills.length} skills${omitted ? `, ${omitted} omitted` : ''}`}`,
    ''
  ];

  if (estimatedFullCatalogBytes > 40000 && !options.summaryOnly) {
    lines.push('## Pack Size Warning', '', `The full skill catalog is estimated at about ${estimatedFullCatalogBytes} bytes before findings and prompts. If this is too large for one chat turn, rerun with \`skillmap doctor-pack --summary\` or \`--max-skills 80\`.`, '');
  }

  lines.push('## Curation Priorities', '');
  lines.push('- Resolve duplicate names first; prefer one canonical default and demote/archive lower-priority copies in policy.');
  lines.push('- Keep risky script-bearing, reverse-engineering, security, account, and deployment skills conservative unless the user explicitly names them.');
  lines.push('- Prefer narrow specialist routing over broad helper skills.');
  lines.push('- Preserve client-specific skills when they are materially different, but avoid letting duplicates compete for the same prompt.');
  lines.push('');

  lines.push('## Duplicate Name Groups', '');
  appendFindings(lines, duplicateFindings, 30);

  lines.push('## Script-Bearing Skills', '');
  if (scriptSkills.length === 0) lines.push('No script-bearing skills detected.', '');
  for (const skill of scriptSkills.slice(0, 40)) {
    lines.push(`- ${skill.name} (${skill.scope}): ${skill.scriptPaths.length} script(s)`);
    lines.push(`  - Path: ${skill.path}`);
  }
  if (scriptSkills.length > 40) lines.push(`- Omitted ${scriptSkills.length - 40} additional script-bearing skills.`);
  lines.push('');

  lines.push('## Highest Priority Findings', '');
  appendFindings(lines, report.findings, 30);

  if (!options.summaryOnly) {
    lines.push('## Skill Catalog', '', '| Skill | Description | Scope | Scripts | Path |', '| --- | --- | --- | --- | --- |');
    for (const skill of catalogSkills) {
      lines.push(`| ${escapeCell(skill.name)} | ${escapeCell(skill.description || '(missing)')} | ${skill.scope} | ${skill.hasScripts ? 'yes' : 'no'} | ${escapeCell(skill.path)} |`);
    }
    if (omitted) lines.push(`| ... | ${omitted} additional skills omitted. Rerun with --max-skills ${inventory.skills.length} for the full catalog. | | | |`);
    lines.push('');
  }

  lines.push('## Policy Proposal Skeleton', '', 'Return a YAML block like:', '', '```yaml', 'version: 1', 'skills:', '  frontend-design:', '    tier: active-default', '    family: frontend', '    aliases:', '      - UI polish', '    preferred_for:', '      - responsive layout review', '    avoid_for:', '      - backend-only refactors', '    supersedes:', '      - design-an-interface', '    notes: Preferred global UI skill for this setup.', '```', '');

  lines.push('## Curation Questions', '', '- Which skills are canonical defaults for major families?', '- Which skills should be specialist or explicit-only?', '- Which duplicates should be archived in policy rather than deleted?', '- Which descriptions need future rewrite proposals?', '- Which risky skills should remain explicit-only?', '');
  if (broad.length > 0) {
    lines.push('## Broad Trigger Candidates', '');
    for (const finding of broad.slice(0, 30)) lines.push(`- ${finding.title}: ${finding.evidence}`);
    if (broad.length > 30) lines.push(`- Omitted ${broad.length - 30} additional broad-trigger findings.`);
    lines.push('');
  }
  return lines.join('\n');
}

function appendFindings(lines: string[], findings: DoctorFinding[], limit: number): void {
  if (findings.length === 0) {
    lines.push('No findings in this section.', '');
    return;
  }
  for (const finding of findings.slice(0, limit)) {
    lines.push(`- ${finding.severity} ${finding.title}: ${finding.recommendation}`);
    lines.push(`  - Evidence: ${finding.evidence}`);
  }
  if (findings.length > limit) lines.push(`- Omitted ${findings.length - limit} additional findings in this section.`);
  lines.push('');
}

function estimateCatalogBytes(skills: SkillRecord[]): number {
  return skills.reduce((total, skill) => total + skill.name.length + skill.description.length + skill.path.length + 16, 0);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 240);
}
