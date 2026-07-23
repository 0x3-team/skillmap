import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Runs a local hosted-test SQL command through the host client when available.
 * The composed hosted gate may explicitly opt into the local Docker fallback so
 * contributors need Docker/Supabase, but not an additional host psql install.
 */
export function execLocalPsql(args, options = {}) {
  try {
    return execFileSync("psql", args, options);
  } catch (error) {
    if (!shouldUseDockerFallback(error)) throw error;
  }

  const { psqlArgs, input } = prepareDockerInvocation(args, options.input);
  const dockerArgs = [
    "exec",
    ...(input === undefined ? [] : ["-i"]),
    findLocalDatabaseContainer(),
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    ...psqlArgs
  ];
  return execFileSync("docker", dockerArgs, {
    ...options,
    ...(input === undefined ? {} : { input }),
    stdio: stdioWithPipedInput(options.stdio, input)
  });
}

function shouldUseDockerFallback(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT" &&
    "path" in error &&
    error.path === "psql" &&
    process.env.SKILLMAP_ALLOW_LOCAL_DOCKER_PSQL_FALLBACK === "1"
  );
}

function prepareDockerInvocation(args, configuredInput) {
  if (typeof args[0] !== "string" || !/^postgres(?:ql)?:\/\//.test(args[0])) {
    throw new Error("The local Docker psql fallback requires a PostgreSQL connection URL as its first argument.");
  }

  const psqlArgs = [...args.slice(1)];
  const fileIndex = psqlArgs.findIndex((argument) => argument === "-f" || argument === "--file");
  if (fileIndex === -1) return { psqlArgs, input: configuredInput };
  if (configuredInput !== undefined) {
    throw new Error("A local Docker psql fallback cannot combine a SQL file with separate standard input.");
  }

  const filePath = psqlArgs[fileIndex + 1];
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("The local Docker psql fallback requires a SQL file path after -f.");
  }
  return {
    psqlArgs: [...psqlArgs.slice(0, fileIndex), ...psqlArgs.slice(fileIndex + 2)],
    input: readFileSync(filePath)
  };
}

function findLocalDatabaseContainer() {
  const projectId = process.env.SKILLMAP_LOCAL_SUPABASE_PROJECT ?? "skillmap";
  const names = execFileSync("docker", [
    "ps",
    "--filter", `label=com.supabase.cli.project=${projectId}`,
    "--format", "{{.Names}}"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const databaseContainers = names.filter((name) => name === `supabase_db_${projectId}`);
  if (databaseContainers.length !== 1) {
    throw new Error("The disposable local Supabase database container was not found.");
  }
  return databaseContainers[0];
}

function stdioWithPipedInput(stdio, input) {
  if (input === undefined) return stdio;
  if (stdio === "ignore") return ["pipe", "ignore", "ignore"];
  if (stdio === "inherit") return ["pipe", "inherit", "inherit"];
  if (Array.isArray(stdio)) return ["pipe", stdio[1] ?? "pipe", stdio[2] ?? "pipe"];
  return stdio;
}
