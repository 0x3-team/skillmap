"use server";

import { classifyVerifiedClaims } from "@/lib/auth/errors";
import {
  ownerDeviceRevision,
  ownerDeviceSuffix,
  ownerDeviceActionInput,
  type OwnerDeviceMutationResult,
} from "@/lib/device-auth/owner-devices-contracts.server";
import {
  renameOwnerDevice,
  revokeOwnerDevice,
} from "@/lib/device-auth/owner-devices-repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function renameDeviceAction(
  formData: FormData,
): Promise<OwnerDeviceMutationResult> {
  const input = actionInput(formData);
  if (!input || !input.displayName) return { status: "unavailable" };
  const context = await ownerContext();
  if (!context) return { status: "unavailable" };
  return renameOwnerDevice(
    context,
    input.suffix,
    input.displayName,
    input.revision,
  );
}

export async function revokeDeviceAction(
  formData: FormData,
): Promise<OwnerDeviceMutationResult> {
  const input = actionInput(formData);
  if (!input) return { status: "unavailable" };
  const context = await ownerContext();
  if (!context) return { status: "unavailable" };
  return revokeOwnerDevice(context, input.suffix, input.revision);
}

function actionInput(formData: FormData) {
  const suffix = ownerDeviceSuffix(formData.get("publicIdSuffix"));
  const revision = ownerDeviceRevision(
    Number(formData.get("expectedRevision")),
  );
  const displayName = ownerDeviceActionInput(formData.get("displayName"));
  return suffix && revision !== null ? { suffix, revision, displayName } : null;
}

async function ownerContext() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return null;
    throw error;
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  return auth.state === "authenticated" ? supabase : null;
}
