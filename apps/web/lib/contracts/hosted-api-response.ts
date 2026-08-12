import type { HostedApiResponseV1 } from "./generated/types";
import {
  HOSTED_API_RESPONSE_SCHEMA_ID,
  validateHostedApiErrorResponse
} from "./generated/hosted-api-response-validator.ts";

export { HOSTED_API_RESPONSE_SCHEMA_ID };

export function createHostedApiErrorPayload(
  code: string,
  message: string,
  retryable = false
): HostedApiResponseV1 {
  const payload: HostedApiResponseV1 = {
    kind: "skillmap.hosted-api-response",
    schemaVersion: 1,
    ok: false,
    requestId: crypto.randomUUID(),
    error: { code, message, retryable }
  };
  if (!validateHostedApiErrorResponse(payload)) {
    throw new Error(`Generated hosted API response validator rejected ${HOSTED_API_RESPONSE_SCHEMA_ID}`);
  }
  return payload;
}
