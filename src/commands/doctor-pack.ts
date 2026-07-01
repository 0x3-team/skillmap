import path from 'node:path';
import { flagString, flagStrings } from '../core/args.js';
import { writeText } from '../core/fs.js';
import { renderDoctorPack } from '../core/reports.js';
import { loadOrBuildDoctor, loadOrBuildInventory, outDir } from './common.js';

export async function doctorPackCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'));
  const report = await loadOrBuildDoctor(cwd, inventory);
  const markdown = renderDoctorPack(inventory, report);
  const file = path.join(outDir(cwd), 'doctor-pack.md');
  await writeText(file, markdown);
  return { file, markdown };
}
