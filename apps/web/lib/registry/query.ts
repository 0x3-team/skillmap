import "server-only";

import { CatalogInputError } from "@/lib/registry/errors";

const HOSTED_SKILL_ID = /^skl_[0-9a-f]{32}$/;
const PUBLISHER_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURSOR = /^[A-Za-z0-9_-]+$/;

export interface CatalogCursor {
  publishedAt: string;
  skillId: string;
}

export interface NormalizedCatalogQuery {
  q: string | null;
  limit: number;
  cursor: string | null;
  decodedCursor: CatalogCursor | null;
}

export function normalizeCatalogQuery(input: {
  q?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
}): NormalizedCatalogQuery {
  const normalizedQuery = input.q?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() ?? "";
  if (normalizedQuery.length > 200) {
    throw new CatalogInputError("INVALID_QUERY", "Search queries must be at most 200 characters.");
  }

  const limit = input.limit === undefined || input.limit === null || input.limit === ""
    ? 24
    : typeof input.limit === "number"
      ? input.limit
      : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new CatalogInputError("INVALID_QUERY", "limit must be an integer from 1 to 50.");
  }

  const rawCursor = input.cursor?.trim() || null;
  const decodedCursor = rawCursor ? decodeCatalogCursor(rawCursor) : null;

  return {
    q: normalizedQuery || null,
    limit,
    cursor: rawCursor,
    decodedCursor
  };
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  assertCatalogCursor(cursor);
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCatalogCursor(value: string): CatalogCursor {
  if (value.length > 512 || !CURSOR.test(value)) {
    throw new CatalogInputError("INVALID_CURSOR", "The catalog cursor is malformed.");
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("shape");
    const cursor = decoded as Partial<CatalogCursor>;
    if (Object.keys(cursor).sort().join(",") !== "publishedAt,skillId") throw new Error("keys");
    assertCatalogCursor(cursor);
    return { publishedAt: cursor.publishedAt, skillId: cursor.skillId };
  } catch (error) {
    if (error instanceof CatalogInputError) throw error;
    throw new CatalogInputError("INVALID_CURSOR", "The catalog cursor is malformed.");
  }
}

export function assertHostedSkillId(value: string): void {
  if (!HOSTED_SKILL_ID.test(value)) {
    throw new CatalogInputError("INVALID_QUERY", "The hosted skill ID is malformed.");
  }
}

export function assertCatalogRoute(publisher: string, slug: string): void {
  if (
    publisher.length < 2 || publisher.length > 40 || !PUBLISHER_HANDLE.test(publisher)
    || slug.length < 2 || slug.length > 100 || !SKILL_SLUG.test(slug)
  ) {
    throw new CatalogInputError("INVALID_QUERY", "The catalog route is malformed.");
  }
}

function assertCatalogCursor(cursor: Partial<CatalogCursor>): asserts cursor is CatalogCursor {
  if (typeof cursor.publishedAt !== "string" || typeof cursor.skillId !== "string") {
    throw new CatalogInputError("INVALID_CURSOR", "The catalog cursor is malformed.");
  }
  const parsed = new Date(cursor.publishedAt);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== cursor.publishedAt || !HOSTED_SKILL_ID.test(cursor.skillId)) {
    throw new CatalogInputError("INVALID_CURSOR", "The catalog cursor is malformed.");
  }
}
