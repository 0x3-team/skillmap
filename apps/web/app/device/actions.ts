"use server";

import { redirect } from "next/navigation";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import {
  genericConfirmationError,
  isConfirmationDecision,
  isConfirmationHandle,
  normalizeConfirmationRevision,
  normalizeConfirmationUserCode,
  type DeviceConfirmationResult
} from "@/lib/device-auth/confirmation-contracts.server";
import { SupabaseDeviceAuthConfirmationRepository } from "@/lib/device-auth/confirmation-repository.server";
import { confirmationActionIsSameOrigin } from "@/lib/device-auth/confirmation-csrf.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DeviceConfirmationActionState = DeviceConfirmationResult;

const SIGN_IN_PATH = "/sign-in?next=/device";

export async function reviewDeviceConfirmation(
  _previous: DeviceConfirmationActionState,
  formData: FormData
): Promise<DeviceConfirmationActionState> {
  if (!(await confirmationActionIsSameOrigin())) return genericConfirmationError();
  const userCode = normalizeConfirmationUserCode(readSingle(formData, "userCode"));
  if (!userCode) return genericConfirmationError();
  const context = await confirmationContext();
  if (context.state === "signed-out") redirect(SIGN_IN_PATH);
  if (context.state !== "authenticated") return genericConfirmationError();
  return context.repository.review(userCode);
}

export async function decideDeviceConfirmation(
  _previous: DeviceConfirmationActionState,
  formData: FormData
): Promise<DeviceConfirmationActionState> {
  if (!(await confirmationActionIsSameOrigin())) return genericConfirmationError();
  const handle = readSingle(formData, "confirmationHandle");
  const revision = normalizeConfirmationRevision(readSingle(formData, "confirmationRevision"));
  const decision = readSingle(formData, "decision");
  if (!isConfirmationHandle(handle) || revision === null || !isConfirmationDecision(decision)) {
    return genericConfirmationError();
  }
  const context = await confirmationContext();
  if (context.state === "signed-out") redirect(SIGN_IN_PATH);
  if (context.state !== "authenticated") return genericConfirmationError();
  return context.repository.decide(handle, revision, decision);
}

function readSingle(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0];
  return value.length > 0 && value.length <= 160 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

type ConfirmationContext =
  | { state: "authenticated"; repository: SupabaseDeviceAuthConfirmationRepository }
  | { state: "signed-out" | "unavailable" };

async function confirmationContext(): Promise<ConfirmationContext> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return { state: "unavailable" };
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state !== "authenticated") return { state: auth.state };
  return {
    state: "authenticated",
    repository: new SupabaseDeviceAuthConfirmationRepository(supabase as unknown as ConstructorParameters<typeof SupabaseDeviceAuthConfirmationRepository>[0])
  };
}
