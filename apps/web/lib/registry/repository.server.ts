import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HostedCompatibilityState,
  HostedGradeBand,
  HostedGradeState,
  HostedLifecycleState,
  HostedLicenseState,
  HostedPublisherId,
  HostedRedistributionState,
  HostedSkillId,
  HostedSkillListV1,
  HostedSkillRelationshipV1,
  HostedSkillSummaryV1,
  HostedSkillV1,
  HostedSkillVersionId,
  Sha256Digest
} from "@/lib/contracts/generated/types";
import { assertContract } from "@/lib/contracts/generated/validate.server";
import {
  assertPublicSkillRelationshipLimit,
  CatalogDataError,
  CatalogInputError,
  CatalogQueryError,
  MAX_PUBLIC_SKILL_RELATIONSHIPS
} from "@/lib/registry/errors";
import {
  assertCatalogRoute,
  assertHostedSkillId,
  encodeCatalogCursor,
  normalizeCatalogQuery
} from "@/lib/registry/query";
import {
  canonicalizeUtcTimestamp,
  decodeSavedSkillsCursor,
  encodeSavedSkillsCursor,
  SavedSkillsCursorError
} from "@/lib/registry/saved-cursor";
import type { PublicSkillRoute } from "@/lib/registry/public-links";
import { createPublicCatalogClient } from "@/lib/supabase/catalog.server";
import type { Database } from "@/lib/supabase/database.runtime.types";

const HOSTED_LIST_SCHEMA = "https://skillmap.dev/contracts/hosted-skill-list/v1.schema.json";
const HOSTED_SKILL_SCHEMA = "https://skillmap.dev/contracts/hosted-skill/v1.schema.json";
const SAVED_PAGE_SIZE = 50;
const MAX_PUBLIC_ROUTE_RESOLUTIONS = 50;
const SAVED_SKILL_SELECT = "saved_at,skill_id,publisher_id,publisher_handle,publisher_display_name,publisher_verification_state,slug,display_name,summary,lifecycle_state,capabilities,updated_at,version_id,version,entrypoint_content_digest,license_state,redistribution_state,compatibility_state,grade_state,grade_band,grade_confidence,grade_receipt_id,grade_receipt_digest,graded_at,grade_rubric_version,grade_host_profile_version,grade_invalidated_at,grade_reason_codes,published_at";

type CatalogRow = Database["api"]["Views"]["catalog_skill_versions"]["Row"];
type CatalogSummaryRow = Database["api"]["Views"]["catalog_skills"]["Row"];
type SavedCatalogRow = Database["api"]["Views"]["saved_skill_catalog"]["Row"];
type RelationshipRow = Database["api"]["Views"]["catalog_skill_relationships"]["Row"];

export interface CatalogListInput {
  q?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
}

export async function listPublicSkills(input: CatalogListInput = {}): Promise<HostedSkillListV1> {
  const normalized = normalizeCatalogQuery(input);
  const supabase = createPublicCatalogClient();
  let query = supabase
    .from("catalog_skills")
    .select("*")
    .order("published_at", { ascending: false })
    .order("skill_id", { ascending: true })
    .limit(normalized.limit + 1);

  if (normalized.q) {
    query = query.textSearch("search_document", normalized.q, { config: "simple", type: "websearch" });
  }
  if (normalized.decodedCursor) {
    const { publishedAt, skillId } = normalized.decodedCursor;
    query = query.or(`published_at.lt.${publishedAt},and(published_at.eq.${publishedAt},skill_id.gt.${skillId})`);
  }

  const { data, error } = await query;
  if (error) throw new CatalogQueryError();

  const rows = (data ?? []) as CatalogSummaryRow[];
  const hasMore = rows.length > normalized.limit;
  const pageRows = rows.slice(0, normalized.limit);
  const items = pageRows.map(mapSummary);
  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow
    ? encodeCatalogCursor({
        publishedAt: requiredTimestamp(lastRow.published_at, "published_at"),
        skillId: requiredHostedSkillId(lastRow.skill_id, "skill_id")
      })
    : null;

  const result: HostedSkillListV1 = {
    kind: "skillmap.hosted-skill-list",
    schemaVersion: 1,
    query: { q: normalized.q, limit: normalized.limit, cursor: normalized.cursor },
    items,
    pagination: {
      nextCursor,
      hasMore,
      stableSortKey: "published_at_desc_skill_id_asc"
    },
    generatedAt: new Date().toISOString()
  };
  assertContract(HOSTED_LIST_SCHEMA, result);
  return result;
}

export async function getPublicSkillById(skillId: string): Promise<HostedSkillV1 | null> {
  assertHostedSkillId(skillId);
  return getPublicSkill({ skillId });
}

export async function getPublicSkillByRoute(publisher: string, slug: string): Promise<HostedSkillV1 | null> {
  assertCatalogRoute(publisher, slug);
  return getPublicSkill({ publisher, slug });
}

export async function resolvePublicSkillRoutes(skillIds: string[]): Promise<Map<string, PublicSkillRoute>> {
  const uniqueIds = [...new Set(skillIds)];
  if (uniqueIds.length > MAX_PUBLIC_ROUTE_RESOLUTIONS) {
    throw new CatalogInputError("INVALID_QUERY", `At most ${MAX_PUBLIC_ROUTE_RESOLUTIONS} public skill routes can be resolved at once.`);
  }
  for (const skillId of uniqueIds) assertHostedSkillId(skillId);
  if (uniqueIds.length === 0) return new Map();

  const supabase = createPublicCatalogClient();
  const { data, error } = await supabase
    .from("catalog_skills")
    .select("skill_id,publisher_handle,slug,version_id")
    .in("skill_id", uniqueIds);
  if (error) throw new CatalogQueryError("Public result routes could not be loaded.");

  const routes = new Map<string, PublicSkillRoute>();
  for (const row of data ?? []) {
    const skillId = requiredHostedSkillId(row.skill_id, "skill_id");
    const publisherHandle = requiredString(row.publisher_handle, "publisher_handle");
    const slug = requiredString(row.slug, "slug");
    assertCatalogRoute(publisherHandle, slug);
    routes.set(skillId, {
      publisherHandle,
      slug,
      versionId: requiredVersionId(row.version_id, "version_id")
    });
  }
  return routes;
}

export interface SavedSkillsPage {
  items: HostedSkillSummaryV1[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  stableSortKey: "saved_at_desc_skill_id_asc";
}

export async function listSavedSkills(
  supabase: SupabaseClient<Database>,
  cursor: string | null = null
): Promise<SavedSkillsPage> {
  let decodedCursor = null;
  try {
    decodedCursor = cursor ? decodeSavedSkillsCursor(cursor) : null;
  } catch (error) {
    if (error instanceof SavedSkillsCursorError) {
      throw new CatalogInputError("INVALID_CURSOR", error.message);
    }
    throw error;
  }
  let query = supabase
    .from("saved_skill_catalog")
    .select(SAVED_SKILL_SELECT)
    .order("saved_at", { ascending: false })
    .order("skill_id", { ascending: true })
    .limit(SAVED_PAGE_SIZE + 1);
  if (decodedCursor) {
    query = query.or(`saved_at.lt.${decodedCursor.savedAt},and(saved_at.eq.${decodedCursor.savedAt},skill_id.gt.${decodedCursor.skillId})`);
  }

  const { data, error } = await query;
  if (error) throw new CatalogQueryError("Saved skills could not be loaded.");

  const rows = (data ?? []) as SavedCatalogRow[];
  const hasMore = rows.length > SAVED_PAGE_SIZE;
  const pageRows = rows.slice(0, SAVED_PAGE_SIZE);
  const items = pageRows.map(mapSummary);
  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow
    ? encodeSavedSkillsCursor({
        savedAt: requiredTimestamp(lastRow.saved_at, "saved_at"),
        skillId: requiredHostedSkillId(lastRow.skill_id, "skill_id")
      })
    : null;
  return {
    items,
    limit: SAVED_PAGE_SIZE,
    nextCursor,
    hasMore,
    stableSortKey: "saved_at_desc_skill_id_asc"
  };
}

async function getPublicSkill(
  selector: { skillId: string } | { publisher: string; slug: string }
): Promise<HostedSkillV1 | null> {
  const supabase = createPublicCatalogClient();
  let query = supabase.from("catalog_skill_versions").select("*");
  query = "skillId" in selector
    ? query.eq("skill_id", selector.skillId)
    : query.eq("publisher_handle", selector.publisher).eq("slug", selector.slug);

  const { data, error } = await query.maybeSingle();
  if (error) throw new CatalogQueryError();
  if (!data) return null;

  const row = data as CatalogRow;
  const skillId = requiredHostedSkillId(row.skill_id, "skill_id");
  const { data: relationshipData, error: relationshipError } = await supabase
    .from("catalog_skill_relationships")
    .select("*")
    .eq("source_skill_id", skillId)
    .order("relationship_type", { ascending: true })
    .order("target_skill_id", { ascending: true })
    .limit(MAX_PUBLIC_SKILL_RELATIONSHIPS + 1);
  if (relationshipError) throw new CatalogQueryError();

  const relationships = (relationshipData ?? []) as RelationshipRow[];
  assertPublicSkillRelationshipLimit(relationships);
  const detail = mapDetail(row, relationships);
  assertContract(HOSTED_SKILL_SCHEMA, detail);
  return detail;
}

function mapSummary(row: CatalogSummaryRow | CatalogRow | SavedCatalogRow): HostedSkillSummaryV1 {
  return {
    skillId: requiredHostedSkillId(row.skill_id, "skill_id"),
    publisher: {
      publisherId: requiredPublisherId(row.publisher_id, "publisher_id"),
      handle: requiredString(row.publisher_handle, "publisher_handle"),
      displayName: requiredString(row.publisher_display_name, "publisher_display_name"),
      verificationState: requiredEnum(row.publisher_verification_state, "publisher_verification_state", [
        "unverified", "identity-verified", "disputed"
      ] as const)
    },
    slug: requiredString(row.slug, "slug"),
    displayName: requiredString(row.display_name, "display_name"),
    summary: requiredString(row.summary, "summary"),
    lifecycleState: requiredEnum<HostedLifecycleState>(row.lifecycle_state, "lifecycle_state", ["published", "deprecated"]),
    currentVersion: {
      versionId: requiredVersionId(row.version_id, "version_id"),
      version: requiredString(row.version, "version"),
      entrypointContentDigest: requiredDigest(row.entrypoint_content_digest, "entrypoint_content_digest"),
      licenseState: requiredEnum<HostedLicenseState>(row.license_state, "license_state", ["confirmed", "noassertion", "restricted"]),
      redistribution: requiredEnum<HostedRedistributionState>(row.redistribution_state, "redistribution_state", ["mirrored", "metadata-only", "blocked"]),
      compatibilityState: requiredEnum<HostedCompatibilityState>(row.compatibility_state, "compatibility_state", ["not-tested", "declared", "compatible", "stale", "incompatible"]),
      grade: mapGrade(row),
      publishedAt: requiredTimestamp(row.published_at, "published_at")
    },
    capabilities: requiredStringArray(row.capabilities, "capabilities"),
    updatedAt: requiredTimestamp(row.updated_at, "updated_at")
  };
}

function mapDetail(row: CatalogRow, relationships: RelationshipRow[]): HostedSkillV1 {
  return {
    kind: "skillmap.hosted-skill",
    schemaVersion: 1,
    ...mapSummary(row),
    description: requiredString(row.description, "description"),
    source: {
      repositoryUrl: requiredString(row.repository_url, "repository_url"),
      commit: requiredString(row.source_commit, "source_commit"),
      path: requiredString(row.source_path, "source_path"),
      entrypointContentDigest: requiredDigest(row.entrypoint_content_digest, "entrypoint_content_digest"),
      rawSnapshotDigest: optionalDigest(row.raw_snapshot_digest, "raw_snapshot_digest")
    },
    artifact: {
      availability: requiredEnum(row.artifact_availability, "artifact_availability", ["metadata-only", "mirrored"] as const),
      normalizedDigest: optionalDigest(row.normalized_artifact_digest, "normalized_artifact_digest"),
      manifestDigest: optionalDigest(row.manifest_digest, "manifest_digest")
    },
    license: {
      state: requiredEnum<HostedLicenseState>(row.license_state, "license_state", ["confirmed", "noassertion", "restricted"]),
      spdxExpression: optionalString(row.spdx_expression, "spdx_expression"),
      redistribution: requiredEnum<HostedRedistributionState>(row.redistribution_state, "redistribution_state", ["mirrored", "metadata-only", "blocked"]),
      files: requiredStringArray(row.license_files, "license_files")
    },
    compatibility: {
      host: "codex",
      state: requiredEnum<HostedCompatibilityState>(row.compatibility_state, "compatibility_state", ["not-tested", "declared", "compatible", "stale", "incompatible"]),
      profileVersion: optionalString(row.compatibility_profile_version, "compatibility_profile_version"),
      evidenceDigest: optionalDigest(row.compatibility_evidence_digest, "compatibility_evidence_digest")
    },
    permissions: {
      scripts: requiredBoolean(row.permission_scripts, "permission_scripts"),
      network: requiredStringArray(row.permission_network, "permission_network"),
      tools: requiredStringArray(row.permission_tools, "permission_tools")
    },
    evidence: {
      provenance: requiredEnum(row.evidence_provenance_state, "evidence_provenance_state", ["unverified", "source-pinned", "attested", "stale", "blocked"] as const),
      audit: requiredEnum(row.evidence_audit_state, "evidence_audit_state", ["not-run", "passed", "warnings", "stale", "blocked"] as const),
      compatibility: requiredEnum<HostedCompatibilityState>(row.evidence_compatibility_state, "evidence_compatibility_state", ["not-tested", "declared", "compatible", "stale", "incompatible"])
    },
    relationships: relationships.map(mapRelationship)
  };
}

function mapGrade(row: CatalogSummaryRow | CatalogRow | SavedCatalogRow) {
  const state = requiredEnum<HostedGradeState>(row.grade_state, "grade_state", [
    "ungraded", "provisional", "current", "stale", "blocked", "revoked"
  ]);
  const receipt = row.grade_receipt_id === null
    ? null
    : {
        receiptId: requiredGradeReceiptId(row.grade_receipt_id, "grade_receipt_id"),
        receiptDigest: requiredDigest(row.grade_receipt_digest, "grade_receipt_digest"),
        gradedAt: requiredTimestamp(row.graded_at, "graded_at"),
        rubricVersion: requiredString(row.grade_rubric_version, "grade_rubric_version"),
        hostProfileVersion: requiredString(row.grade_host_profile_version, "grade_host_profile_version")
      };
  return {
    kind: "skillmap.hosted-grade-summary" as const,
    schemaVersion: 1 as const,
    state,
    band: optionalEnum<HostedGradeBand>(row.grade_band, "grade_band", ["A", "B", "C", "D", "F"]),
    confidence: optionalNumber(row.grade_confidence, "grade_confidence"),
    receipt,
    invalidatedAt: optionalTimestamp(row.grade_invalidated_at, "grade_invalidated_at"),
    reasonCodes: requiredStringArray(row.grade_reason_codes, "grade_reason_codes")
  };
}

function mapRelationship(row: RelationshipRow): HostedSkillRelationshipV1 {
  return {
    type: requiredEnum(row.relationship_type, "relationship_type", ["alternative", "complement", "prerequisite", "conflict", "duplicate", "supersedes"] as const),
    targetSkillId: requiredHostedSkillId(row.target_skill_id, "target_skill_id"),
    evidenceState: requiredEnum(row.evidence_state, "evidence_state", ["declared", "reviewed", "evaluated"] as const),
    reason: requiredString(row.reason, "reason")
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new CatalogDataError(`Missing ${field}.`);
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new CatalogDataError(`Missing ${field}.`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CatalogDataError(`Invalid ${field}.`);
  return value;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new CatalogDataError(`Invalid ${field}.`);
  }
  return value;
}

function requiredTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field);
  try {
    return canonicalizeUtcTimestamp(timestamp);
  } catch {
    throw new CatalogDataError(`Invalid ${field}.`);
  }
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredTimestamp(value, field);
}

function requiredDigest(value: unknown, field: string): Sha256Digest {
  const digest = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new CatalogDataError(`Invalid ${field}.`);
  return digest as Sha256Digest;
}

function optionalDigest(value: unknown, field: string): Sha256Digest | null {
  if (value === null) return null;
  return requiredDigest(value, field);
}

function requiredHostedSkillId(value: unknown, field: string): HostedSkillId {
  const id = requiredString(value, field);
  if (!/^skl_[0-9a-f]{32}$/.test(id)) throw new CatalogDataError(`Invalid ${field}.`);
  return id as HostedSkillId;
}

function requiredPublisherId(value: unknown, field: string): HostedPublisherId {
  const id = requiredString(value, field);
  if (!/^pub_[0-9a-f]{32}$/.test(id)) throw new CatalogDataError(`Invalid ${field}.`);
  return id as HostedPublisherId;
}

function requiredVersionId(value: unknown, field: string): HostedSkillVersionId {
  const id = requiredString(value, field);
  if (!/^skv_[0-9a-f]{32}$/.test(id)) throw new CatalogDataError(`Invalid ${field}.`);
  return id as HostedSkillVersionId;
}

function requiredGradeReceiptId(value: unknown, field: string) {
  const id = requiredString(value, field);
  if (!/^grd_[0-9a-f]{32}$/.test(id)) throw new CatalogDataError(`Invalid ${field}.`);
  return id as `grd_${string}`;
}

function requiredEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new CatalogDataError(`Invalid ${field}.`);
  return value as T;
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | null {
  if (value === null) return null;
  return requiredEnum(value, field, allowed);
}
