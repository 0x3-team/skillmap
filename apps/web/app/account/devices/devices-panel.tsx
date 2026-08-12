"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Monitor, Pencil, ShieldAlert, X } from "lucide-react";
import {
  type OwnerDevice,
  type OwnerDeviceMutationResult,
  type OwnerDevicesResult,
} from "@/lib/device-auth/owner-devices-contracts.server";
import { renameDeviceAction, revokeDeviceAction } from "./actions";

type RetryRequest =
  | {
      kind: "rename";
      publicIdSuffix: string;
      revision: number;
      displayName: string;
    }
  | { kind: "revoke"; publicIdSuffix: string; revision: number };

export function DevicesPanel({
  initial,
}: {
  initial: Extract<OwnerDevicesResult, { status: "ok" }>;
}) {
  const [devices, setDevices] = useState(initial.devices);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [pending, startTransition] = useTransition();

  function applyResult(
    result: OwnerDeviceMutationResult,
    action: "renamed" | "revoked",
  ) {
    if (result.status === "unavailable") {
      setNotice(
        "This device action is unavailable right now. No change was confirmed.",
      );
      return;
    }
    setDevices((current) =>
      current.map((device) =>
        device.publicIdSuffix === result.device.publicIdSuffix
          ? result.device
          : device,
      ),
    );
    setNotice(
      result.status === "conflict"
        ? "This device changed in another session. The latest details are shown; review them before trying again."
        : action === "renamed"
          ? "Device name updated."
          : "Device revoked.",
    );
  }

  function runMutation(request: RetryRequest) {
    const formData = new FormData();
    formData.set("publicIdSuffix", request.publicIdSuffix);
    formData.set("expectedRevision", String(request.revision));
    if (request.kind === "rename")
      formData.set("displayName", request.displayName);
    startTransition(async () => {
      try {
        const result =
          request.kind === "rename"
            ? await renameDeviceAction(formData)
            : await revokeDeviceAction(formData);
        applyResult(result, request.kind === "rename" ? "renamed" : "revoked");
        if (result.status === "unavailable") setRetryRequest(request);
        else setRetryRequest(null);
      } catch {
        setRetryRequest(request);
        setNotice(
          "That device action could not be completed. Nothing was confirmed; retry when ready.",
        );
      }
    });
  }

  function rename(device: OwnerDevice, displayName: string) {
    runMutation({
      kind: "rename",
      publicIdSuffix: device.publicIdSuffix,
      revision: device.revision,
      displayName,
    });
  }

  function revoke(device: OwnerDevice) {
    runMutation({
      kind: "revoke",
      publicIdSuffix: device.publicIdSuffix,
      revision: device.revision,
    });
  }

  return (
    <div aria-busy={pending} data-device-management="ready">
      {notice ? (
        <p
          className="mb-5 rounded-xl border border-border bg-muted/45 px-4 py-3 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      ) : null}
      {retryRequest ? (
        <button
          type="button"
          className="mb-5 inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => runMutation(retryRequest)}
          disabled={pending}
        >
          Retry device action
        </button>
      ) : null}
      {devices.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-12 text-center"
          data-device-state="empty"
        >
          <Monitor
            className="mx-auto h-7 w-7 text-primary"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold">No connected devices</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Devices you connect to SkillMap will appear here. You can rename or
            revoke each connection independently.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4" data-device-state="list">
          {devices.map((device) => (
            <DeviceCard
              key={`${device.publicIdSuffix}:${device.revision}`}
              device={device}
              pending={pending}
              onRename={rename}
              onRevoke={revoke}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({
  device,
  pending,
  onRename,
  onRevoke,
}: {
  device: OwnerDevice;
  pending: boolean;
  onRename: (device: OwnerDevice, name: string) => void;
  onRevoke: (device: OwnerDevice) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(device.displayName);
  const revokeTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRevokeRef = useRef<HTMLButtonElement>(null);
  const terminal = device.state === "revoked" || device.state === "compromised";

  function closeRevokeDialog() {
    setConfirming(false);
    queueMicrotask(() => revokeTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!confirming) return;
    cancelRevokeRef.current?.focus();
    const dialog = cancelRevokeRef.current?.closest("[role=alertdialog]");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming(false);
        queueMicrotask(() => revokeTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  return (
    <article
      className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-device-suffix={device.publicIdSuffix}
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${terminal ? "border-border bg-muted text-muted-foreground" : device.state === "expired" || device.state === "expiring" ? "border-warning/35 bg-warning/10" : "border-success/30 bg-success/10"}`}
            >
              {device.state === "active"
                ? "Active"
                : device.state[0].toUpperCase() + device.state.slice(1)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {device.platform}
            </span>
          </div>
          {editing ? (
            <form
              className="mt-3 flex min-w-0 flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onRename(device, name);
                setEditing(false);
              }}
            >
              <label
                className="sr-only"
                htmlFor={`device-name-${device.publicIdSuffix}`}
              >
                Device name
              </label>
              <input
                id={`device-name-${device.publicIdSuffix}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                autoComplete="off"
                className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                disabled={pending}
              />
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                disabled={pending || name.trim().length === 0}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
                onClick={() => {
                  setName(device.displayName);
                  setEditing(false);
                }}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
              </button>
            </form>
          ) : (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-lg font-semibold">
                {device.displayName}
              </h2>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setEditing(true)}
                disabled={pending || terminal}
                aria-label={`Rename device ${device.displayName}`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Rename
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Device ending in{" "}
            <span className="mono font-semibold text-foreground">
              {device.publicIdSuffix}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Match this ID with{" "}
            <code className="mono">skillmap auth status</code>.
          </p>
        </div>
        {!terminal && !confirming ? (
          <button
            type="button"
            ref={revokeTriggerRef}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-destructive/35 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setConfirming(true)}
            disabled={pending}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Revoke device
          </button>
        ) : null}
      </div>

      <dl className="mt-5 grid min-w-0 gap-4 border-t border-border pt-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Created" value={formatDate(device.createdAt)} />
        <Detail
          label="Last seen"
          value={
            device.lastSeenAt ? formatDate(device.lastSeenAt) : "Not yet seen"
          }
        />
        <Detail
          label="Access expires"
          value={
            device.expiresAt
              ? formatDate(device.expiresAt)
              : "No expiry reported"
          }
        />
        <div className="min-w-0">
          <dt className="font-semibold text-muted-foreground">Scopes</dt>
          <dd className="mt-1 flex min-w-0 flex-wrap gap-1.5">
            {device.scopes.length ? (
              device.scopes.map((scope) => (
                <span
                  className="max-w-full break-all rounded-md bg-muted px-1.5 py-1 mono text-[10px]"
                  key={scope}
                >
                  {scope}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </dd>
        </div>
      </dl>

      {confirming ? (
        <div
          className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`revoke-title-${device.publicIdSuffix}`}
          aria-describedby={`revoke-description-${device.publicIdSuffix}`}
        >
          <h3
            id={`revoke-title-${device.publicIdSuffix}`}
            className="font-semibold text-destructive"
          >
            Revoke this device?
          </h3>
          <p
            id={`revoke-description-${device.publicIdSuffix}`}
            className="mt-2 text-sm leading-6 text-muted-foreground"
          >
            This signs out the device and revokes its connected access. This
            action cannot be undone from the dashboard.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
              onClick={() => {
                closeRevokeDialog();
                onRevoke(device);
              }}
              disabled={pending}
            >
              Confirm revoke
            </button>
            <button
              type="button"
              ref={cancelRevokeRef}
              className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
              onClick={() => {
                closeRevokeDialog();
              }}
              disabled={pending}
            >
              Keep device
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
