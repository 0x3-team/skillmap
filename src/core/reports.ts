import type { DoctorReport, Inventory } from '../schemas/types.js';

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

export function renderDoctorPack(inventory: Inventory, report: DoctorReport): string {
  const duplicateFindings = report.findings.filter((finding) => finding.id.startsWith('duplicate-name'));
  const scriptSkills = inventory.skills.filter((skill) => skill.hasScripts);
  const broad = report.findings.filter((finding) => finding.id.startsWith('broad-trigger'));
  const lines = [
    '# SkillMap Doctor Pack',
    '',
    'Use this pack in a native Codex/Claude chat to create a policy proposal. Propose policy only; do not delete skills.',
    '',
    '## Inventory Summary',
    '',
    `- Skills: ${inventory.skills.length}`,
    `- Roots: ${inventory.roots.length}`,
    `- Doctor findings: ${report.findings.length}`,
    `- Duplicate-name groups: ${duplicateFindings.length}`,
    `- Script-bearing skills: ${scriptSkills.length}`,
    '',
    '## Skill Catalog',
    '',
    '| Skill | Description | Scope | Scripts | Path |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const skill of inventory.skills) {
    lines.push(`| ${escapeCell(skill.name)} | ${escapeCell(skill.description || '(missing)')} | ${skill.scope} | ${skill.hasScripts ? 'yes' : 'no'} | ${escapeCell(skill.path)} |`);
  }
  lines.push('', '## Highest Priority Findings', '');
  for (const finding of report.findings.slice(0, 25)) {
    lines.push(`- ${finding.severity} ${finding.title}: ${finding.recommendation}`);
  }
  lines.push('', '## Policy Proposal Schema', '', 'Return a YAML block like:', '', '```yaml', 'version: 1', 'skills:', '  frontend-design:', '    tier: active-default', '    family: frontend', '    aliases:', '      - UI polish', '    preferred_for:', '      - responsive layout review', '    avoid_for:', '      - backend-only refactors', '    supersedes:', '      - design-an-interface', '    notes: Preferred global UI skill for this setup.', '```', '', '## Curation Questions', '', '- Which skills are canonical defaults for major families?', '- Which skills should be specialist or explicit-only?', '- Which duplicates should be archived in policy rather than deleted?', '- Which descriptions need future rewrite proposals?', '');
  if (broad.length > 0) {
    lines.push('## Broad Trigger Candidates', '');
    for (const finding of broad) lines.push(`- ${finding.title}: ${finding.evidence}`);
    lines.push('');
  }
  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 240);
}
