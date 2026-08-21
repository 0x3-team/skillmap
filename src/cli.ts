#!/usr/bin/env node
import { parseArgs, hasFlag, flagString } from './core/args.js';
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
import { statusCommand } from './commands/status.js';
import { curateCommand } from './commands/curate.js';
import { sourcesCommand } from './commands/sources.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { mcpCommand } from './commands/mcp.js';
import { policyCommand } from './commands/policy.js';
import { identityCommand } from './commands/identity.js';
import { WorkspaceStateStore, type PublicationResult } from './core/workspace-state/index.js';
import { stateCommand } from './commands/state.js';
import { dashboardCommand } from './commands/dashboard.js';
import { loginCommand } from './commands/login.js';
import { authCommand } from './commands/auth.js';
import { whoamiCommand } from './commands/whoami.js';
import { logoutCommand } from './commands/logout.js';
import { CliExitError, mapDeviceAuthErrorToExitCode, SAFE_ERROR_MESSAGES } from './core/cli-exit.js';
import { SKILLMAP_PRODUCT_VERSION } from './server/compatibility.js';

const DEVICE_AUTH_COMMANDS = new Set(['login', 'auth', 'whoami', 'logout']);

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  if (parsed.command === 'help' || hasFlag(parsed.flags, 'help') || parsed.command === '--help') {
    printHelp();
    return;
  }
  if (parsed.command === 'version' || parsed.command === '--version' || hasFlag(parsed.flags, 'version')) {
    console.log(SKILLMAP_PRODUCT_VERSION);
    return;
  }
  let output: unknown;
  try {
    const mutation = mutationOperation(parsed.command, parsed.positionals, parsed.flags);
    if (mutation) {
      const store = WorkspaceStateStore.open(cwd);
      const wrapped = await store.withMutationLock(`cli:${mutation}`, async (context) => {
        const migrated = await store.isMigrated();
        if (migrated) {
          const preflight = await store.readCurrent({ purpose: 'status' });
          if (preflight.legacyDivergence.some((item) => item.severity === 'blocking')) {
            throw new Error('Canonical legacy projections diverged from the approved revision. Review them, then run `skillmap state import-legacy --confirm` or `skillmap state repair-projections --confirm` explicitly.');
          }
        }
        const carryForwardRoutingApproval = migrated
          && isDerivedApprovedGraphBuild(parsed.command, parsed.positionals, parsed.flags)
          && await hasExactCurrentRoutingApproval(store);
        const value = await dispatchCommand(cwd, parsed.command, parsed.positionals, parsed.flags);
        const approveForRouting = routingApprovalCandidate(parsed.command, value);
        const publication = migrated
          ? await context.publishLegacySnapshot({
            approveForRouting,
            ...(carryForwardRoutingApproval ? { carryForwardRoutingApproval: true } : {}),
            actor: 'local-cli',
            reason: `Successful ${mutation} command.`
          })
          : await context.migrateLegacy({ confirm: true, approveForRouting, actor: 'local-cli', reason: `Initial state publication after ${mutation}.` });
        return { value, publication };
      });
      output = attachPublicationReceipt(wrapped.value, wrapped.publication);
    } else {
      output = await dispatchCommand(cwd, parsed.command, parsed.positionals, parsed.flags);
    }
    if (output === undefined) return;
    if (hasFlag(parsed.flags, 'json')) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(output);
    }
  } catch (error: unknown) {
    const isJson = hasFlag(parsed.flags, 'json');
    if (DEVICE_AUTH_COMMANDS.has(parsed.command) || error instanceof CliExitError) {
      handleCliError(error, isJson);
    } else {
      handleLegacyCliError(error, isJson);
    }
  }
}

function handleLegacyCliError(error: unknown, isJson: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isJson) {
    console.error(JSON.stringify({ error: 'error', message }, null, 2));
  } else {
    console.error(`skillmap error: ${message}`);
  }
  process.exitCode = 1;
}

export function handleCliError(error: unknown, isJson: boolean): void {
  if (error instanceof CliExitError) {
    // Never echo error.message or payload.message: only a fixed safe message
    // derived from the exit code's category may reach the user.
    const safeMsg =
      SAFE_ERROR_MESSAGES[error.code] ?? SAFE_ERROR_MESSAGES.usage_error ?? 'CLI command error.';
    if (isJson) {
      console.log(JSON.stringify({ error: error.code, message: safeMsg }, null, 2));
    } else {
      console.error(`skillmap error: ${safeMsg}`);
    }
    process.exitCode = error.exitCode;
    return;
  }

  const mapped = mapDeviceAuthErrorToExitCode(error);
  if (isJson) {
    console.log(JSON.stringify({ error: mapped.code, message: mapped.message }, null, 2));
  } else {
    console.error(`skillmap error: ${mapped.message}`);
  }
  process.exitCode = mapped.exitCode;
}

export async function dispatchCommand(cwd: string, command: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  let output: unknown;
  switch (command) {
    case 'init': output = await initCommand(cwd, flags); break;
    case 'scan': output = await scanCommand(cwd, flags); break;
    case 'list': output = await listCommand(cwd); break;
    case 'doctor': output = await doctorCommand(cwd, flags); break;
    case 'doctor-pack': output = await doctorPackCommand(cwd, flags); break;
    case 'ingest-agent-review': output = await ingestAgentReviewCommand(cwd, positionals); break;
    case 'status': output = await statusCommand(cwd); break;
    case 'state': output = await stateCommand(cwd, positionals, flags); break;
    case 'dashboard': output = await dashboardCommand(cwd, flags); break;
    case 'export': output = await exportCommand(cwd, flags); break;
    case 'import': output = await importCommand(cwd, positionals, flags); break;
    case 'mcp': output = await mcpCommand(cwd, positionals, flags); break;
    case 'curate': output = await curateCommand(cwd, positionals, flags); break;
    case 'sources': output = await sourcesCommand(cwd, positionals, flags); break;
    case 'apply-policy': output = await applyPolicyCommand(cwd, flags); break;
    case 'policy': output = await policyCommand(cwd, positionals, flags); break;
    case 'identity': output = await identityCommand(cwd, positionals, flags); break;
    case 'graph': output = await graphCommand(cwd, positionals, flags); break;
    case 'route': output = await routeCommand(cwd, positionals, flags); break;
    case 'eval': output = await evalCommand(cwd, flags); break;
    case 'hook': output = await hookCommand(cwd, positionals, flags); break;
    case 'login': output = await loginCommand(cwd, positionals, flags); break;
    case 'auth': output = await authCommand(cwd, positionals, flags); break;
    case 'whoami': output = await whoamiCommand(cwd, positionals, flags); break;
    case 'logout': output = await logoutCommand(cwd, positionals, flags); break;
    default: throw new CliExitError(64, `Unknown command: ${command}`, 'usage_error');
  }
  return output;
}

function mutationOperation(command: string, positionals: string[], flags: Record<string, string | boolean | string[]>): string | undefined {
  if (hasFlag(flags, 'dry-run')) return undefined;
  if ((command === 'doctor' || command === 'doctor-pack') && flagString(flags, 'fixtures')) return undefined;
  if (command === 'init' || command === 'scan' || command === 'doctor' || command === 'doctor-pack' || command === 'apply-policy') return command;
  if (command === 'graph' && ['build', 'raw'].includes(positionals[0] ?? 'build')) return `graph-${positionals[0] ?? 'build'}`;
  if (command === 'eval' && hasFlag(flags, 'save-report')) return 'eval-save-report';
  if (command === 'sources' && ['adopt', 'check', 'review'].includes(positionals[0] ?? 'list')) return `sources-${positionals[0]}`;
  if (command === 'curate' && flagString(flags, 'ingest') && hasFlag(flags, 'confirm')) return 'curate-ingest';
  if (command === 'policy' && ['migrate', 'select-canonical', 'rollback'].includes(positionals[0] ?? '') && hasFlag(flags, 'confirm')) return `policy-${positionals[0]}`;
  if (command === 'identity' && ['adopt-move', 'approve-new'].includes(positionals[0] ?? '') && hasFlag(flags, 'confirm')) return `identity-${positionals[0]}`;
  return undefined;
}

function routingApprovalCandidate(command: string, value: unknown): boolean {
  if (command !== 'apply-policy' || !value || typeof value !== 'object') return false;
  const validation = (value as { policyValidation?: { duplicateInventoryNameGroups?: unknown[]; invalidCanonicalDecisions?: unknown[] } }).policyValidation;
  return Boolean(validation
    && (validation.duplicateInventoryNameGroups?.length ?? 0) === 0
    && (validation.invalidCanonicalDecisions?.length ?? 0) === 0);
}

function isDerivedApprovedGraphBuild(command: string, positionals: string[], flags: Record<string, string | boolean | string[]>): boolean {
  return command === 'graph' && (positionals[0] ?? 'build') === 'build' && !hasFlag(flags, 'raw');
}

async function hasExactCurrentRoutingApproval(store: WorkspaceStateStore): Promise<boolean> {
  try {
    const routing = await store.readCurrent({ purpose: 'routing' });
    return routing.source === 'current' && routing.selectedPointer.revisionId === routing.currentPointer.revisionId;
  } catch {
    return false;
  }
}

function attachPublicationReceipt(value: unknown, publication: PublicationResult): unknown {
  const receipt = {
    workspaceId: publication.pointer.workspaceId,
    revisionId: publication.pointer.revisionId,
    workspaceRevision: publication.pointer.workspaceRevision,
    effectiveDigest: publication.pointer.effectiveDigest,
    effectiveRevisionDigest: publication.pointer.effectiveRevisionDigest,
    lastKnownGoodUpdated: publication.lastKnownGoodUpdated
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>), revision: receipt };
  return { value, revision: receipt };
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
  console.log(`SkillMap CLI

Usage:
  skillmap --version
  skillmap <command> [options]

Commands:
  login [--no-browser] [--device-name NAME] [--json]
  auth status [--check] [--json]
  whoami [--json]
  logout [--confirm] [--local-only] [--json]
  init [--root PATH] [--dry-run] [--json]
  scan [--root PATH] [--fixtures PATH] [--json]
  list [--json]
  doctor [--fixtures PATH] [--fix-plan] [--json]
  doctor-pack [--fixtures PATH] [--summary] [--max-skills N] [--json]
  ingest-agent-review FILE [--json]
  status [--json]
  state status [--json]
  state migrate --confirm [--approve-routing] [--actor NAME] [--reason TEXT] [--json]
  state import-legacy --confirm [--approve-routing] [--actor NAME] [--reason TEXT] [--json]
  state rollback --target REVISION --expected-revision REVISION --actor NAME --reason TEXT --confirm [--approve-routing] [--json]
  state recover --confirm [--actor NAME] [--reason TEXT] [--json]
  state repair-projections --confirm [--json]
  dashboard [--port N] [--static-root PATH] [--json]
  export [--output PATH] [--redact-paths] [--json]
  export --include-sensitive-local --output .skillmap/private-exports/FILE [--json]  (POSIX only; fails closed on Windows)
  export --dashboard-snapshot --redact-paths [--output PATH] [--json]
  import FILE [--dry-run|--confirm] [--acknowledge-sensitive-local] [--json]
  import vault SKILL_DIR [--dry-run] [--json]
  curate codex --prepare [--json]
  curate codex --ingest FILE --rationale FILE --model MODEL [--dry-run|--confirm] [--json]
  sources list|check [--json]
  sources adopt SKILL [--skill-id ID] --repo OWNER/REPO --path PATH [--ref REF] [--json]
  sources adopt SKILL [--skill-id ID] --local --reason TEXT [--json]
  sources diff SKILL [--json]
  sources update SKILL [--dry-run] [--json]
  sources review SKILL --decision hold|accepted|ignore --reason TEXT [--json]
  apply-policy [--policy FILE] [--dry-run] [--strict] [--allow-fixtures] [--json]
  policy status [--json]
  policy migrate [--dry-run|--confirm] [--json]
  policy select-canonical NAME --skill-id ID --actor ACTOR --reason TEXT [--dry-run|--confirm] [--json]
  policy rollback [--confirm] [--json]
  identity status [--json]
  identity adopt-move --from OLD_ID --to NEW_ID --actor ACTOR --reason TEXT [--dry-run|--confirm] [--json]
  identity approve-new --skill-id ID --actor ACTOR --reason TEXT [--dry-run|--confirm] [--json]
  graph [build|query|explain|duplicates|conflicts|export] [--raw|--effective] [--format mermaid|json] [--json]
  route <prompt> [--skill-id ID] [--trace] [--json]
  route --hook [--prompt TEXT] [--max N] [--json]
  eval [--file FILE] [--min-count N] [--min-top1 N] [--min-top3 N] [--max-avoid-hits N] [--save-report] [--json]
  hook dry-run codex <prompt> [--json]
  hook install codex --passive [--dry-run] [--force] [--global] [--config PATH] [--json]
  hook uninstall codex [--dry-run] [--global] [--config PATH] [--json]
  mcp manifest [--json]
  mcp call TOOL [--prompt TEXT] [--query TEXT] [--skill-id ID] [--max N] [--limit N] [--cursor TOKEN] [--json]
  mcp serve

Safety defaults: no cloud calls, no skill script execution, source updates are preview-only, dashboard snapshots require redaction, and hook install requires ready status unless forced.`);
}

main().catch((error: unknown) => {
  handleCliError(error, false);
});
