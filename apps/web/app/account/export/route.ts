import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError, getSiteUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_SAVED_SKILLS = 1_000;
const MAX_SUBMISSIONS = 1_000;
const MAX_REPORTS = 1_000;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
const MAX_MANAGED_VAULT_BYTES = 1 * 1024 * 1024;

// The authenticated-only managed Skill Vault export RPC already serializes the
// owner's private vault data as one deterministic, versioned, SQL-bounded jsonb
// object. It accepts no account id. We only ever validate and relay it; we never
// merge, re-shape, or partly include it.
const EXPORT_MANAGED_VAULT_RPC = "export_my_managed_skill_vault";
const EXPECTED_VAULT_SCHEMA_VERSION = "1.0";
const EXPECTED_MANAGED_VAULT_SECTIONS = [
  "managed_skills",
  "managed_skill_versions",
  "managed_skill_releases",
  "managed_skill_files",
  "devices",
  "import_sessions",
  "import_file_receipts",
  "route_decisions",
  "route_decision_selections",
  "route_corrections"
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidManagedVault(value: unknown): value is Record<string, unknown> & {
  schema_version: string;
  sections: Record<string, unknown>;
} {
  if (!isPlainRecord(value)) return false;
  if (value["schema_version"] !== EXPECTED_VAULT_SCHEMA_VERSION
    || typeof value["generated_at"] !== "string"
    || !isPlainRecord(value["sections"])) return false;

  const sections = value["sections"];
  if (Object.keys(sections).length !== EXPECTED_MANAGED_VAULT_SECTIONS.length) return false;
  for (const sectionName of EXPECTED_MANAGED_VAULT_SECTIONS) {
    const section = sections[sectionName];
    if (!isPlainRecord(section)
      || !Number.isSafeInteger(section["count"])
      || !Number.isSafeInteger(section["total"])
      || (section["count"] as number) < 0
      || (section["total"] as number) < (section["count"] as number)
      || typeof section["truncated"] !== "boolean"
      || section["truncated"] !== ((section["count"] as number) < (section["total"] as number))
      || !Array.isArray(section["items"])
      || section["items"].length !== section["count"]
      || !section["items"].every(isPlainRecord)) return false;
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_MANAGED_VAULT_BYTES;
  } catch {
    return false;
  }
}

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return exportError(503, "Account export is unavailable in this environment.");
  }

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(claims, claimsError);
  if (auth.state === "signed-out") {
    return Response.redirect(new URL("/sign-in?next=/account/export", getSiteUrl()), 303);
  }
  if (auth.state !== "authenticated") return exportError(503, "Account authentication could not be verified.");

  const [profileResult, savedCountResult, submissionsCountResult, reportsCountResult] = await Promise.all([
    supabase.from("profiles").select("user_id,created_at").eq("user_id", auth.userId).maybeSingle(),
    supabase.from("saved_skills").select("*", { count: "exact", head: true }).eq("user_id", auth.userId),
    supabase.from("my_skill_submissions").select("*", { count: "exact", head: true }),
    supabase.from("my_skill_reports").select("*", { count: "exact", head: true })
  ]);
  if (profileResult.error || savedCountResult.error || submissionsCountResult.error || reportsCountResult.error
    || savedCountResult.count === null || submissionsCountResult.count === null || reportsCountResult.count === null) {
    return exportError(503, "Account export data could not be read.");
  }
  if (savedCountResult.count > MAX_SAVED_SKILLS || submissionsCountResult.count > MAX_SUBMISSIONS
    || reportsCountResult.count > MAX_REPORTS) {
    return exportError(413, "Account export exceeds the bounded single-download limit. Contact support for a complete export.");
  }
  const [savedResult, submissionsResult, reportsResult, managedVaultResult] = await Promise.all([
    supabase.from("saved_skills").select("skill_id,created_at").eq("user_id", auth.userId).order("created_at", { ascending: true }).order("skill_id", { ascending: true }).range(0, MAX_SAVED_SKILLS - 1),
    supabase.from("my_skill_submissions").select("*").order("created_at", { ascending: true }).order("submission_id", { ascending: true }).range(0, MAX_SUBMISSIONS - 1),
    supabase.from("my_skill_reports")
      .select("report_id,skill_id,version_id,category,message,state,disposition_code,resolution_reason_code,public_resolution_message,created_at,updated_at,resolved_at")
      .order("created_at", { ascending: true }).order("report_id", { ascending: true }).range(0, MAX_REPORTS - 1),
    // The vault export RPC is not yet present in the generated database RPC
    // types (regeneration is deferred to M2.15). It accepts no arguments; the
    // JSON value it returns is strictly runtime-validated by
    // isValidManagedVault before it can reach the response.
    supabase.rpc(EXPORT_MANAGED_VAULT_RPC as never)
  ]);
  if (savedResult.error || submissionsResult.error || reportsResult.error || managedVaultResult.error) {
    return exportError(503, "Account export data could not be read.");
  }
  if (!isValidManagedVault(managedVaultResult.data)) {
    return exportError(503, "Account export data could not be read.");
  }
  if ((savedResult.data?.length ?? 0) !== savedCountResult.count
    || (submissionsResult.data?.length ?? 0) !== submissionsCountResult.count
    || (reportsResult.data?.length ?? 0) !== reportsCountResult.count) {
    return exportError(409, "Account data changed during export. Retry to receive one consistent bounded snapshot.");
  }

  const body = `${JSON.stringify({
    kind: "skillmap.account-export",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: profileResult.data ?? { user_id: auth.userId, created_at: null },
    savedSkills: savedResult.data ?? [],
    submissions: submissionsResult.data ?? [],
    reports: reportsResult.data ?? [],
    managedSkillVault: managedVaultResult.data,
    limits: { savedSkills: MAX_SAVED_SKILLS, submissions: MAX_SUBMISSIONS, reports: MAX_REPORTS }
  }, null, 2)}\n`;
  if (new TextEncoder().encode(body).byteLength > MAX_EXPORT_BYTES) {
    return exportError(413, "Account export exceeds the bounded response size. Contact support for a complete export.");
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "attachment; filename=\"skillmap-account-export.json\"",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function exportError(status: number, message: string) {
  return Response.json({ error: { code: "ACCOUNT_EXPORT_UNAVAILABLE", message } }, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
