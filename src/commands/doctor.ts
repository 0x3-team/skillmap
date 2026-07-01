import { flagString, flagStrings } from '../core/args.js';
import { renderDoctorMarkdown } from '../core/reports.js';
import { loadOrBuildDoctor, loadOrBuildInventory } from './common.js';

export async function doctorCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'));
  const report = await loadOrBuildDoctor(cwd, inventory);
  return { report, markdown: renderDoctorMarkdown(report) };
}
