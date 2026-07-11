import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagString, hasFlag } from '../core/args.js';
import { SkillMapLocalBackend } from '../server/skillmap-backend.js';
import { startLocalConnector } from '../server/local-connector.js';
import { LOCAL_APP_ASSET_VERSION } from '../server/compatibility.js';

export async function dashboardCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<void> {
  if (hasFlag(flags, 'background')) throw new Error('Background dashboard mode is not enabled yet. Run the connector in the foreground so shutdown and diagnostics remain explicit.');
  const port = parsePort(flagString(flags, 'port'));
  const staticRoot = flagString(flags, 'static-root')
    ? path.resolve(cwd, flagString(flags, 'static-root')!)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../assets/local-app/${LOCAL_APP_ASSET_VERSION}`);
  const backend = new SkillMapLocalBackend(cwd);
  await backend.resumeInterruptedJobs();
  const connector = await startLocalConnector({ backend, ...(port !== undefined ? { port } : {}), staticRoot });
  const startup = {
    kind: 'skillmap.dashboard-started',
    schemaVersion: 1,
    origin: connector.origin,
    bootstrapUrl: connector.bootstrapUrl,
    port: connector.port,
    workspace: cwd,
    mode: 'foreground',
    promptRetention: false
  };
  if (hasFlag(flags, 'json')) process.stdout.write(`${JSON.stringify(startup)}\n`);
  else {
    process.stdout.write(`SkillMap local dashboard is running at ${connector.origin}\n`);
    process.stdout.write(`Open this one-time URL within five minutes:\n${connector.bootstrapUrl}\n`);
    process.stdout.write('Raw route prompts stay in memory and are not persisted. Press Ctrl-C to stop.\n');
  }
  await waitForShutdown(connector.close);
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('dashboard --port must be an integer between 1 and 65535.');
  return port;
}

function waitForShutdown(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void close().then(resolve, reject);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
