export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const inlineValue = eq >= 0 ? raw.slice(eq + 1) : undefined;
    let value: string | boolean = inlineValue ?? true;
    if (inlineValue === undefined && rest[i + 1] && !rest[i + 1].startsWith('--')) {
      value = rest[i + 1];
      i += 1;
    }
    if (flags[key] !== undefined) {
      const existing = flags[key];
      flags[key] = Array.isArray(existing) ? [...existing, String(value)] : [String(existing), String(value)];
    } else {
      flags[key] = value;
    }
  }
  return { command, positionals, flags };
}

export function hasFlag(flags: Record<string, string | boolean | string[]>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

export function flagString(flags: Record<string, string | boolean | string[]>, name: string): string | undefined {
  const value = flags[name];
  if (Array.isArray(value)) return value[value.length - 1];
  if (typeof value === 'string') return value;
  return undefined;
}

export function flagStrings(flags: Record<string, string | boolean | string[]>, name: string): string[] {
  const value = flags[name];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}
