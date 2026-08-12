import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Laptop, ShieldAlert } from "lucide-react";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { listOwnerDevices } from "@/lib/device-auth/owner-devices-repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DevicesPanel } from "./devices-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function AccountDevicesPage() {
  return (
    <Suspense
      fallback={
        <DevicesShell accountState="unavailable">
          <LoadingState />
        </DevicesShell>
      }
    >
      <AccountDevicesContent />
    </Suspense>
  );
}

async function AccountDevicesContent() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof SupabaseConfigurationError)
      return (
        <DevicesShell accountState="unavailable">
          <UnavailableState />
        </DevicesShell>
      );
    throw error;
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state === "signed-out")
    return (
      <DevicesShell accountState="signed-out">
        <SignedOutState />
      </DevicesShell>
    );
  if (auth.state !== "authenticated")
    return (
      <DevicesShell accountState="unavailable">
        <UnavailableState />
      </DevicesShell>
    );
  const result = await listOwnerDevices(supabase);
  if (result.status !== "ok")
    return (
      <DevicesShell accountState="unavailable">
        <UnavailableState />
      </DevicesShell>
    );
  return (
    <DevicesShell>
      <DevicesPanel initial={result} />
    </DevicesShell>
  );
}

function DevicesShell({
  children,
  accountState = "authenticated",
}: {
  children: React.ReactNode;
  accountState?: "authenticated" | "signed-out" | "unavailable";
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background text-foreground"
    >
      <CatalogHeader accountState={accountState} />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Account security
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Connected devices
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review the devices connected to your SkillMap account. Rename or
              revoke one device at a time; sensitive credentials are never shown
              here.
            </p>
          </div>
          <Link
            href="/account"
            className="inline-flex h-10 items-center gap-2 self-start rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-accent sm:self-auto"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Account
          </Link>
        </div>
        <section className="pt-8" aria-labelledby="devices-heading">
          <h2 id="devices-heading" className="sr-only">
            Your connected devices
          </h2>
          {children}
        </section>
      </div>
    </main>
  );
}

function LoadingState() {
  return (
    <div
      className="rounded-2xl border border-border bg-card px-5 py-12 text-center"
      data-device-state="loading"
      aria-live="polite"
    >
      <Laptop
        className="mx-auto h-7 w-7 animate-pulse text-primary"
        aria-hidden="true"
      />
      <p className="mt-4 text-sm font-semibold">Loading connected devices…</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Checking the account-owned device list.
      </p>
    </div>
  );
}

function SignedOutState() {
  return (
    <div
      className="rounded-2xl border border-border bg-card px-5 py-12 text-center"
      data-device-state="signed-out"
    >
      <ShieldAlert
        className="mx-auto h-7 w-7 text-primary"
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-semibold">Sign in to manage devices</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Your connected-device list is private to your account.
      </p>
      <Link
        href="/sign-in?next=/account/devices"
        className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
      >
        Sign in
      </Link>
    </div>
  );
}

function UnavailableState() {
  return (
    <div
      className="rounded-2xl border border-warning/35 bg-warning/10 px-5 py-12 text-center"
      data-device-state="error"
      role="alert"
    >
      <ShieldAlert
        className="mx-auto h-7 w-7 text-warning"
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-semibold">Devices are unavailable</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        The account-owned device list could not be verified. No device details
        or credentials were shown.
      </p>
      <Link
        href="/account/devices"
        className="mt-5 inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-accent"
      >
        Try again
      </Link>
    </div>
  );
}
