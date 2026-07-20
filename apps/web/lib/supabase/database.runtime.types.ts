import type { Database as GeneratedDatabase } from "./database.types";

type ApiSchema = GeneratedDatabase["api"];
type ApiFunctions = ApiSchema["Functions"];
type OperatorFunctionName =
  | "get_skill_submission_operator_detail"
  | "get_skill_submission_queue_summary"
  | "list_skill_submission_operator_queue";

type FunctionReturnRow<Name extends OperatorFunctionName> =
  ApiFunctions[Name]["Returns"] extends Array<infer Row> ? Row : never;

type NullableFields<Row, Keys extends keyof Row> = Omit<Row, Keys> & {
  [Key in Keys]: Row[Key] | null;
};

type NonNullableFields<Row, Keys extends keyof Row> = Omit<Row, Keys> & {
  [Key in Keys]-?: Exclude<Row[Key], null>;
};

type FunctionWithReturns<Name extends OperatorFunctionName, Returns> =
  Omit<ApiFunctions[Name], "Returns"> & { Returns: Returns };

type OperatorSubmissionQueueSummaryNullableKey =
  | "oldest_accepted_at"
  | "oldest_processing_claim_expires_at"
  | "oldest_queued_at"
  | "oldest_remediation_at";

export type OperatorSubmissionQueueSummary = NullableFields<
  FunctionReturnRow<"get_skill_submission_queue_summary">,
  OperatorSubmissionQueueSummaryNullableKey
>;

type OperatorSubmissionQueueNullableKey =
  | "claim_expires_at"
  | "claimed_at"
  | "completed_at"
  | "current_worker_version"
  | "public_status_message"
  | "remediation_code"
  | "result_skill_id"
  | "result_version_id"
  | "submitter_license_claim";

export type OperatorSubmissionQueueRow = NullableFields<
  FunctionReturnRow<"list_skill_submission_operator_queue">,
  OperatorSubmissionQueueNullableKey
>;

type OperatorSubmissionDetailNullableKey =
  | "audit_receipt"
  | "claim_expires_at"
  | "claimed_at"
  | "completed_at"
  | "current_worker_version"
  | "grade_receipt"
  | "last_transition_digest"
  | "license_evidence_receipt"
  | "public_status_message"
  | "publication_digest"
  | "remediation_code"
  | "result_skill_id"
  | "result_version_id"
  | "review_case"
  | "submitter_license_claim";

type OperatorSubmissionDetailNonNullableJsonKey =
  | "collision_reviews"
  | "publisher_authorizations"
  | "transition_events"
  | "worker_runs";

export type OperatorSubmissionDetail = NonNullableFields<
  NullableFields<
    FunctionReturnRow<"get_skill_submission_operator_detail">,
    OperatorSubmissionDetailNullableKey
  >,
  OperatorSubmissionDetailNonNullableJsonKey
>;

type RuntimeFunctions = Omit<ApiFunctions, OperatorFunctionName> & {
  get_skill_submission_operator_detail: FunctionWithReturns<
    "get_skill_submission_operator_detail",
    OperatorSubmissionDetail[]
  >;
  get_skill_submission_queue_summary: FunctionWithReturns<
    "get_skill_submission_queue_summary",
    OperatorSubmissionQueueSummary[]
  >;
  list_skill_submission_operator_queue: FunctionWithReturns<
    "list_skill_submission_operator_queue",
    OperatorSubmissionQueueRow[]
  >;
};

// `supabase gen types` cannot infer nullable RETURNS TABLE expressions. Keep
// its output byte-exact in database.types.ts and override only the three
// operator RPCs at the application boundary, following Supabase's documented
// generated-type override pattern.
export type Database = Omit<GeneratedDatabase, "api"> & {
  api: Omit<ApiSchema, "Functions"> & { Functions: RuntimeFunctions };
};

type IncludesNull<Value> = null extends Value ? true : false;
type NullableKeys<Row> = {
  [Key in keyof Row]-?: IncludesNull<Row[Key]> extends true ? Key : never;
}[keyof Row];
type NonNullableKeys<Row> = Exclude<keyof Row, NullableKeys<Row>>;
type IsExact<Left, Right> =
  [Left] extends [Right]
    ? [Right] extends [Left]
      ? true
      : false
    : false;
type AssertTrue<Value extends true> = Value;

// These expected sets are deliberately independent from the unions that drive
// the overrides above. Changing an override without changing the reviewed SQL
// nullability contract therefore fails the application typecheck.
type ExpectedOperatorSubmissionQueueSummaryNullableKey =
  | "oldest_accepted_at"
  | "oldest_processing_claim_expires_at"
  | "oldest_queued_at"
  | "oldest_remediation_at";

type ExpectedOperatorSubmissionQueueNullableKey =
  | "claim_expires_at"
  | "claimed_at"
  | "completed_at"
  | "current_worker_version"
  | "public_status_message"
  | "remediation_code"
  | "result_skill_id"
  | "result_version_id"
  | "submitter_license_claim";

type ExpectedOperatorSubmissionDetailNullableKey =
  | "audit_receipt"
  | "claim_expires_at"
  | "claimed_at"
  | "completed_at"
  | "current_worker_version"
  | "grade_receipt"
  | "last_transition_digest"
  | "license_evidence_receipt"
  | "public_status_message"
  | "publication_digest"
  | "remediation_code"
  | "result_skill_id"
  | "result_version_id"
  | "review_case"
  | "submitter_license_claim";

export type OperatorSubmissionExactNullabilityAssertions = [
  AssertTrue<IsExact<
    NullableKeys<OperatorSubmissionQueueSummary>,
    ExpectedOperatorSubmissionQueueSummaryNullableKey
  >>,
  AssertTrue<IsExact<
    NonNullableKeys<OperatorSubmissionQueueSummary>,
    Exclude<
      keyof FunctionReturnRow<"get_skill_submission_queue_summary">,
      ExpectedOperatorSubmissionQueueSummaryNullableKey
    >
  >>,
  AssertTrue<IsExact<
    NullableKeys<OperatorSubmissionQueueRow>,
    ExpectedOperatorSubmissionQueueNullableKey
  >>,
  AssertTrue<IsExact<
    NonNullableKeys<OperatorSubmissionQueueRow>,
    Exclude<
      keyof FunctionReturnRow<"list_skill_submission_operator_queue">,
      ExpectedOperatorSubmissionQueueNullableKey
    >
  >>,
  AssertTrue<IsExact<
    NullableKeys<OperatorSubmissionDetail>,
    ExpectedOperatorSubmissionDetailNullableKey
  >>,
  AssertTrue<IsExact<
    NonNullableKeys<OperatorSubmissionDetail>,
    Exclude<
      keyof FunctionReturnRow<"get_skill_submission_operator_detail">,
      ExpectedOperatorSubmissionDetailNullableKey
    >
  >>,
  AssertTrue<IsExact<
    keyof OperatorSubmissionQueueSummary,
    keyof FunctionReturnRow<"get_skill_submission_queue_summary">
  >>,
  AssertTrue<IsExact<
    keyof OperatorSubmissionQueueRow,
    keyof FunctionReturnRow<"list_skill_submission_operator_queue">
  >>,
  AssertTrue<IsExact<
    keyof OperatorSubmissionDetail,
    keyof FunctionReturnRow<"get_skill_submission_operator_detail">
  >>,
];
