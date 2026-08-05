import "server-only";

import { NextResponse } from "next/server";
import { createHostedApiErrorPayload } from "@/lib/contracts/hosted-api-response";
import type { HostedApiResponseV1, HostedSkillListV1, HostedSkillV1 } from "@/lib/contracts/generated/types";
import { assertContract } from "@/lib/contracts/generated/validate.server";

const HOSTED_API_SCHEMA = "https://skillmap.dev/contracts/hosted-api-response/v1.schema.json";

export function catalogSuccess(data: HostedSkillListV1 | HostedSkillV1, status = 200) {
  const payload: HostedApiResponseV1 = {
    kind: "skillmap.hosted-api-response",
    schemaVersion: 1,
    ok: true,
    requestId: crypto.randomUUID(),
    data
  };
  assertContract(HOSTED_API_SCHEMA, payload);
  return NextResponse.json(payload, { status, headers: noStoreHeaders() });
}

export function catalogError(
  status: number,
  code: string,
  message: string,
  retryable = false
) {
  const payload: HostedApiResponseV1 = createHostedApiErrorPayload(code, message, retryable);
  assertContract(HOSTED_API_SCHEMA, payload);
  return NextResponse.json(payload, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff"
  };
}
