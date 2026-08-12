import { redirect } from "next/navigation";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DeviceConfirmationForm } from "./device-confirmation-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = { referrer: "no-referrer" as const };

export default async function DeviceConfirmationPage() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return <UnavailableDevicePage />;
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state === "signed-out") redirect("/sign-in?next=/device");
  if (auth.state !== "authenticated") return <UnavailableDevicePage />;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground">
      <CatalogHeader accountState="authenticated" />
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Device confirmation</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Connect a new device</h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">Enter the one-time code from SkillMap in a signed-in browser. Review the requested access before approving it.</p>
        </div>
        <div className="surface mt-8 rounded-2xl p-5 sm:p-8"><DeviceConfirmationForm /></div>
      </section>
    </main>
  );
}

function UnavailableDevicePage() {
  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-background px-4 py-20 text-foreground"><section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6"><h1 className="text-2xl font-semibold">Device confirmation is unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Hosted authentication could not be verified. No device code was stored or processed.</p></section></main>;
}
