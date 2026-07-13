import "server-only";

import {
  parseDimensions,
  parseFindingCounts,
  parseHardGates,
  parseNullableBoundedNumber,
  parseNullableDigest,
  parsePublicChecks,
  type ProjectionJson
} from "@/lib/evidence/projection";
import { createPublicCatalogClient } from "@/lib/supabase/catalog.server";

const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;
const AUDIT_ID = /^aud_[0-9a-f]{32}$/;
const GRADE_ID = /^grd_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REASON_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicAuditEvidence = {
  auditReceiptId: string;
  receiptDigest: string;
  skillId: string;
  versionId: string;
  sourceCommit: string;
  state: "passed" | "warnings" | "blocked";
  findingCounts: Record<string, ProjectionJson | undefined>;
  checks: ProjectionJson[];
  reasonCodes: string[];
  policyVersion: string;
  hostProfileVersion: string;
  workerVersion: string;
  auditedAt: string;
  licenseState: "confirmed" | "noassertion" | "restricted";
  spdxExpression: string | null;
  permissionScripts: boolean;
  networkIndicators: boolean;
  toolIndicators: boolean;
};

export type PublicGradeEvidence = {
  gradeReceiptId: string;
  receiptDigest: string;
  auditReceiptId: string;
  auditReceiptDigest: string;
  skillId: string;
  versionId: string;
  sourceCommit: string;
  state: "provisional" | "blocked";
  totalScore: number | null;
  confidence: number | null;
  compatibilityEvidenceDigest: string;
  evaluationSuiteDigest: string | null;
  rubricVersion: string;
  hostProfileVersion: string;
  evaluatorVersion: string;
  hardGates: ProjectionJson[];
  dimensions: ProjectionJson[];
  reasonCodes: string[];
  gradedAt: string;
};

export class EvidenceQueryError extends Error {
  constructor() {
    super("Public evidence could not be loaded.");
    this.name = "EvidenceQueryError";
  }
}

export class EvidenceDataError extends Error {
  constructor() {
    super("Public evidence failed its bounded projection contract.");
    this.name = "EvidenceDataError";
  }
}

export async function getPublicAuditEvidence(skillId: string, versionId: string): Promise<PublicAuditEvidence | null> {
  assertTarget(skillId, versionId);
  const supabase = createPublicCatalogClient();
  const { data, error } = await supabase
    .from("catalog_audit_evidence")
    .select("*")
    .eq("skill_id", skillId)
    .eq("version_id", versionId)
    .maybeSingle();
  if (error) throw new EvidenceQueryError();
  if (!data) return null;
  return parseAuditEvidence(data as Record<string, unknown>);
}

export async function getPublicGradeEvidence(skillId: string, versionId: string): Promise<PublicGradeEvidence | null> {
  assertTarget(skillId, versionId);
  const supabase = createPublicCatalogClient();
  const { data, error } = await supabase
    .from("catalog_grade_evidence")
    .select("*")
    .eq("skill_id", skillId)
    .eq("version_id", versionId)
    .maybeSingle();
  if (error) throw new EvidenceQueryError();
  if (!data) return null;
  return parseGradeEvidence(data as Record<string, unknown>);
}

function parseAuditEvidence(row: Record<string, unknown>): PublicAuditEvidence {
  const findingCounts = parseFindingCounts(row.finding_counts);
  const checks = parsePublicChecks(row.checks);
  const reasonCodes = boundedReasonCodes(row.reason_codes, 0);
  const spdxExpression = optionalBoundedText(row.spdx_expression, 200);
  if (!AUDIT_ID.test(text(row.audit_receipt_id)) || !DIGEST.test(text(row.receipt_digest))
    || !SKILL_ID.test(text(row.skill_id)) || !VERSION_ID.test(text(row.version_id))
    || !COMMIT.test(text(row.source_commit)) || !["passed", "warnings", "blocked"].includes(text(row.state))
    || findingCounts === null || checks === null || reasonCodes === null || spdxExpression === undefined
    || !isBoundedText(row.policy_version, 64) || !isBoundedText(row.host_profile_version, 64)
    || !isBoundedText(row.worker_version, 128) || !isTimestamp(row.audited_at)
    || !["confirmed", "noassertion", "restricted"].includes(text(row.license_state))
    || typeof row.permission_scripts !== "boolean" || typeof row.network_indicators !== "boolean"
    || typeof row.tool_indicators !== "boolean") throw new EvidenceDataError();
  return {
    auditReceiptId: text(row.audit_receipt_id), receiptDigest: text(row.receipt_digest),
    skillId: text(row.skill_id), versionId: text(row.version_id), sourceCommit: text(row.source_commit),
    state: text(row.state) as PublicAuditEvidence["state"], findingCounts, checks, reasonCodes,
    policyVersion: text(row.policy_version), hostProfileVersion: text(row.host_profile_version),
    workerVersion: text(row.worker_version), auditedAt: text(row.audited_at),
    licenseState: text(row.license_state) as PublicAuditEvidence["licenseState"], spdxExpression,
    permissionScripts: row.permission_scripts, networkIndicators: row.network_indicators, toolIndicators: row.tool_indicators
  };
}

function parseGradeEvidence(row: Record<string, unknown>): PublicGradeEvidence {
  const hardGates = parseHardGates(row.hard_gates);
  const dimensions = parseDimensions(row.dimensions);
  const reasonCodes = boundedReasonCodes(row.reason_codes, 1);
  const evaluationSuiteDigest = parseNullableDigest(row.evaluation_suite_digest);
  const state = text(row.state);
  const totalScore = parseNullableBoundedNumber(row.total_score, 0, 100);
  const confidence = parseNullableBoundedNumber(row.confidence, 0, 1);
  if (!GRADE_ID.test(text(row.grade_receipt_id)) || !DIGEST.test(text(row.receipt_digest))
    || !AUDIT_ID.test(text(row.audit_receipt_id)) || !DIGEST.test(text(row.audit_receipt_digest))
    || !SKILL_ID.test(text(row.skill_id)) || !VERSION_ID.test(text(row.version_id))
    || !COMMIT.test(text(row.source_commit)) || !["provisional", "blocked"].includes(state)
    || totalScore === undefined || confidence === undefined
    || (totalScore !== null && !Number.isInteger(totalScore))
    || (state === "provisional" && (totalScore === null || confidence === null))
    || (state === "blocked" && (totalScore !== null || confidence !== null))
    || hardGates === null || dimensions === null || reasonCodes === null
    || !DIGEST.test(text(row.compatibility_evidence_digest)) || evaluationSuiteDigest === undefined
    || !isBoundedText(row.rubric_version, 64) || !isBoundedText(row.host_profile_version, 64)
    || !isBoundedText(row.evaluator_version, 128) || !isTimestamp(row.graded_at)) throw new EvidenceDataError();
  return {
    gradeReceiptId: text(row.grade_receipt_id), receiptDigest: text(row.receipt_digest),
    auditReceiptId: text(row.audit_receipt_id), auditReceiptDigest: text(row.audit_receipt_digest),
    skillId: text(row.skill_id), versionId: text(row.version_id), sourceCommit: text(row.source_commit),
    state: state as PublicGradeEvidence["state"], totalScore, confidence,
    compatibilityEvidenceDigest: text(row.compatibility_evidence_digest),
    evaluationSuiteDigest, rubricVersion: text(row.rubric_version),
    hostProfileVersion: text(row.host_profile_version), evaluatorVersion: text(row.evaluator_version),
    hardGates, dimensions, reasonCodes, gradedAt: text(row.graded_at)
  };
}

function assertTarget(skillId: string, versionId: string) {
  if (!SKILL_ID.test(skillId) || !VERSION_ID.test(versionId)) throw new EvidenceDataError();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalBoundedText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  return isBoundedText(value, maximum) ? value : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(new Date(value).valueOf());
}

function boundedReasonCodes(value: unknown, minimum: number): string[] | null {
  return Array.isArray(value) && value.length >= minimum && value.length <= 20
    && value.every((item) => typeof item === "string" && item.length <= 64 && REASON_CODE.test(item))
    && new Set(value).size === value.length
    ? value as string[]
    : null;
}
