import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson, writeJson, writeText } from '../core/fs.js';
import { readPolicy } from '../core/policy.js';
import { artifactState, fileExists, skillmapDir, stableJson, type CurationReceipt } from '../core/status.js';
import type { Inventory } from '../schemas/types.js';

export async function curateCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const host = positionals[0];
  if (host !== 'codex') throw new Error('Supported curation host: codex.');
  if (hasFlag(flags, 'prepare')) return prepareCodexCuration(cwd);
  const ingest = flagString(flags, 'ingest');
  if (ingest) return ingestCodexCuration(cwd, ingest, flags);
  throw new Error('Supported curation commands: curate codex --prepare, curate codex --ingest FILE --rationale FILE --model MODEL [--dry-run|--confirm].');
}

async function prepareCodexCuration(cwd: string): Promise<unknown> {
  const dir = path.join(skillmapDir(cwd), 'curation');
  await mkdir(dir, { recursive: true });
  const inventoryPath = path.join(skillmapDir(cwd), 'inventory.json');
  const doctorPath = path.join(skillmapDir(cwd), 'doctor.json');
  const packPath = await fileExists(path.join(skillmapDir(cwd), 'doctor-pack.summary.md')) ? path.join(skillmapDir(cwd), 'doctor-pack.summary.md') : path.join(skillmapDir(cwd), 'doctor-pack.md');
  const inventory = await readJson<Inventory>(inventoryPath);
  const inputs = {
    createdAt: new Date().toISOString(),
    inventory: await artifactState(inventoryPath),
    doctor: await artifactState(doctorPath),
    doctorPack: await artifactState(packPath),
    policy: await artifactState(path.join(skillmapDir(cwd), 'policy.yml'))
  };
  if (!inventory.skills.length) throw new Error('Cannot prepare curation for an empty inventory.');
  const prompt = renderCodexPrompt(inputs, packPath);
  const inputsFile = path.join(dir, 'inputs.json');
  const promptFile = path.join(dir, 'codex-prompt.md');
  await writeJson(inputsFile, inputs);
  await writeText(promptFile, prompt);
  return { inputsFile, promptFile, summary: `Prepared Codex curation packet at ${promptFile}. Paste it into your SOTA Codex chat, then ingest the returned policy with skillmap curate codex --ingest.` };
}

async function ingestCodexCuration(cwd: string, policySource: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const rationaleSource = flagString(flags, 'rationale');
  if (!rationaleSource) throw new Error('curate codex --ingest requires --rationale FILE.');
  const model = flagString(flags, 'model') ?? 'unverified-user-reported';
  const dryRun = hasFlag(flags, 'dry-run');
  const confirm = hasFlag(flags, 'confirm');
  if (!dryRun && !confirm) throw new Error('curate codex --ingest requires --dry-run or --confirm.');
  const resolvedPolicy = path.resolve(cwd, policySource);
  const resolvedRationale = path.resolve(cwd, rationaleSource);
  await readPolicy(resolvedPolicy);
  const rationaleText = await readFile(resolvedRationale, 'utf8');
  if (!rationaleText.trim()) throw new Error('Rationale file is empty.');
  const dir = skillmapDir(cwd);
  const policyTarget = path.join(dir, 'policy.yml');
  const rationaleTarget = path.join(dir, 'policy-rationale.md');
  const receiptTarget = path.join(dir, 'curation/receipt.json');
  const receipt: CurationReceipt = {
    version: 1,
    host: 'codex',
    model,
    modelVerification: model === 'unverified-user-reported' ? 'unverified-user-reported' : 'user-reported',
    mode: 'manual-native-agent',
    createdAt: new Date().toISOString(),
    inputs: {
      inventory: await artifactState(path.join(dir, 'inventory.json')),
      doctor: await artifactState(path.join(dir, 'doctor.json')),
      doctorPack: await artifactState(path.join(dir, 'doctor-pack.summary.md'))
    },
    outputs: {
      policy: await artifactState(resolvedPolicy),
      rationale: await artifactState(resolvedRationale)
    },
    warnings: ['Model identity is user-reported; SkillMap did not verify provider-side model identity.']
  };
  if (!dryRun) {
    await writeText(policyTarget, await readFile(resolvedPolicy, 'utf8'));
    await writeText(rationaleTarget, rationaleText);
    await writeJson(receiptTarget, receipt);
  }
  return { dryRun, policyTarget, rationaleTarget, receiptTarget, receipt, summary: `${dryRun ? 'Would ingest' : 'Ingested'} Codex curation receipt for model ${model}.` };
}

function renderCodexPrompt(inputs: unknown, packPath: string): string {
  return `# SkillMap Codex Curation Request\n\nUse the SkillMap doctor pack at \`${packPath}\` to produce a reviewed policy for the current inventory.\n\nReturn two files:\n\n1. \`.skillmap/proposals/policy.yml\` using SkillMap policy schema.\n2. \`.skillmap/proposals/policy-rationale.md\` explaining duplicate resolution, risky scripts, canonical defaults, explicit-only choices, and uncertain calls.\n\nRules:\n\n- Do not delete or mutate source skills.\n- Be conservative with script-bearing, security, reverse-engineering, account, deployment, and destructive-operation skills.\n- Prefer one canonical default per family and demote redundant broad helpers.\n- Preserve useful specialists.\n- Call out assumptions.\n\nInput artifact receipt:\n\n\`\`\`json\n${stableJson(inputs)}\n\`\`\`\n\nPolicy output must start with:\n\n\`\`\`yaml\nversion: 1\nskills:\n\`\`\`\n`;
}
