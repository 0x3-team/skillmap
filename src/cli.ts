#!/usr/bin/env node
import { parseArgs, hasFlag } from './core/args.js';
import { initCommand } from './commands/init.js';
import { scanCommand } from './commands/scan.js';
import { doctorCommand } from './commands/doctor.js';
import { doctorPackCommand } from './commands/doctor-pack.js';
import { applyPolicyCommand } from './commands/apply-policy.js';
import { graphCommand } from './commands/graph.js';
import { routeCommand } from './commands/route.js';
import { evalCommand } from './commands/eval.js';
import { listCommand } from './commands/list.js';
import { ingestAgentReviewCommand } from './commands/ingest-agent-review.js';
import { hookCommand } from './commands/hook.js';

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  if (parsed.command === 'help' || hasFlag(parsed.flags, 'help') || parsed.command === '--help') {
    printHelp();
    return;
  }
  let output: unknown;
  switch (parsed.command) {
    case 'init': output = await initCommand(cwd, parsed.flags); break;
    case 'scan': output = await scanCommand(cwd, parsed.flags); break;
    case 'list': output = await listCommand(cwd); break;
    case 'doctor': output = await doctorCommand(cwd, parsed.flags); break;
    case 'doctor-pack': output = await doctorPackCommand(cwd, parsed.flags); break;
    case 'ingest-agent-review': output = await ingestAgentReviewCommand(cwd, parsed.positionals); break;
    case 'apply-policy': output = await applyPolicyCommand(cwd, parsed.flags); break;
    case 'graph': output = await graphCommand(cwd, parsed.flags); break;
    case 'route': output = await routeCommand(cwd, parsed.positionals, parsed.flags); break;
    case 'eval': output = await evalCommand(cwd, parsed.flags); break;
    case 'hook': output = await hookCommand(cwd, parsed.positionals, parsed.flags); break;
    default: throw new Error(`Unknown command: ${parsed.command}`);
  }
  if (hasFlag(parsed.flags, 'json')) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHuman(output);
  }
}

function printHuman(output: unknown) {
  if (typeof output === 'object' && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.summary === 'string') console.log(record.summary);
    else if (typeof record.markdown === 'string') console.log(record.markdown);
    else if (typeof record.trace === 'string') console.log(record.trace);
    else if (typeof record.mermaid === 'string') console.log(record.mermaid);
    else if (typeof record.hookText === 'string') {
      if (record.hookText.length > 0) console.log(record.hookText);
    }
    else console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(String(output));
  }
}

function printHelp() {
  console.log(`SkillMap CLI\n\nCommands:\n  init [--dry-run] [--json]\n  scan [--root PATH] [--fixtures PATH] [--json]\n  list [--json]\n  doctor [--fixtures PATH] [--json]\n  doctor-pack [--fixtures PATH] [--summary] [--max-skills N] [--json]\n  ingest-agent-review FILE [--json]\n  apply-policy [--policy FILE] [--dry-run] [--json]\n  graph [--raw|--effective] [--json]\n  route <prompt> [--trace] [--json]\n  route --hook [--prompt TEXT] [--max N] [--json]\n  eval [--file FILE] [--json]\n  hook dry-run codex <prompt> [--json]\n  hook install codex --passive [--dry-run] [--global] [--config PATH] [--json]\n  hook uninstall codex [--dry-run] [--global] [--config PATH] [--json]\n\nSafety defaults: no cloud calls, no skill script execution, no hook install unless explicitly requested.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`skillmap error: ${message}`);
  process.exitCode = 1;
});
