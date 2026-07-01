import path from 'node:path';
import { flagString, flagStrings, hasFlag } from '../core/args.js';
import { writeText } from '../core/fs.js';
import { renderDoctorPack } from '../core/reports.js';
import { loadOrBuildDoctor, loadOrBuildInventory, outDir } from './common.js';

export async function doctorPackCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'));
  const report = await loadOrBuildDoctor(cwd, inventory);
  const maxSkills = Number(flagString(flags, 'max-skills') ?? '120');
  if (!Number.isFinite(maxSkills) || maxSkills < 0) throw new Error('--max-skills must be a non-negative number.');
  const markdown = renderDoctorPack(inventory, report, { summaryOnly: hasFlag(flags, 'summary'), maxSkills });
  const file = path.join(outDir(cwd), hasFlag(flags, 'summary') ? 'doctor-pack.summary.md' : 'doctor-pack.md');
  await writeText(file, markdown);
  return { file, bytes: Buffer.byteLength(markdown, 'utf8'), summaryOnly: hasFlag(flags, 'summary'), maxSkills, markdown };
}
