export type ProjectionJson = string | number | boolean | null | { [key: string]: ProjectionJson | undefined } | ProjectionJson[];

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINDING_KEYS = ["critical", "high", "info", "low", "medium"];

export function parseFindingCounts(value: unknown): Record<string, ProjectionJson | undefined> | null {
  if (!isExactRecord(value, FINDING_KEYS)) return null;
  for (const key of FINDING_KEYS) {
    const count = value[key];
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 10_000) return null;
  }
  return value as Record<string, ProjectionJson | undefined>;
}

export function parsePublicChecks(value: unknown): ProjectionJson[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 || jsonBytes(value) > 32_768) return null;
  const codes = new Set<string>();
  for (const item of value) {
    if (!isExactRecord(item, ["code", "evidenceDigest", "outcome", "severity"])) return null;
    if (typeof item.code !== "string" || item.code.length > 64 || !CODE.test(item.code) || codes.has(item.code)) return null;
    if (!["passed", "warning", "blocked", "not-applicable"].includes(String(item.outcome))) return null;
    if (!["critical", "high", "medium", "low", "info"].includes(String(item.severity))) return null;
    if (item.evidenceDigest !== null && (typeof item.evidenceDigest !== "string" || !DIGEST.test(item.evidenceDigest))) return null;
    codes.add(item.code);
  }
  return value as ProjectionJson[];
}

export function parseHardGates(value: unknown): ProjectionJson[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50 || jsonBytes(value) > 16_384) return null;
  const codes = new Set<string>();
  for (const item of value) {
    if (!isExactRecord(item, ["code", "evidenceDigest", "passed"])) return null;
    if (typeof item.code !== "string" || item.code.length > 64 || !CODE.test(item.code) || codes.has(item.code)) return null;
    if (typeof item.passed !== "boolean") return null;
    if (item.evidenceDigest !== null && (typeof item.evidenceDigest !== "string" || !DIGEST.test(item.evidenceDigest))) return null;
    if (item.passed && item.evidenceDigest === null) return null;
    codes.add(item.code);
  }
  return value as ProjectionJson[];
}

export function parseDimensions(value: unknown): ProjectionJson[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || jsonBytes(value) > 16_384) return null;
  const codes = new Set<string>();
  for (const item of value) {
    if (!isExactRecord(item, ["code", "evidenceDigest", "score", "weight"])) return null;
    if (typeof item.code !== "string" || item.code.length > 64 || !CODE.test(item.code) || codes.has(item.code)) return null;
    if (typeof item.weight !== "number" || !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 1) return null;
    if (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) return null;
    if (typeof item.evidenceDigest !== "string" || !DIGEST.test(item.evidenceDigest)) return null;
    codes.add(item.code);
  }
  return value as ProjectionJson[];
}

export function parseNullableBoundedNumber(value: unknown, minimum: number, maximum: number): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

export function parseNullableDigest(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && DIGEST.test(value) ? value : undefined;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
