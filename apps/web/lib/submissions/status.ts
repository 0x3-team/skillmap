export const SUBMISSION_PUBLIC_ID = /^sub_[0-9a-f]{32}$/;

export type SubmitStatus =
  | "auth-unavailable"
  | "duplicate"
  | "idempotency-conflict"
  | "invalid"
  | "quota"
  | "queued"
  | "service-unavailable";

export type SubmissionListStatus = "not-withdrawable" | "queued" | "service-unavailable" | "withdrawn";

const SUBMIT_STATUSES = new Set<SubmitStatus>([
  "auth-unavailable",
  "duplicate",
  "idempotency-conflict",
  "invalid",
  "quota",
  "queued",
  "service-unavailable"
]);
const LIST_STATUSES = new Set<SubmissionListStatus>([
  "not-withdrawable",
  "queued",
  "service-unavailable",
  "withdrawn"
]);

export function submitStatusPath(status: SubmitStatus, options: { field?: string; submissionId?: string } = {}): string {
  const query = new URLSearchParams({ status });
  if (options.field && /^[a-z][A-Za-z]{0,39}$/.test(options.field)) query.set("field", options.field);
  if (options.submissionId && SUBMISSION_PUBLIC_ID.test(options.submissionId)) query.set("submission", options.submissionId);
  return `/submit?${query}`;
}

export function submissionListStatusPath(status: SubmissionListStatus, submissionId?: string): string {
  const query = new URLSearchParams({ status });
  if (submissionId && SUBMISSION_PUBLIC_ID.test(submissionId)) query.set("submission", submissionId);
  return `/account/submissions?${query}`;
}

export function parseSubmitStatus(value: string | string[] | undefined): SubmitStatus | null {
  return typeof value === "string" && SUBMIT_STATUSES.has(value as SubmitStatus) ? value as SubmitStatus : null;
}

export function parseSubmissionListStatus(value: string | string[] | undefined): SubmissionListStatus | null {
  return typeof value === "string" && LIST_STATUSES.has(value as SubmissionListStatus)
    ? value as SubmissionListStatus
    : null;
}

export function parseSubmissionPublicId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && SUBMISSION_PUBLIC_ID.test(value) ? value : null;
}
