import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.runtime.types";
import {
  ownerDeviceActionInput,
  ownerDeviceRevision,
  ownerDeviceSuffix,
  parseOwnerDeviceMutationResult,
  parseOwnerDevicesResult,
  type OwnerDeviceMutationResult,
  type OwnerDevicesResult,
} from "./owner-devices-contracts.server.ts";

type OwnerDevicesRpcClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};

function rpcClient(supabase: SupabaseClient<Database>): OwnerDevicesRpcClient {
  return supabase as unknown as OwnerDevicesRpcClient;
}

export async function listOwnerDevices(
  supabase: SupabaseClient<Database>,
): Promise<OwnerDevicesResult> {
  const { data, error } = await rpcClient(supabase).rpc(
    "device_auth_list_my_devices_v1",
  );
  return error ? { status: "unavailable" } : parseOwnerDevicesResult(data);
}

export async function renameOwnerDevice(
  supabase: SupabaseClient<Database>,
  suffix: unknown,
  displayName: unknown,
  revision: unknown,
): Promise<OwnerDeviceMutationResult> {
  const pPublicIdSuffix = ownerDeviceSuffix(suffix);
  const pDisplayName = ownerDeviceActionInput(displayName);
  const pExpectedRevision = ownerDeviceRevision(revision);
  if (!pPublicIdSuffix || !pDisplayName || pExpectedRevision === null)
    return { status: "unavailable" };
  const { data, error } = await rpcClient(supabase).rpc(
    "device_auth_rename_my_device_v1",
    {
      p_public_id_suffix: pPublicIdSuffix,
      p_display_name: pDisplayName,
      p_expected_revision: pExpectedRevision,
    },
  );
  return error
    ? { status: "unavailable" }
    : parseOwnerDeviceMutationResult(data);
}

export async function revokeOwnerDevice(
  supabase: SupabaseClient<Database>,
  suffix: unknown,
  revision: unknown,
): Promise<OwnerDeviceMutationResult> {
  const pPublicIdSuffix = ownerDeviceSuffix(suffix);
  const pExpectedRevision = ownerDeviceRevision(revision);
  if (!pPublicIdSuffix || pExpectedRevision === null)
    return { status: "unavailable" };
  const { data, error } = await rpcClient(supabase).rpc(
    "device_auth_revoke_my_device_v1",
    {
      p_public_id_suffix: pPublicIdSuffix,
      p_expected_revision: pExpectedRevision,
    },
  );
  return error
    ? { status: "unavailable" }
    : parseOwnerDeviceMutationResult(data);
}
