import path from 'node:path';
import { flagString, flagStrings, hasFlag } from '../core/args.js';
import { writeText } from '../core/fs.js';
import { renderDoctorMarkdown } from '../core/reports.js';
import type { DoctorReport } from '../schemas/types.js';
import { loadOrBuildDoctor, loadOrBuildInventory, outDir } from './common.js';

export async function doctorCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'));
  const report = await loadOrBuildDoctor(cwd, inventory);
  const markdown = renderDoctorMarkdown(report);
  if (!hasFlag(flags, 'fix-plan')) return { report, markdown };
  const fixPlan = renderFixPlan(report);
  const fixPlanPath = path.join(outDir(cwd), 'reports/fix-plan.md');
  await writeText(fixPlanPath, fixPlan);
  return { report, markdown, fixPlan, fixPlanPath, summary: `SkillMap doctor fix-plan written to ${fixPlanPath}.` };
}

function renderFixPlan(report: DoctorReport): string {
  const lines = [
    '# SkillMap Doctor Fix Plan',
    '',
    `Generated: ${report.generatedAt}`,
    `Findings: ${report.findings.length}`,
    '',
    'This is a review-only plan. It does not mutate skills.',
    '',
    '## Recommended command sequence',
    '',
    '1. Review this fix plan and the full doctor report.',
    '2. Run `skillmap doctor-pack --summary` for native-agent curation context.',
    '3. Update `.skillmap/proposals/policy.yml` or copied skill files only after review.',
    '4. Run `skillmap apply-policy --strict` after policy changes.',
    '5. Run `skillmap graph build` and `skillmap eval --save-report` after route-affecting changes.',
    ''
  ];
  for (const severity of ['P0', 'P1', 'P2', 'P3'] as const) {
    const findings = report.findings.filter((finding) => finding.severity === severity);
    if (!findings.length) continue;
    lines.push(`## ${severity}`, '');
    for (const finding of findings) {
      lines.push(`### ${finding.title}`, '');
      lines.push(`- Finding id: \`${finding.id}\``);
      lines.push(`- Skills: ${finding.skills.map((skill) => `\`${skill}\``).join(', ') || 'none'}`);
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Recommended action: ${finding.recommendation}`);
      lines.push('');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}
