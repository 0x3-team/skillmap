import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { hashText, readJson, writeJson, writeText } from '../core/fs.js';
import { readPolicy } from '../core/policy.js';
import { artifactState, fileExists, skillmapDir, type ArtifactState, type CurationReceipt } from '../core/status.js';
import type { Inventory } from '../schemas/types.js';

interface CurationInputs {
  version: 1;
  createdAt: string;
  host: 'codex';
  mode: 'manual-native-agent';
  artifacts: Record<string, ArtifactState>;
  warnings: string[];
}

export async function curateCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const host = positionals[0];
  if (host !== 'codex') throw new Error('Supported curation host: codex.');
  if (hasFlag(flags, 'prepare')) return prepareCodexCuration(cwd);
  const ingest = flagString(flags, 'ingest');
  if (ingest) return ingestCodexCuration(cwd, ingest, flags);
  throw new Error('Supported curate commands: curate codex --prepare, curate codex --ingest FILE --rationale FILE --model MODEL --confirm.');
}

async function prepareCodexCuration(cwd: string): Promise<unknown> {
  const dir = skillmapDir(cwd);
  const curationDir = path.join(dir, 'curation');
  await mkdir(curationDir, { recursive: true });
  const inputs = await buildInputs(cwd);
  const inputsFile = path.join(curationDir, 'inputs.json');
  const promptFile = path.join(curationDir, 'codex-prompt.md');
  await writeJson(inputsFile, inputs);
  await writeText(promptFile, renderCodexPrompt(inputs));
  return {
    host: 'codex',
    action: 'prepare',
    promptFile,
    inputsFile,
    warnings: inputs.warnings,
    summary: `Prepared Codex curation packet at ${promptFile}. Paste it into your SOTA Codex chat, then ingest the returned policy with skillmap curate codex --ingest.`
  };
}

async function ingestCodexCuration(cwd: string, policySource: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const rationaleSource = flagString(flags, 'rationale');
  if (!rationaleSource) throw new Error('curate codex --ingest requires --rationale FILE.');
  const dryRun = hasFlag(flags, 'dry-run');
  const confirmed = hasFlag(flags, 'confirm');
  if (!dryRun && !confirmed) throw new Error('curate codex --ingest writes policy files only with --confirm. Use --dry-run to preview.');
  const dir = skillmapDir(cwd);
  const policyText = await readFile(path.resolve(cwd, policySource), 'utf8');
  const rationaleText = await readFile(path.resolve(cwd, rationaleSource), 'utf8');
  await readPolicy(path.resolve(cwd, policySource));
  const inputs = await loadOrBuildInputs(cwd);
  const policyFile = path.join(dir, 'policy.yml');
  const rationaleFile = path.join(dir, 'policy-rationale.md');
  const receiptFile = path.join(dir, 'curation', 'receipt.json');
  const model = flagString(flags, 'model') ?? 'unverified-user-reported';
  const receipt: CurationReceipt = {
    version: 1,
    createdAt: new Date().toISOString(),
    agent: {
      host: 'codex',
      model,
      modelVerification: flagString(flags, 'model') ? 'user-reported' : 'unverified-user-reported',
      mode: 'manual-native-agent'
    },
    inputs: inputs.artifacts,
    outputs: {
      policy: { path: policyFile, exists: true, bytes: Buffer.byteLength(policyText, 'utf8'), sha256: hashText(policyText) },
      rationale: { path: rationaleFile, exists: true, bytes: Buffer.byteLength(rationaleText, 'utf8'), sha256: hashText(rationaleText) }
    },
    warnings: ['Model identity is user-reported; SkillMap did not verify the provider model.']
  };
  if (!dryRun) {
    await writeText(policyFile, policyText);
    await writeText(rationaleFile, rationaleText);
    await writeJson(receiptFile, receipt);
  }
  return {
    host: 'codex',
    action: 'ingest',
    dryRun,
    confirmed,
    policyFile,
    rationaleFile,
    receiptFile,
    receipt,
    summary: `${dryRun ? 'Would ingest' : 'Ingested'} Codex curation outputs into ${policyFile}. Model label: ${model} (${receipt.agent.modelVerification}).`
  };
}

async function loadOrBuildInputs(cwd: string): Promise<CurationInputs> {
  const file = path.join(skillmapDir(cwd), 'curation', 'inputs.json');
  if (await fileExists(file)) return readJson<CurationInputs>(file);
  return buildInputs(cwd);
}

async function buildInputs(cwd: string): Promise<CurationInputs> {
  const dir = skillmapDir(cwd);
  const doctorPack = await chooseDoctorPack(dir);
  const artifacts = {
    inventory: await artifactState(path.join(dir, 'inventory.json')),
    doctor: await artifactState(path.join(dir, 'doctor.json')),
    doctorPack: await artifactState(doctorPack)
  };
  const warnings: string[] = [];
  if (!artifacts.inventory.exists) warnings.push('No inventory found; run `skillmap scan` before curation.');
  if (!artifacts.doctor.exists) warnings.push('No doctor report found; run `skillmap doctor` before curation.');
  if (!artifacts.doctorPack.exists) warnings.push('No doctor-pack found; run `skillmap doctor-pack --summary` before curation.');
  if (artifacts.inventory.exists) {
    const inventory = await readJson<Inventory>(artifacts.inventory.path);
    if (inventory.roots.some((root) => root.includes('/test/fixtures/'))) warnings.push('Inventory uses test fixtures; curation will not represent real installed skills.');
  }
  return { version: 1, createdAt: new Date().toISOString(), host: 'codex', mode: 'manual-native-agent', artifacts, warnings };
}

async function chooseDoctorPack(dir: string): Promise<string> {
  const summary = path.join(dir, 'doctor-pack.summary.md');
  if (await fileExists(summary)) return summary;
  return path.join(dir, 'doctor-pack.md');
}

function renderCodexPrompt(inputs: CurationInputs): string {
  return `# SkillMap Codex Curation Prompt\n\nYou are my SOTA Codex curation agent for SkillMap. Use high judgment; do not delete or mutate source skills.\n\n## Task\n\nRead the doctor pack and produce two files only:\n\n1. \`.skillmap/proposals/policy.yml\`\n2. \`.skillmap/proposals/policy-rationale.md\`\n\n## Curation Rules\n\n- Choose conservative canonical defaults.\n- Mark risky script-bearing, reverse-engineering, account, deployment, and security-sensitive skills specialist or explicit-only unless direct broad use is justified.\n- Resolve duplicate names with policy tiers, family, overlaps, supersedes, and notes.\n- Do not tell me to delete installed skills.\n- Include rationale for uncertain choices.\n\n## Input Artifacts\n\n- Inventory: ${inputs.artifacts.inventory.path} (${inputs.artifacts.inventory.sha256 ?? 'missing'})\n- Doctor report: ${inputs.artifacts.doctor.path} (${inputs.artifacts.doctor.sha256 ?? 'missing'})\n- Doctor pack: ${inputs.artifacts.doctorPack.path} (${inputs.artifacts.doctorPack.sha256 ?? 'missing'})\n\n## After You Produce The Files\n\nI will run:\n\n\`\`\`bash\nskillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --confirm\nskillmap apply-policy --policy .skillmap/policy.yml --dry-run\nskillmap status\n\`\`\`\n\n## Warnings From SkillMap\n\n${inputs.warnings.length ? inputs.warnings.map((warning) => `- ${warning}`).join('\n') : '- none'}\n`;
}
